/**
 * Google Drive Integration Service
 * Endpoint: https://www.googleapis.com/drive/v3/files
 * Scope: https://www.googleapis.com/auth/drive.file
 */

import { getCachedAccessToken } from './googleAuth';
import { DriveResource } from '../../types';

export interface CourseFolderStructure {
  mainFolder: { id: string; name: string; url: string };
  attendanceFolder: { id: string; name: string; url: string };
  gradesFolder: { id: string; name: string; url: string };
}

export const driveService = {
  /**
   * Find or create a folder in Google Drive (optionally inside a parent folder)
   */
  async findOrCreateFolder(folderName: string, parentFolderId?: string): Promise<{ id: string; name: string; url: string }> {
    const token = getCachedAccessToken();
    if (!token) {
      const fallbackId = `folder-${Date.now().toString().slice(-4)}`;
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
      if (parentFolderId) {
        query += ` and '${parentFolderId}' in parents`;
      }

      // Check if folder already exists
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink)&pageSize=1`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          const existing = searchData.files[0];
          return {
            id: existing.id,
            name: existing.name,
            url: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
          };
        }
      }

      // Create new folder if not found
      const metadata: any = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (parentFolderId) {
        metadata.parents = [parentFolderId];
      }

      const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      });

      if (createRes.ok) {
        const data = await createRes.json();
        return {
          id: data.id,
          name: data.name,
          url: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
        };
      }
    } catch (err) {
      console.warn(`Error in findOrCreateFolder for "${folderName}":`, err);
    }

    const fallbackId = `folder-${Date.now().toString().slice(-4)}`;
    return {
      id: fallbackId,
      name: folderName,
      url: 'https://drive.google.com/drive/u/0/my-drive',
    };
  },

  /**
   * Move a file into a specific Google Drive folder
   */
  async moveFileToFolder(fileId: string, folderId: string): Promise<boolean> {
    const token = getCachedAccessToken();
    if (!token || !fileId || !folderId) return false;

    try {
      // 1. Get current parents
      const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
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

      const patchRes = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });

      return patchRes.ok;
    } catch (err) {
      console.warn(`Error moving file ${fileId} to folder ${folderId}:`, err);
      return false;
    }
  },

  /**
   * Set up full Course Folder Structure in Google Drive:
   * Main Folder: [Nombre de la Materia]
   *   ├── Subfolder 1: "Asistencia y Disposición"
   *   └── Subfolder 2: "Calificaciones"
   */
  async setupCourseFolderStructure(
    courseName: string,
    existingFolderId?: string
  ): Promise<CourseFolderStructure> {
    const mainFolderName = courseName.trim();
    let mainFolder: { id: string; name: string; url: string };

    if (existingFolderId && !existingFolderId.startsWith('folder-') && !existingFolderId.startsWith('f-')) {
      const token = getCachedAccessToken();
      if (token) {
        try {
          const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${existingFolderId}?fields=id,name,webViewLink,trashed`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (checkRes.ok) {
            const data = await checkRes.json();
            if (!data.trashed) {
              mainFolder = {
                id: data.id,
                name: data.name,
                url: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
              };
            } else {
              mainFolder = await this.findOrCreateFolder(mainFolderName);
            }
          } else {
            mainFolder = await this.findOrCreateFolder(mainFolderName);
          }
        } catch {
          mainFolder = await this.findOrCreateFolder(mainFolderName);
        }
      } else {
        mainFolder = await this.findOrCreateFolder(mainFolderName);
      }
    } else {
      mainFolder = await this.findOrCreateFolder(mainFolderName);
    }

    // Create subfolder 1: "Asistencia y Disposición" inside main folder
    const attendanceFolder = await this.findOrCreateFolder('Asistencia y Disposición', mainFolder.id);

    // Create subfolder 2: "Calificaciones" inside main folder
    const gradesFolder = await this.findOrCreateFolder('Calificaciones', mainFolder.id);

    return {
      mainFolder,
      attendanceFolder,
      gradesFolder,
    };
  },

  /**
   * List files from teacher's Google Drive folder
   */
  async listFiles(folderId?: string): Promise<DriveResource[]> {
    const token = getCachedAccessToken();
    if (token) {
      try {
        let query = "trashed = false";
        if (folderId) {
          query += ` and '${folderId}' in parents`;
        }
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size,modifiedTime,webViewLink)`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
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
   * Create a dedicated course folder in Google Drive
   */
  async createCourseFolder(courseName: string): Promise<{ id: string; name: string; url: string }> {
    const token = getCachedAccessToken();
    if (token) {
      const metadata = {
        name: `📚 ${courseName} - Materiales Docentes`,
        mimeType: 'application/vnd.google-apps.folder',
      };
      const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      });
      if (res.ok) {
        const data = await res.json();
        return {
          id: data.id,
          name: data.name,
          url: `https://drive.google.com/drive/folders/${data.id}`,
        };
      }
    }

    return {
      id: `folder-${Date.now().toString().slice(-4)}`,
      name: `📚 ${courseName} - Materiales Docentes`,
      url: 'https://drive.google.com/drive/u/0/my-drive',
    };
  },
};
