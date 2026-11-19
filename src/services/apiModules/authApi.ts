/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authentication & Session API client module.
 */

import { TeacherProfile } from '../../types';
import { firestoreSync } from '../firestoreSync';
import { getStoredSessionSecret, saveStoredSessionSecret } from '../expressAuthHeaders';
import { safeSetLocalStorageItem } from '../../utils/storageGuard';
import {
  canUseExpressBackend,
  computeClientPasswordDigest,
  fetchExpressJson,
} from './expressTransport';

export const authApi = {
  async getAuthUser(email?: string): Promise<{ authenticated: boolean; user: TeacherProfile; token?: string | null }> {
    const targetEmail = (email || '').trim().toLowerCase();
    const sessionSecret = getStoredSessionSecret();
    if (!targetEmail || !sessionSecret || !canUseExpressBackend(false)) {
      return { authenticated: false, user: null as any, token: null };
    }
    const data = await fetchExpressJson<{ authenticated: boolean; user: TeacherProfile; token?: string | null }>(
      `/api/auth/user?email=${encodeURIComponent(targetEmail)}`
    );
    return data || { authenticated: false, user: null as any, token: null };
  },

  async loginWithEmailCredentials(params: {
    email: string;
    password?: string;
    name?: string;
    token?: string;
  }): Promise<{ success: boolean; user: TeacherProfile; token?: string | null }> {
    const cleanEmail = params.email.trim().toLowerCase();
    const rawPassword = (params.password || '').trim();

    // 1. Verify against Express backend if available
    if (canUseExpressBackend(false)) {
      try {
        const res = await fetch('/api/auth/login-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: rawPassword,
            name: params.name,
            token: params.token,
          }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const payload = await res.json();
          if (!res.ok || payload?.success === false) {
            throw new Error(
              payload?.error ||
                'Contraseña incorrecta para esta cuenta docente. Verificá tu clave.'
            );
          }
          if (payload?.sessionSecret) {
            saveStoredSessionSecret(payload.sessionSecret);
          }
          if (typeof window !== 'undefined' && rawPassword) {
            try {
              const digest = await computeClientPasswordDigest(cleanEmail, rawPassword);
              const rawMap = localStorage.getItem('docencia_credentials_by_email');
              const map: Record<string, string> = rawMap ? JSON.parse(rawMap) : {};
              map[cleanEmail] = digest;
              safeSetLocalStorageItem('docencia_credentials_by_email', JSON.stringify(map));
            } catch (_) {}
          }
          return {
            success: true,
            user: payload.user,
            token: payload.token || null,
          };
        }
      } catch (err: any) {
        if (
          err?.message &&
          (err.message.includes('Contraseña') ||
            err.message.includes('contraseña') ||
            err.message.includes('clave'))
        ) {
          throw err;
        }
      }
    }

    // 2. Client-side / static fallback password verification
    if (typeof window !== 'undefined') {
      try {
        const rawMap = localStorage.getItem('docencia_credentials_by_email');
        const map: Record<string, string> = rawMap ? JSON.parse(rawMap) : {};
        if (map[cleanEmail]) {
          if (!rawPassword) {
            throw new Error('Esta cuenta tiene clave registrada. Por favor ingresá tu contraseña para continuar.');
          }
          const digest = await computeClientPasswordDigest(cleanEmail, rawPassword);
          if (map[cleanEmail] !== digest) {
            throw new Error('Contraseña incorrecta para esta cuenta docente. Verificá tu clave.');
          }
        } else if (rawPassword) {
          const digest = await computeClientPasswordDigest(cleanEmail, rawPassword);
          map[cleanEmail] = digest;
          safeSetLocalStorageItem('docencia_credentials_by_email', JSON.stringify(map));
        }
      } catch (err: any) {
        if (err?.message && (err.message.includes('Contraseña') || err.message.includes('clave'))) {
          throw err;
        }
      }
    }

    const synced = await authApi.syncAuthSession({
      uid: 'teacher_' + cleanEmail.replace(/[^a-zA-Z0-9]/g, '_'),
      email: cleanEmail,
      name: params.name || '',
      avatar: '',
      token: params.token,
    });
    return {
      success: true,
      user: synced.user,
      token: params.token || null,
    };
  },

  async syncAuthSession(userData: {
    uid: string;
    email: string;
    name: string;
    avatar: string;
    token?: string;
    scopes?: string[];
    school?: string;
  }): Promise<{ success: boolean; user: TeacherProfile; token?: string | null }> {
    // Persist teacher profile in Firestore globally across accounts
    firestoreSync
      .saveTeacherProfile({
        id: userData.uid,
        email: userData.email,
        name: userData.name,
        avatar: userData.avatar,
        school: userData.school,
      })
      .catch(() => {});

    if (canUseExpressBackend(false)) {
      const serverData = await fetchExpressJson<{
        success: boolean;
        user: TeacherProfile;
        sessionSecret?: string;
        token?: string | null;
      }>('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userData,
          sessionSecret: getStoredSessionSecret() || undefined,
        }),
      });
      if (serverData?.sessionSecret) {
        saveStoredSessionSecret(serverData.sessionSecret);
      }
      if (serverData?.user) return serverData;
    }

    // Graceful fallback profile to ensure user is never blocked
    const fallbackProfile: TeacherProfile = {
      id: userData.uid,
      email: userData.email,
      name: userData.name || 'Docente Titular',
      avatar: userData.avatar,
      role: 'Docente Titular',
      school: userData.school || 'Institución Educativa',
      scopes: userData.scopes || [],
      permissions: [
        'tasks.create',
        'tasks.assign',
        'tasks.grade',
        'tasks.delete',
        'drive.read',
        'drive.attach',
        'classroom.sync',
        'students.view',
        'grades.manage',
      ],
    };
    return { success: true, user: fallbackProfile, token: userData.token || null };
  },

  async logoutAuth(email?: string): Promise<void> {
    firestoreSync.clearMemoryCaches();
    if (canUseExpressBackend(false)) {
      await fetchExpressJson('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    }
    saveStoredSessionSecret(null);
  },

  async logoutAuthSession(email?: string): Promise<void> {
    return authApi.logoutAuth(email);
  },

  async getPermissions(): Promise<{ role: string; permissions: string[]; scopes: string[] }> {
    const res = await fetch('/api/auth/permissions');
    if (!res.ok) throw new Error('Error al consultar permisos');
    return res.json();
  },
};
