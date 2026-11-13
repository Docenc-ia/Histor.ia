/**
 * Google Forms API v1 Integration Service
 * Endpoints:
 * - https://forms.googleapis.com/v1/forms/{formId}
 * - https://forms.googleapis.com/v1/forms/{formId}/responses
 * Scopes:
 * - https://www.googleapis.com/auth/forms.body.readonly
 * - https://www.googleapis.com/auth/forms.responses.readonly
 */

import {
  getCachedAccessToken,
  requestGoogleAccessToken,
  fetchGoogleApiWithRetry,
  isValidGoogleAccessToken,
} from './googleAuth';
import { fetchArbitrarySpreadsheetDataHelper } from './sheetsHelpers';

export interface GoogleFormListItem {
  id: string;
  name: string;
  modifiedTime?: string;
  url: string;
}

export interface DirectGoogleFormDataResult {
  formId: string;
  title: string;
  maxScore: number;
  headers: string[];
  rows: Array<Record<string, any>>;
}

function normalizeFormTitle(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\(respuestas.*?\)/gi, '')
    .replace(/\(responses.*?\)/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const formsService = {
  /**
   * Extrae el identificador limpio de un formulario de Google Forms y detecta si el enlace
   * corresponde a una vista pública de respondedor (`/forms/d/e/.../viewform` o `forms.gle`) o al enlace de edición (`/forms/d/.../edit`).
   *
   * @param idOrUrl URL completa o ID directo del formulario de Google Forms.
   * @returns El identificador extraído (`formId`) y el indicador `isPublicResponderUrl`.
   */
  extractFormId(idOrUrl: string): { formId: string; isPublicResponderUrl: boolean } {
    const trimmed = String(idOrUrl || '').trim();
    if (!trimmed) {
      return { formId: '', isPublicResponderUrl: false };
    }

    if (/\/forms\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9_-]+)/i.test(trimmed)) {
      const m = trimmed.match(/\/forms\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9_-]+)/i);
      return {
        formId: m ? m[1] : trimmed,
        isPublicResponderUrl: true,
      };
    }

    if (/forms\.gle\//i.test(trimmed)) {
      return {
        formId: trimmed,
        isPublicResponderUrl: true,
      };
    }

    const match = trimmed.match(/\/forms\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return {
        formId: match[1],
        isPublicResponderUrl: false,
      };
    }

    return {
      formId: trimmed,
      isPublicResponderUrl: trimmed.startsWith('1FAIpQL'),
    };
  },

  /**
   * Lista los formularios de Google Forms disponibles en el Google Drive del docente autenticado.
   *
   * @param searchQuery Filtro opcional por nombre del formulario.
   * @param providedToken Token OAuth 2.0 explícito opcional.
   * @param interactive Si es `true`, permite solicitar autorización interactiva cuando no hay token en caché.
   * @returns Arreglo de formularios encontrados ordenados por fecha de modificación.
   */
  async listUserGoogleForms(
    searchQuery?: string,
    providedToken?: string,
    interactive = false
  ): Promise<GoogleFormListItem[]> {
    let token = providedToken || getCachedAccessToken();
    if (!token || !isValidGoogleAccessToken(token)) {
      try {
        token = await requestGoogleAccessToken(interactive);
      } catch {}
    }
    if (!token) return [];

    try {
      let q = "mimeType = 'application/vnd.google-apps.form' and trashed = false";
      if (searchQuery && searchQuery.trim()) {
        const safeQ = searchQuery.trim().replace(/'/g, "\\'");
        q += ` and name contains '${safeQ}'`;
      }

      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        q
      )}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=30`;

      const res = await fetchGoogleApiWithRetry(url, {}, token);
      if (!res.ok) return [];

      const data = await res.json();
      return (data.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime,
        url: f.webViewLink || `https://docs.google.com/forms/d/${f.id}/edit`,
      }));
    } catch {
      return [];
    }
  },

  /**
   * Resuelve un enlace público de respondedor (`/forms/d/e/1FAIpQL.../viewform` o `forms.gle/...`)
   * hacia el ID de edición real del formulario o hacia su planilla de respuestas vinculada en Google Drive.
   * La API de Google Forms v1 no acepta el ID público `1FAIpQL...`, por lo que es necesario cruzar el `responderUri` o el título contra el Drive del docente.
   *
   * @param rawInputUrl URL pública ingresada por el docente.
   * @param responderIdHint ID de respondedor extraído de la URL.
   * @param token Token OAuth 2.0 activo del docente.
   * @returns Referencia al formulario (`kind: 'form'`) o planilla de respuestas (`kind: 'sheet'`), o `null` si no se halló coincidencia.
   */
  async resolvePublicResponderForm(
    rawInputUrl: string,
    responderIdHint: string,
    token: string
  ): Promise<
    | { kind: 'form'; formId: string; preloadedFormData?: any }
    | { kind: 'sheet'; spreadsheetId: string; title: string }
    | null
  > {
    let extractedTitle = '';
    let resolvedResponderId = responderIdHint;

    try {
      const proxyRes = await fetch('/api/workspace/fetch-remote-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: rawInputUrl.startsWith('http')
            ? rawInputUrl
            : `https://docs.google.com/forms/d/e/${encodeURIComponent(responderIdHint)}/viewform`,
        }),
      });
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        if (proxyData?.ok) {
          if (proxyData.formId && !proxyData.responderId) {
            return { kind: 'form', formId: proxyData.formId };
          }
          if (proxyData.responderId) {
            resolvedResponderId = proxyData.responderId;
          }
          if (
            proxyData.title &&
            proxyData.title !== 'Evaluación de Google Forms' &&
            proxyData.title !== 'Google Forms'
          ) {
            extractedTitle = String(proxyData.title).trim();
          }
        }
      }
    } catch {}

    const normTargetTitle = normalizeFormTitle(extractedTitle);

    try {
      const [matchingForms, recentForms] = await Promise.all([
        extractedTitle ? this.listUserGoogleForms(extractedTitle, token) : Promise.resolve([]),
        this.listUserGoogleForms(undefined, token),
      ]);

      const seenIds = new Set<string>();
      const candidateForms: GoogleFormListItem[] = [];
      for (const f of [...matchingForms, ...recentForms]) {
        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          candidateForms.push(f);
        }
      }

      if (normTargetTitle) {
        candidateForms.sort((a, b) => {
          const aMatch = normalizeFormTitle(a.name) === normTargetTitle ? 0 : 1;
          const bMatch = normalizeFormTitle(b.name) === normTargetTitle ? 0 : 1;
          return aMatch - bMatch;
        });
      }

      const toInspect = candidateForms.slice(0, 12);
      for (const cand of toInspect) {
        try {
          const fRes = await fetchGoogleApiWithRetry(
            `https://forms.googleapis.com/v1/forms/${encodeURIComponent(cand.id)}`,
            {},
            token
          );
          if (fRes.ok) {
            const fData = await fRes.json();
            const respUri = String(fData?.responderUri || '');
            const fTitle = normalizeFormTitle(
              fData?.info?.title || fData?.info?.documentTitle || cand.name
            );
            if (
              (resolvedResponderId && respUri.includes(resolvedResponderId)) ||
              (normTargetTitle && fTitle && fTitle === normTargetTitle)
            ) {
              return { kind: 'form', formId: cand.id, preloadedFormData: fData };
            }
          }
        } catch {}
      }
    } catch {}

    try {
      const queries: string[] = [];
      if (extractedTitle) {
        const safeTitle = extractedTitle.replace(/'/g, "\\'");
        queries.push(
          `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and name contains '${safeTitle}'`
        );
      }
      queries.push(
        `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false and (name contains 'Respuestas' or name contains 'Responses' or name contains 'Formulario')`
      );

      for (const q of queries) {
        const sRes = await fetchGoogleApiWithRetry(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
            q
          )}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`,
          {},
          token
        );
        if (sRes.ok) {
          const sData = await sRes.json();
          const files: any[] = sData.files || [];
          if (files.length > 0) {
            if (normTargetTitle) {
              const exactSheet = files.find((f) => {
                const n = normalizeFormTitle(f.name);
                return n === normTargetTitle || n.includes(normTargetTitle) || normTargetTitle.includes(n);
              });
              if (exactSheet) {
                return { kind: 'sheet', spreadsheetId: exactSheet.id, title: exactSheet.name };
              }
            } else {
              return { kind: 'sheet', spreadsheetId: files[0].id, title: files[0].name };
            }
          }
        }
      }
    } catch {}

    return null;
  },

  /**
   * Descarga la estructura y las entregas de un formulario mediante Google Forms API v1
   * (o su hoja de cálculo vinculada como respaldo), reconstruyendo los puntajes totales por alumno.
   *
   * @param idOrUrl Enlace o ID del formulario de Google Forms.
   * @param providedToken Token OAuth 2.0 explícito opcional.
   * @returns Objeto `DirectGoogleFormDataResult` con título, puntaje máximo, encabezados y filas de respuestas.
   * @throws {Error} Si el enlace es inválido, faltan permisos o el formulario no registra entregas.
   */
  async fetchGoogleFormEvaluations(
    idOrUrl: string,
    providedToken?: string
  ): Promise<DirectGoogleFormDataResult> {
    const extracted = this.extractFormId(idOrUrl);
    let formId = extracted.formId;
    const isPublicResponderUrl = extracted.isPublicResponderUrl;

    if (!formId) {
      throw new Error('Ingresa un enlace o ID válido de Google Forms.');
    }

    let token = providedToken || getCachedAccessToken();
    if (!token || !isValidGoogleAccessToken(token)) {
      token = await requestGoogleAccessToken(true);
    }
    if (!token || !isValidGoogleAccessToken(token)) {
      throw new Error(
        'Para cargar las respuestas de Google Forms, inicia sesión con tu cuenta de Google cuando se abra la ventana de autorización.'
      );
    }

    let preloadedFormData: any = null;

    if (isPublicResponderUrl) {
      const resolved = await this.resolvePublicResponderForm(idOrUrl, formId, token);
      if (resolved?.kind === 'sheet') {
        const sheetData = await fetchArbitrarySpreadsheetDataHelper(
          resolved.spreadsheetId,
          undefined,
          token
        );
        return {
          formId: resolved.spreadsheetId,
          title: sheetData.title || resolved.title,
          maxScore: 10,
          headers: sheetData.headers,
          rows: sheetData.rows,
        };
      }
      if (resolved?.kind === 'form') {
        formId = resolved.formId;
        preloadedFormData = resolved.preloadedFormData || null;
      } else {
        throw new Error(
          'Pegaste el enlace de vista pública (/forms/d/e/.../viewform) y no encontramos ese formulario ni su planilla de respuestas en tu Google Drive. Pegá el enlace de edición del formulario (docs.google.com/forms/d/.../edit) o el de su hoja de respuestas.'
        );
      }
    }

    const safeFormId = encodeURIComponent(formId.trim());

    let formData = preloadedFormData;
    if (!formData) {
      const formRes = await fetchGoogleApiWithRetry(
        `https://forms.googleapis.com/v1/forms/${safeFormId}`,
        {},
        token
      );

      if (!formRes.ok) {
        // Si el usuario pegó por error el ID de una hoja de respuestas de Google Sheets en el buscador de Forms, se intenta leer como planilla antes de fallar.
        try {
          const sheetFallback = await fetchArbitrarySpreadsheetDataHelper(formId, undefined, token);
          if (sheetFallback.rows.length > 0 && sheetFallback.headers.length > 0) {
            return {
              formId: sheetFallback.spreadsheetId,
              title: sheetFallback.title,
              maxScore: 10,
              headers: sheetFallback.headers,
              rows: sheetFallback.rows,
            };
          }
        } catch {}

        if (formRes.status === 401 || formRes.status === 403) {
          const freshToken = await requestGoogleAccessToken(true);
          if (freshToken && freshToken !== token) {
            return this.fetchGoogleFormEvaluations(idOrUrl, freshToken);
          }
          throw new Error(
            'No tienes permisos para leer este Google Forms o necesitas autorizar el acceso a Google Forms.'
          );
        }
        if (formRes.status === 404) {
          throw new Error(
            'No se encontró el formulario de Google Forms. Asegúrate de pegar el enlace de edición (docs.google.com/forms/d/.../edit).'
          );
        }
        throw new Error(`Error al leer el formulario de Google Forms (Código ${formRes.status}).`);
      }

      formData = await formRes.json();
    }

    const formTitle =
      formData?.info?.title ||
      formData?.info?.documentTitle ||
      'Evaluación de Google Forms';
    const linkedSheetId = formData?.linkedSheetId ? String(formData.linkedSheetId).trim() : '';

    const questionIdToTitle: Record<string, string> = {};
    let totalQuizPoints = 0;

    const items: any[] = Array.isArray(formData?.items) ? formData.items : [];
    items.forEach((item, idx) => {
      const itemTitle = String(item?.title || `Pregunta ${idx + 1}`).trim();

      if (item?.questionItem?.question) {
        const q = item.questionItem.question;
        if (q.questionId) {
          questionIdToTitle[q.questionId] = itemTitle;
        }
        const pt = Number(q?.grading?.pointValue || 0);
        if (!isNaN(pt) && pt > 0) {
          totalQuizPoints += pt;
        }
      } else if (Array.isArray(item?.questionGroupItem?.questions)) {
        item.questionGroupItem.questions.forEach((q: any, qIdx: number) => {
          if (q.questionId) {
            questionIdToTitle[q.questionId] = `${itemTitle} (${qIdx + 1})`;
          }
          const pt = Number(q?.grading?.pointValue || 0);
          if (!isNaN(pt) && pt > 0) {
            totalQuizPoints += pt;
          }
        });
      }
    });

    const activeToken = getCachedAccessToken() || token;
    const responsesRes = await fetchGoogleApiWithRetry(
      `https://forms.googleapis.com/v1/forms/${safeFormId}/responses`,
      {},
      activeToken
    );

    if (!responsesRes.ok) {
      if (linkedSheetId) {
        try {
          const linkedSheetData = await fetchArbitrarySpreadsheetDataHelper(
            linkedSheetId,
            undefined,
            activeToken
          );
          if (linkedSheetData.rows.length > 0) {
            return {
              formId,
              title: formTitle,
              maxScore: totalQuizPoints > 0 ? totalQuizPoints : 10,
              headers: linkedSheetData.headers,
              rows: linkedSheetData.rows,
            };
          }
        } catch {}
      }
      throw new Error(
        `No se pudieron obtener las respuestas del Google Forms (Código ${responsesRes.status}).`
      );
    }

    const responsesData = await responsesRes.json();
    const responsesList: any[] = Array.isArray(responsesData?.responses)
      ? responsesData.responses
      : [];

    if (responsesList.length === 0) {
      if (linkedSheetId) {
        try {
          const linkedSheetData = await fetchArbitrarySpreadsheetDataHelper(
            linkedSheetId,
            undefined,
            activeToken
          );
          if (linkedSheetData.rows.length > 0) {
            return {
              formId,
              title: formTitle,
              maxScore: totalQuizPoints > 0 ? totalQuizPoints : 10,
              headers: linkedSheetData.headers,
              rows: linkedSheetData.rows,
            };
          }
        } catch {}
      }
      throw new Error('Este formulario de Google Forms aún no tiene respuestas enviadas.');
    }

    const questionHeaders = Object.values(questionIdToTitle);
    const headers = [
      'Marca temporal',
      'Puntuación',
      'Dirección de correo electrónico',
      ...questionHeaders,
    ];

    const effectiveMaxScore = totalQuizPoints > 0 ? totalQuizPoints : 10;

    const rows: Array<Record<string, any>> = responsesList.map((resp) => {
      let earnedScore: number | null =
        typeof resp.totalScore === 'number' ? resp.totalScore : null;

      const answersObj = resp.answers || {};
      if (earnedScore === null) {
        let summed = 0;
        let hasAnyGrade = false;
        Object.values(answersObj).forEach((ans: any) => {
          if (ans?.grade && typeof ans.grade.score === 'number') {
            summed += ans.grade.score;
            hasAnyGrade = true;
          } else if (ans?.grade) {
            // La API de Google Forms omite la propiedad `score` cuando la respuesta obtuvo 0 puntos (`grade: {}`).
            hasAnyGrade = true;
          }
        });
        if (hasAnyGrade || totalQuizPoints > 0) {
          earnedScore = summed;
        }
      }

      const scoreFormatted =
        earnedScore !== null
          ? totalQuizPoints > 0
            ? `${earnedScore} / ${totalQuizPoints}`
            : String(earnedScore)
          : '';

      const rowRecord: Record<string, any> = {
        'Marca temporal': resp.lastSubmittedTime || resp.createTime || '',
        Puntuación: scoreFormatted,
        'Dirección de correo electrónico': resp.respondentEmail || '',
      };

      Object.entries(questionIdToTitle).forEach(([qId, qTitle]) => {
        const ans = answersObj[qId];
        const textVals: string[] =
          ans?.textAnswers?.answers
            ?.map((a: any) => String(a?.value ?? '').trim())
            .filter(Boolean) || [];
        rowRecord[qTitle] = textVals.join(', ');
      });

      return rowRecord;
    });

    return {
      formId,
      title: formTitle,
      maxScore: effectiveMaxScore,
      headers,
      rows,
    };
  },
};
