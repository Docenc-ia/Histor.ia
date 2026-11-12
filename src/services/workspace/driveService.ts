/**
 * Google Drive Integration Service
 * Endpoint: https://www.googleapis.com/drive/v3/files
 * Scope: https://www.googleapis.com/auth/drive.file
 */

import { getCachedAccessToken, requestGoogleAccessToken, fetchGoogleApiWithRetry } from './googleAuth';
import { DriveResource } from '../../types';

export interface CourseFolderStructure {
  mainFolder: { id: string; name: string; url: string };
  gradesFolder: { id: string; name: string; url: string };
  attendanceFolder: { id: string; name: string; url: string };
  dispositionFolder: { id: string; name: string; url: string };
  libroDeTemasFolder: { id: string; name: string; url: string };
  reportsFolder: { id: string; name: string; url: string };
  incidentsFolder: { id: string; name: string; url: string };
  gradesSheetUrl?: string;
}

/**
 * Formats the main course folder name in Google Drive as "[Nombre del curso] por Docenc.ia"
 */
export function formatCourseDriveFolderName(courseName: string): string {
  const clean = (courseName || 'Curso')
    .replace(/^📚\s*/u, '')
    .replace(/\s*-\s*Materiales Docentes$/i, '')
    .trim();
  if (/por\s+docenc\.ia$/i.test(clean)) {
    return clean;
  }
  return `${clean} por Docenc.ia`;
}

/**
 * Checks whether an ID is a real Google Drive file/folder ID (not a local placeholder)
 */
export function isRealDriveFolderId(id?: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('folder-') ||
    trimmed.startsWith('f-') ||
    trimmed.startsWith('sheet-') ||
    trimmed.startsWith('report-') ||
    trimmed.includes('/')
  ) {
    return false;
  }
  return trimmed.length >= 10;
}

/**
 * Builds the direct Google Drive folder URL so opening a folder navigates straight into the folder and never to My Drive
 */
export function getDirectDriveFolderUrl(folderId?: string, fallbackUrl?: string): string {
  if (isRealDriveFolderId(folderId)) {
    return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId!.trim())}`;
  }
  if (fallbackUrl && fallbackUrl.includes('/drive/folders/')) {
    return fallbackUrl;
  }
  return fallbackUrl || 'https://drive.google.com/drive/u/0/my-drive';
}

export type CourseDriveCategory =
  | 'Calificaciones'
  | 'Asistencia'
  | 'Disposición'
  | 'Libro de Temas'
  | 'Informes'
  | 'Historial de Incidencias';

const courseFolderStructureCache = new Map<
  string,
  { structure: CourseFolderStructure; expiresAt: number }
>();

export interface ExistingCategoryFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  url: string;
}

export interface UploadOverwritePolicy {
  mode: 'overwrite' | 'create_new';
  targetFileId?: string;
}

let nextUploadOverwritePolicy: UploadOverwritePolicy | null = null;

const SAVED_DRIVE_FILES_REGISTRY_KEY = 'docencia_saved_drive_files_v1';

interface SavedDriveRegistryEntry {
  id: string;
  name: string;
  url: string;
  courseName: string;
  category: CourseDriveCategory;
  mimeType: string;
  updatedAt: string;
}

function readSavedDriveRegistry(): SavedDriveRegistryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SAVED_DRIVE_FILES_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedDriveRegistryEntry(entry: SavedDriveRegistryEntry): void {
  if (typeof window === 'undefined') return;
  try {
    const list = readSavedDriveRegistry().filter((item) => item.id !== entry.id);
    list.unshift(entry);
    localStorage.setItem(SAVED_DRIVE_FILES_REGISTRY_KEY, JSON.stringify(list.slice(0, 120)));
  } catch {}
}

export function getTargetMimeTypeForDriveFormat(
  format: 'sheets' | 'gdoc' | 'xlsx' | 'csv' | 'html'
): string {
  switch (format) {
    case 'sheets':
      return 'application/vnd.google-apps.spreadsheet';
    case 'gdoc':
      return 'application/vnd.google-apps.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'csv':
      return 'text/csv';
    case 'html':
      return 'text/html';
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export const driveService = {
  setNextUploadOverwritePolicy(policy: UploadOverwritePolicy | null): void {
    nextUploadOverwritePolicy = policy;
  },

  async findExistingFilesInCategoryByFormat(options: {
    courseName: string;
    category: CourseDriveCategory;
    format: 'sheets' | 'gdoc' | 'xlsx' | 'csv' | 'html';
    existingMainFolderId?: string;
    providedToken?: string;
  }): Promise<ExistingCategoryFileItem[]> {
    const targetMimeType = getTargetMimeTypeForDriveFormat(options.format);
    const normalizedCourse = formatCourseDriveFolderName(options.courseName).toLowerCase();
    const localMatches = readSavedDriveRegistry()
      .filter(
        (item) =>
          formatCourseDriveFolderName(item.courseName).toLowerCase() === normalizedCourse &&
          item.category === options.category &&
          item.mimeType === targetMimeType &&
          isRealDriveFolderId(item.id)
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        modifiedTime: item.updatedAt,
        url: item.url,
      }));

    const token = options.providedToken || getCachedAccessToken();
    if (!token) {
      return localMatches;
    }

    try {
      const { id: targetFolderId } = await this.getCategorySubfolder(
        options.courseName,
        options.category,
        options.existingMainFolderId,
        token
      );
      if (!isRealDriveFolderId(targetFolderId)) {
        return localMatches;
      }

      const query = `'${targetFolderId}' in parents and mimeType = '${targetMimeType}' and trashed = false`;
      const res = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          query
        )}&orderBy=modifiedTime desc&pageSize=15&fields=files(id,name,mimeType,modifiedTime,webViewLink)`,
        {},
        token
      );
      if (res.ok) {
        const data = await res.json();
        const remoteFiles: ExistingCategoryFileItem[] = (data.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType || targetMimeType,
          modifiedTime: f.modifiedTime,
          url:
            f.webViewLink ||
            (options.format === 'gdoc'
              ? `https://docs.google.com/document/d/${f.id}/edit`
              : options.format === 'sheets'
              ? `https://docs.google.com/spreadsheets/d/${f.id}/edit`
              : `https://drive.google.com/file/d/${f.id}/view`),
        }));

        if (remoteFiles.length > 0) {
          return remoteFiles;
        }
      }
    } catch {}

    return localMatches;
  },
  /**
   * Verify if a Google Drive file or spreadsheet still exists and is NOT in the trash (trashed = false).
   * Prevents stale localStorage / DB IDs from failing when a teacher deletes a file in Drive.
   */
  async verifyFileIsActive(fileId?: string, providedToken?: string): Promise<boolean> {
    if (!isRealDriveFolderId(fileId)) {
      return false;
    }
    const token = providedToken || getCachedAccessToken();
    if (!token) return true; // Assume valid if offline/unauthenticated

    try {
      const res = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId!)}?fields=id,trashed`,
        {},
        token
      );
      if (res.status === 404) return false;
      if (res.ok) {
        const data = await res.json();
        return data.trashed !== true;
      }
    } catch {
      // On network failure, don't invalidate cached ID
    }
    return true;
  },

  /**
   * Find or create a folder in Google Drive (optionally inside a parent folder)
   */
  async findOrCreateFolder(
    folderName: string,
    parentFolderId?: string,
    providedToken?: string,
    skipTokenRequest = false
  ): Promise<{ id: string; name: string; url: string }> {
    let token = providedToken || getCachedAccessToken();
    if (!token && !skipTokenRequest) {
      try {
        token = await requestGoogleAccessToken();
      } catch {}
    }

    if (!token) {
      const fallbackId = `folder-${Date.now().toString().slice(-4)}-${Math.random().toString(36).slice(2, 5)}`;
      return {
        id: fallbackId,
        name: folderName,
        url: 'https://drive.google.com/drive/u/0/my-drive',
      };
    }

    try {
      // Clean query name (escape single quotes)
      const safeName = folderName.replace(/'/g, "\\'");
      let query = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and name = '${safeName}'`;
      if (parentFolderId && isRealDriveFolderId(parentFolderId)) {
        query += ` and '${parentFolderId}' in parents`;
      }

      // Check if folder already exists (auto-retrying if token expired)
      const searchRes = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&pageSize=1`,
        {},
        token
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          const existing = searchData.files[0];
          return {
            id: existing.id,
            name: existing.name,
            url: getDirectDriveFolderUrl(existing.id, existing.webViewLink),
          };
        }
      }

      // Create new folder if not found
      const metadata: any = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (parentFolderId && isRealDriveFolderId(parentFolderId)) {
        metadata.parents = [parentFolderId];
      }

      const createRes = await fetchGoogleApiWithRetry(
        'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(metadata),
        },
        token
      );

      if (createRes.ok) {
        const data = await createRes.json();
        return {
          id: data.id,
          name: data.name,
          url: getDirectDriveFolderUrl(data.id, data.webViewLink),
        };
      }
    } catch (err) {
      console.warn(`Error in findOrCreateFolder for "${folderName}":`, err);
    }

    const fallbackId = `folder-${Date.now().toString().slice(-4)}-${Math.random().toString(36).slice(2, 5)}`;
    return {
      id: fallbackId,
      name: folderName,
      url: 'https://drive.google.com/drive/u/0/my-drive',
    };
  },

  /**
   * Ensure a Google Drive shortcut to targetFileId exists inside parentFolderId
   * so subfolders like "Disposición" and "Historial de Incidencias" also give direct access in Drive.
   */
  async ensureShortcutInFolder(
    shortcutName: string,
    targetFileId: string,
    parentFolderId: string,
    providedToken?: string
  ): Promise<boolean> {
    const token = providedToken || getCachedAccessToken();
    if (!token || !isRealDriveFolderId(targetFileId) || !isRealDriveFolderId(parentFolderId)) {
      return false;
    }

    try {
      const safeName = shortcutName.replace(/'/g, "\\'");
      const query = `'${parentFolderId}' in parents and trashed = false and (name = '${safeName}' or mimeType = 'application/vnd.google-apps.shortcut' or mimeType = 'application/vnd.google-apps.spreadsheet')`;
      const searchRes = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,shortcutDetails)&pageSize=10`,
        {},
        token
      );

      if (searchRes.ok) {
        const data = await searchRes.json();
        const files: any[] = data.files || [];
        const alreadyExists = files.some(
          (f) =>
            f.id === targetFileId ||
            f.shortcutDetails?.targetId === targetFileId ||
            f.name === shortcutName
        );
        if (alreadyExists) {
          return true;
        }
      }

      const createRes = await fetchGoogleApiWithRetry(
        'https://www.googleapis.com/drive/v3/files?fields=id,name',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: shortcutName,
            mimeType: 'application/vnd.google-apps.shortcut',
            parents: [parentFolderId],
            shortcutDetails: {
              targetId: targetFileId,
            },
          }),
        },
        token
      );
      return createRes.ok;
    } catch (err) {
      console.warn(`Notice creating shortcut "${shortcutName}" in folder ${parentFolderId}:`, err);
      return false;
    }
  },

  /**
   * Move a file into a specific Google Drive folder
   */
  async moveFileToFolder(fileId: string, folderId: string, providedToken?: string): Promise<boolean> {
    const token = providedToken || getCachedAccessToken();
    if (!token || !isRealDriveFolderId(fileId) || !isRealDriveFolderId(folderId)) return false;

    try {
      // 1. Get current parents
      const getRes = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
        {},
        token
      );
      let previousParents = '';
      if (getRes.ok) {
        const fileInfo = await getRes.json();
        if (fileInfo.parents && fileInfo.parents.includes(folderId)) {
          return true; // Already in target folder
        }
        previousParents = (fileInfo.parents || []).join(',');
      }

      // 2. Move to target folder
      let url = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${folderId}&fields=id,parents`;
      if (previousParents) {
        url += `&removeParents=${encodeURIComponent(previousParents)}`;
      }

      const patchRes = await fetchGoogleApiWithRetry(
        url,
        {
          method: 'PATCH',
        },
        token
      );

      return patchRes.ok;
    } catch (err) {
      console.warn(`Error moving file ${fileId} to folder ${folderId}:`, err);
      return false;
    }
  },

  /**
   * Set up full Course Folder Structure in Google Drive:
   * Main Folder: "[Nombre del curso] por Docenc.ia"
   *   ├── Subcarpeta: "Calificaciones"
   *   ├── Subcarpeta: "Asistencia"
   *   ├── Subcarpeta: "Disposición"
   *   ├── Subcarpeta: "Libro de Temas"
   *   ├── Subcarpeta: "Informes"
   *   └── Subcarpeta: "Historial de Incidencias"
   */
  async setupCourseFolderStructure(
    courseName: string,
    existingFolderId?: string,
    providedToken?: string
  ): Promise<CourseFolderStructure> {
    const rawCourseName = (courseName || 'Curso').trim();
    const mainFolderName = formatCourseDriveFolderName(rawCourseName);
    const cacheKey = mainFolderName.toLowerCase();

    const cached = courseFolderStructureCache.get(cacheKey);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      isRealDriveFolderId(cached.structure.mainFolder.id) &&
      isRealDriveFolderId(cached.structure.gradesFolder.id)
    ) {
      return cached.structure;
    }

    let token = providedToken || getCachedAccessToken();
    if (!token) {
      try {
        token = await requestGoogleAccessToken();
      } catch {}
    }

    let mainFolder: { id: string; name: string; url: string } | null = null;

    // 1. Check if existingFolderId is a valid Google Drive folder
    if (isRealDriveFolderId(existingFolderId)) {
      if (token) {
        try {
          const checkRes = await fetchGoogleApiWithRetry(
            `https://www.googleapis.com/drive/v3/files/${existingFolderId}?fields=id,name,webViewLink,trashed,parents`,
            {},
            token
          );
          if (checkRes.ok) {
            const data = await checkRes.json();
            if (!data.trashed) {
              const SubfolderNames = [
                'calificaciones',
                'asistencia',
                'disposición',
                'disposicion',
                'libro de temas',
                'informes',
                'historial de incidencias',
              ];
              const isActuallySubfolder =
                SubfolderNames.includes((data.name || '').trim().toLowerCase()) &&
                Array.isArray(data.parents) &&
                data.parents.length > 0;

              if (isActuallySubfolder) {
                // If a subfolder ID was accidentally passed as existingFolderId, resolve its parent main course folder!
                const parentId = data.parents[0];
                const parentRes = await fetchGoogleApiWithRetry(
                  `https://www.googleapis.com/drive/v3/files/${parentId}?fields=id,name,webViewLink,trashed`,
                  {},
                  token
                );
                if (parentRes.ok) {
                  const parentData = await parentRes.json();
                  if (!parentData.trashed) {
                    mainFolder = {
                      id: parentData.id,
                      name: parentData.name || mainFolderName,
                      url: getDirectDriveFolderUrl(parentData.id, parentData.webViewLink),
                    };
                  }
                }
              } else {
                let resolvedName = data.name || mainFolderName;
                // Rename existing course folder to include "por Docenc.ia" if it doesn't have it yet
                if (!/por\s+docenc\.ia$/i.test(resolvedName.trim())) {
                  try {
                    const renameRes = await fetchGoogleApiWithRetry(
                      `https://www.googleapis.com/drive/v3/files/${data.id}?fields=id,name,webViewLink`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: mainFolderName }),
                      },
                      token
                    );
                    if (renameRes.ok) {
                      resolvedName = mainFolderName;
                    }
                  } catch {}
                }
                mainFolder = {
                  id: data.id,
                  name: resolvedName,
                  url: getDirectDriveFolderUrl(data.id, data.webViewLink),
                };
              }
            }
          }
        } catch {}
      } else {
        // Offline / no token: preserve real folder ID and direct URL rather than falling back to my-drive
        mainFolder = {
          id: existingFolderId!,
          name: mainFolderName,
          url: getDirectDriveFolderUrl(existingFolderId!),
        };
      }
    }

    // 2. If not resolved via existingFolderId, look for "[Nombre del curso] por Docenc.ia" or legacy "[Nombre del curso]" in Drive
    if (!mainFolder) {
      if (token) {
        try {
          const safeMainName = mainFolderName.replace(/'/g, "\\'");
          const safeRawName = rawCourseName.replace(/'/g, "\\'");
          const searchQuery = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and (name = '${safeMainName}' or name = '${safeRawName}')`;
          const searchRes = await fetchGoogleApiWithRetry(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQuery)}&fields=files(id,name,webViewLink)&pageSize=5`,
            {},
            token
          );
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            const files: any[] = searchData.files || [];
            const exactNew = files.find((f) => f.name === mainFolderName);
            const matchedFolder = exactNew || files[0];
            if (matchedFolder) {
              let resolvedName = matchedFolder.name;
              if (resolvedName !== mainFolderName) {
                try {
                  const renameRes = await fetchGoogleApiWithRetry(
                    `https://www.googleapis.com/drive/v3/files/${matchedFolder.id}?fields=id,name,webViewLink`,
                    {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: mainFolderName }),
                    },
                    token
                  );
                  if (renameRes.ok) {
                    resolvedName = mainFolderName;
                  }
                } catch {}
              }
              mainFolder = {
                id: matchedFolder.id,
                name: resolvedName,
                url: getDirectDriveFolderUrl(matchedFolder.id, matchedFolder.webViewLink),
              };
            }
          }
        } catch {}
      }

      if (!mainFolder) {
        mainFolder = await this.findOrCreateFolder(mainFolderName, undefined, token, true);
      }
    }

    // 3. Create or find the 6 main subfolders inside the main course folder in parallel:
    // Calificaciones, Asistencia, Disposición, Libro de Temas, Informes, Historial de Incidencias
    const [
      gradesFolder,
      attendanceFolder,
      dispositionFolder,
      libroDeTemasFolder,
      reportsFolder,
      incidentsFolder,
    ] = await Promise.all([
      this.findOrCreateFolder('Calificaciones', mainFolder.id, token, true),
      this.findOrCreateFolder('Asistencia', mainFolder.id, token, true),
      this.findOrCreateFolder('Disposición', mainFolder.id, token, true),
      this.findOrCreateFolder('Libro de Temas', mainFolder.id, token, true),
      this.findOrCreateFolder('Informes', mainFolder.id, token, true),
      this.findOrCreateFolder('Historial de Incidencias', mainFolder.id, token, true),
    ]);

    const resultStructure: CourseFolderStructure = {
      mainFolder,
      gradesFolder,
      attendanceFolder,
      dispositionFolder,
      libroDeTemasFolder,
      reportsFolder,
      incidentsFolder,
    };

    if (isRealDriveFolderId(mainFolder.id) && isRealDriveFolderId(gradesFolder.id)) {
      courseFolderStructureCache.set(cacheKey, {
        structure: resultStructure,
        expiresAt: Date.now() + 90_000,
      });
    }

    return resultStructure;
  },

  /**
   * Resolve the specific category subfolder for a course (creating the course folder and 6 subfolders if needed)
   */
  async getCategorySubfolder(
    courseName: string,
    category: CourseDriveCategory,
    existingMainFolderId?: string,
    providedToken?: string
  ): Promise<{ id: string; name: string; url: string; structure: CourseFolderStructure }> {
    const structure = await this.setupCourseFolderStructure(
      courseName,
      existingMainFolderId,
      providedToken
    );
    const map: Record<CourseDriveCategory, { id: string; name: string; url: string }> = {
      Calificaciones: structure.gradesFolder,
      Asistencia: structure.attendanceFolder,
      Disposición: structure.dispositionFolder,
      'Libro de Temas': structure.libroDeTemasFolder,
      Informes: structure.reportsFolder,
      'Historial de Incidencias': structure.incidentsFolder,
    };
    const folder = map[category] || structure.mainFolder;
    return {
      ...folder,
      structure,
    };
  },

  /**
   * Upload any generated file (Excel .xlsx, CSV, HTML, PDF/printout, or native Google Doc/Sheet)
   * directly into the corresponding category subfolder inside "[Nombre del curso] por Docenc.ia".
   */
  async uploadFileToCourseCategory(options: {
    courseName: string;
    category: CourseDriveCategory;
    fileName: string;
    content: string | ArrayBuffer | Uint8Array;
    mimeType: string;
    existingMainFolderId?: string;
    convertToGoogleFormat?: 'doc' | 'sheet' | false;
    alsoShortcutInCategories?: CourseDriveCategory[];
    providedToken?: string;
    overwriteMode?: 'overwrite' | 'create_new';
    overwriteFileId?: string;
  }): Promise<{
    id: string;
    name: string;
    url: string;
    folderId: string;
    folderUrl: string;
    isLiveGoogle: boolean;
    overwritten?: boolean;
  } | null> {
    const consumedPolicy = nextUploadOverwritePolicy;
    nextUploadOverwritePolicy = null;

    const effectiveOverwriteMode = options.overwriteMode || consumedPolicy?.mode || 'create_new';
    let effectiveOverwriteFileId = options.overwriteFileId || consumedPolicy?.targetFileId;

    let token = options.providedToken || getCachedAccessToken();
    if (!token) {
      try {
        token = await requestGoogleAccessToken();
      } catch {}
    }
    if (!token) return null;

    try {
      const { id: targetFolderId, url: targetFolderUrl, structure } =
        await this.getCategorySubfolder(
          options.courseName,
          options.category,
          options.existingMainFolderId,
          token
        );

      if (!isRealDriveFolderId(targetFolderId)) {
        return null;
      }

      let targetMimeType = options.mimeType;
      let finalName = options.fileName;
      if (options.convertToGoogleFormat === 'doc') {
        targetMimeType = 'application/vnd.google-apps.document';
        finalName = finalName.replace(/\.(html|htm|doc|docx)$/i, '');
      } else if (options.convertToGoogleFormat === 'sheet') {
        targetMimeType = 'application/vnd.google-apps.spreadsheet';
        finalName = finalName.replace(/\.(csv|xlsx|xls)$/i, '');
      }

      if (effectiveOverwriteMode === 'overwrite' && !isRealDriveFolderId(effectiveOverwriteFileId)) {
        try {
          const query = `'${targetFolderId}' in parents and mimeType = '${targetMimeType}' and trashed = false`;
          const findRes = await fetchGoogleApiWithRetry(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
              query
            )}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,name)`,
            {},
            token
          );
          if (findRes.ok) {
            const findData = await findRes.json();
            if (Array.isArray(findData.files) && findData.files.length > 0) {
              effectiveOverwriteFileId = findData.files[0].id;
            }
          }
        } catch {}
      }

      const boundary = '-------314159265358979323846';
      const delimiter = '\r\n--' + boundary + '\r\n';
      const closeDelim = '\r\n--' + boundary + '--';

      const isBinary =
        typeof options.content !== 'string' &&
        (options.content instanceof ArrayBuffer || options.content instanceof Uint8Array);

      const bodyPart = isBinary
        ? `Content-Type: ${options.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
          arrayBufferToBase64(options.content as ArrayBuffer | Uint8Array)
        : `Content-Type: ${options.mimeType}; charset=UTF-8\r\n\r\n` + (options.content as string);

      let res: Response | null = null;
      let wasOverwritten = false;

      if (effectiveOverwriteMode === 'overwrite' && isRealDriveFolderId(effectiveOverwriteFileId)) {
        const patchMetadata: any = {
          name: finalName,
          mimeType: targetMimeType,
        };
        const patchBody =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(patchMetadata) +
          delimiter +
          bodyPart +
          closeDelim;

        const patchRes = await fetchGoogleApiWithRetry(
          `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
            effectiveOverwriteFileId!
          )}?uploadType=multipart&fields=id,name,webViewLink`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: patchBody,
          },
          token
        );

        if (patchRes.ok) {
          res = patchRes;
          wasOverwritten = true;
        }
      }

      if (!res) {
        const postMetadata: any = {
          name: finalName,
          mimeType: targetMimeType,
          parents: [targetFolderId],
        };
        const multipartRequestBody =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(postMetadata) +
          delimiter +
          bodyPart +
          closeDelim;

        res = await fetchGoogleApiWithRetry(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
          {
            method: 'POST',
            headers: {
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartRequestBody,
          },
          token
        );
      }

      if (res.ok) {
        const data = await res.json();
        const fileId = data.id;
        const liveUrl =
          data.webViewLink ||
          (options.convertToGoogleFormat === 'doc'
            ? `https://docs.google.com/document/d/${fileId}/edit`
            : options.convertToGoogleFormat === 'sheet'
            ? `https://docs.google.com/spreadsheets/d/${fileId}/edit`
            : `https://drive.google.com/file/d/${fileId}/view`);

        writeSavedDriveRegistryEntry({
          id: fileId,
          name: data.name || finalName,
          url: liveUrl,
          courseName: options.courseName,
          category: options.category,
          mimeType: targetMimeType,
          updatedAt: new Date().toISOString(),
        });

        if (options.alsoShortcutInCategories && options.alsoShortcutInCategories.length > 0) {
          const catMap: Record<CourseDriveCategory, string> = {
            Calificaciones: structure.gradesFolder.id,
            Asistencia: structure.attendanceFolder.id,
            Disposición: structure.dispositionFolder.id,
            'Libro de Temas': structure.libroDeTemasFolder.id,
            Informes: structure.reportsFolder.id,
            'Historial de Incidencias': structure.incidentsFolder.id,
          };
          for (const extraCat of options.alsoShortcutInCategories) {
            const extraFolderId = catMap[extraCat];
            if (extraFolderId && extraFolderId !== targetFolderId) {
              this.ensureShortcutInFolder(finalName, fileId, extraFolderId, token).catch(() => {});
            }
          }
        }

        return {
          id: fileId,
          name: data.name || finalName,
          url: liveUrl,
          folderId: targetFolderId,
          folderUrl: targetFolderUrl,
          isLiveGoogle: true,
          overwritten: wasOverwritten,
        };
      }
    } catch (err) {
      console.warn(`Notice uploading file "${options.fileName}" to category "${options.category}":`, err);
    }
    return null;
  },

  /**
   * List files from teacher's Google Drive folder
   */
  async listFiles(folderId?: string): Promise<DriveResource[]> {
    const token = getCachedAccessToken();
    if (token) {
      try {
        let query = "trashed = false";
        if (folderId && isRealDriveFolderId(folderId)) {
          query += ` and '${folderId}' in parents`;
        }
        const res = await fetchGoogleApiWithRetry(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`,
          {},
          token
        );
        if (res.ok) {
          const data = await res.json();
          return (data.files || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            type: f.mimeType.includes('spreadsheet') ? 'sheet' : f.mimeType.includes('document') ? 'doc' : f.mimeType.includes('presentation') ? 'slide' : 'pdf',
            size: f.size ? `${(parseInt(f.size) / 1024).toFixed(0)} KB` : '450 KB',
            folder: folderId || 'Drive Docente',
            modifiedTime: f.modifiedTime,
            googleDriveUrl: f.webViewLink || `https://drive.google.com/open?id=${f.id}`,
            sharedWithClassroom: false,
          }));
        }
      } catch (err) {
        console.warn('Live Google Drive fetch error, falling back to local files:', err);
      }
    }

    // Fallback to local server files
    const res = await fetch('/api/drive/files');
    const data = await res.json();
    return data.files;
  },

  /**
   * Search for an existing Google Spreadsheet file associated with a course or inside its folder
   * Optionally filter by function typeKeyword ('Asistencia', 'Calificaciones', 'Libro de Temas')
   */
  async findCourseSpreadsheet(
    folderId?: string,
    courseName?: string,
    providedToken?: string,
    typeKeyword?: string
  ): Promise<{ id: string; name: string; url: string } | null> {
    const token = providedToken || getCachedAccessToken();
    if (!token) return null;

    const runQuery = async (q: string) => {
      const searchRes = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&orderBy=modifiedTime desc&pageSize=5`,
        {},
        token
      );
      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.files && data.files.length > 0) {
          const file = data.files[0];
          return {
            id: file.id,
            name: file.name,
            url: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`,
          };
        }
      }
      return null;
    };

    try {
      const baseQuery = "mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
      const typeClause = typeKeyword
        ? ` and name contains '${typeKeyword.replace(/'/g, "\\'")}'`
        : '';

      // 1. Search inside specific folderId if provided
      if (isRealDriveFolderId(folderId)) {
        const byFolder = await runQuery(`${baseQuery} and '${folderId}' in parents${typeClause}`);
        if (byFolder) return byFolder;
      }

      // 2. Fallback: search by courseName + typeKeyword across Drive (handles files moved into subfolders)
      if (courseName) {
        const cleanCourse = courseName.replace(/por\s+docenc\.ia$/i, '').trim();
        const safeName = cleanCourse.replace(/'/g, "\\'");
        const byName = await runQuery(`${baseQuery} and name contains '${safeName}'${typeClause}`);
        if (byName) return byName;
      }
    } catch (err) {
      console.warn('Notice searching for course spreadsheet in Drive:', err);
    }
    return null;
  },

  /**
   * List existing Google Spreadsheets (and optionally Google Docs and Google Forms) from the teacher's Google Drive
   * so they can import grades or disposition from any existing sheet, document, or form.
   */
  async listUserSpreadsheets(
    searchQuery?: string,
    providedToken?: string,
    includeDocs: boolean = true,
    interactive: boolean = false
  ): Promise<
    Array<{
      id: string;
      name: string;
      modifiedTime?: string;
      url: string;
      mimeType?: string;
      docType?: 'sheet' | 'doc' | 'form';
    }>
  > {
    let token = providedToken || getCachedAccessToken();
    if (!token) {
      try {
        token = await requestGoogleAccessToken(interactive);
      } catch {}
    }
    if (!token) return [];

    try {
      const mimeFilter = includeDocs
        ? "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.form')"
        : "mimeType = 'application/vnd.google-apps.spreadsheet'";
      let query = `${mimeFilter} and trashed = false`;
      if (searchQuery && searchQuery.trim()) {
        const safeQ = searchQuery.trim().replace(/'/g, "\\'");
        query += ` and name contains '${safeQ}'`;
      }
      const res = await fetchGoogleApiWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=35`,
        {},
        token
      );
      if (res.ok) {
        const data = await res.json();
        return (data.files || []).map((f: any) => {
          const mime = String(f.mimeType || '');
          const isDoc = mime.includes('document');
          const isForm = mime.includes('form');
          const docType: 'sheet' | 'doc' | 'form' = isForm ? 'form' : isDoc ? 'doc' : 'sheet';
          return {
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            docType,
            modifiedTime: f.modifiedTime,
            url:
              f.webViewLink ||
              (isForm
                ? `https://docs.google.com/forms/d/${f.id}/edit`
                : isDoc
                ? `https://docs.google.com/document/d/${f.id}/edit`
                : `https://docs.google.com/spreadsheets/d/${f.id}/edit`),
          };
        });
      }
    } catch (err) {
      console.warn('Error listing spreadsheets/documents from Google Drive:', err);
    }
    return [];
  },

  /**
   * Export a Google Doc (by document ID) as HTML or plain text so its tables/lines can be parsed
   * into rows of student names and disposition/grade scores.
   */
  async exportGoogleDocContent(
    docId: string,
    providedToken?: string
  ): Promise<{ title: string; html?: string; text?: string } | null> {
    const cleanId = docId.trim();
    if (!cleanId) return null;

    let token = providedToken || getCachedAccessToken();
    if (!token) {
      try {
        token = await requestGoogleAccessToken();
      } catch {}
    }

    let title = 'Documento de Google Docs';

    if (token) {
      try {
        const metaRes = await fetchGoogleApiWithRetry(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}?fields=id,name,mimeType`,
          {},
          token
        );
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta.name) title = meta.name;
        }

        const activeTok = getCachedAccessToken() || token;
        const htmlRes = await fetchGoogleApiWithRetry(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}/export?mimeType=text/html`,
          {},
          activeTok
        );
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          return { title, html };
        }

        const txtRes = await fetchGoogleApiWithRetry(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cleanId)}/export?mimeType=text/plain`,
          {},
          activeTok
        );
        if (txtRes.ok) {
          const text = await txtRes.text();
          return { title, text };
        }
      } catch (err) {
        console.warn('Error exporting Google Doc via Drive API:', err);
      }
    }

    // Fallback 1: Server-side proxy (bypasses browser CORS on docs.google.com)
    try {
      const proxyRes = await fetch('/api/workspace/fetch-remote-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `https://docs.google.com/document/d/${encodeURIComponent(cleanId)}/edit`,
        }),
      });
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        if (proxyData?.ok && (proxyData.html || proxyData.text)) {
          return {
            title: proxyData.title || title,
            html: proxyData.html,
            text: proxyData.text,
          };
        }
      }
    } catch {}

    // Fallback 2: Direct browser fetch for public/link-shared Google Docs
    try {
      const pubTxtRes = await fetch(
        `https://docs.google.com/document/d/${encodeURIComponent(cleanId)}/export?format=txt`
      );
      if (pubTxtRes.ok) {
        const text = await pubTxtRes.text();
        if (text && !text.trim().startsWith('<!DOCTYPE html')) {
          return { title, text };
        }
      }
    } catch {}

    return null;
  },

  /**
   * Create a dedicated course folder in Google Drive
   */
  async createCourseFolder(courseName: string): Promise<{ id: string; name: string; url: string }> {
    const folderTitle = formatCourseDriveFolderName(courseName);
    return this.findOrCreateFolder(folderTitle);
  },

  /**
   * Alias for setupCourseFolderStructure so all modules can ensure the course folder structure exists
   */
  async ensureCourseFolderStructure(
    courseName: string,
    _courseId?: string,
    existingFolderId?: string,
    providedToken?: string
  ): Promise<CourseFolderStructure> {
    return this.setupCourseFolderStructure(courseName, existingFolderId, providedToken);
  },

  /**
   * Upload a generated document or HTML report to a Google Drive course folder.
   * When convertToGoogleDoc is true (default), Google Drive converts the rich HTML
   * into a native, fully editable Google Doc (.gdoc) in the user's Drive.
   */
  async uploadReportFile(
    fileName: string,
    content: string,
    folderId?: string,
    mimeTypeOrConvert: string | boolean = 'text/html',
    providedToken?: string,
    convertToGoogleDoc: boolean = true
  ): Promise<{ id: string; name: string; url: string; webViewLink: string; isLiveGoogle: boolean; isGoogleDoc?: boolean }> {
    const resolvedMimeType = typeof mimeTypeOrConvert === 'string' ? mimeTypeOrConvert : 'text/html';
    const resolvedConvert = typeof mimeTypeOrConvert === 'boolean' ? mimeTypeOrConvert : convertToGoogleDoc;

    let token = providedToken || getCachedAccessToken();
    if (!token) {
      try {
        token = await requestGoogleAccessToken();
      } catch {}
    }

    const cleanDocName = resolvedConvert ? fileName.replace(/\.html$/i, '') : fileName;

    if (token) {
      try {
        const metadata: any = {
          name: cleanDocName,
          mimeType: resolvedConvert ? 'application/vnd.google-apps.document' : resolvedMimeType,
        };
        if (
          folderId &&
          !folderId.startsWith('folder-') &&
          !folderId.startsWith('f-') &&
          !folderId.includes('/')
        ) {
          metadata.parents = [folderId];
        }

        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const multipartRequestBody =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(metadata) +
          delimiter +
          `Content-Type: ${resolvedMimeType}; charset=UTF-8\r\n\r\n` +
          content +
          close_delim;

        const res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: multipartRequestBody,
          }
        );

        if (res.ok) {
          const data = await res.json();
          const liveUrl = resolvedConvert
            ? data.webViewLink || `https://docs.google.com/document/d/${data.id}/edit`
            : data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;

          // Also register in local server drive resources
          try {
            await fetch('/api/drive/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: cleanDocName,
                type: 'doc',
                folder: folderId || 'Informes y Reportes',
              }),
            });
          } catch {}

          return {
            id: data.id,
            name: data.name || cleanDocName,
            url: liveUrl,
            webViewLink: liveUrl,
            isLiveGoogle: true,
            isGoogleDoc: resolvedConvert,
          };
        } else {
          const errText = await res.text();
          console.warn('Google Drive report upload API response not OK:', res.status, errText);
        }
      } catch (err) {
        console.warn('Error uploading report file to Google Drive:', err);
      }
    }

    // Fallback: register in local server resources
    try {
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanDocName,
          type: 'doc',
          folder: folderId || 'Informes y Reportes',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          id: data.file.id,
          name: data.file.name,
          url: data.file.googleDriveUrl,
          webViewLink: data.file.googleDriveUrl,
          isLiveGoogle: false,
          isGoogleDoc: resolvedConvert,
        };
      }
    } catch {}

    const fallbackId = `report-${Date.now()}`;
    const fallbackUrl = 'https://drive.google.com/drive/u/0/my-drive';
    return {
      id: fallbackId,
      name: cleanDocName,
      url: fallbackUrl,
      webViewLink: fallbackUrl,
      isLiveGoogle: false,
      isGoogleDoc: resolvedConvert,
    };
  },
};

