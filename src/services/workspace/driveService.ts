/**
 * Google Drive Integration Service
 * Endpoint: https://www.googleapis.com/drive/v3/files
 * Scope: https://www.googleapis.com/auth/drive.file
 */

import { getCachedAccessToken } from './googleAuth';
import { DriveResource } from '../../types';

export const driveService = {
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
