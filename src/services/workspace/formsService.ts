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
} from './googleAuth';

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

export const formsService = {
  /**
   * Extracts a clean Google Form ID from a URL or raw ID string.
   * Supports:
   * - https://docs.google.com/forms/d/1abc123.../edit
   * - https://docs.google.com/forms/d/1abc123.../viewform
   * - Raw ID: 1abc123...
   */
  extractFormId(idOrUrl: string): { formId: string; isPublicResponderUrl: boolean } {
    const trimmed = idOrUrl.trim();

    // Detect /forms/d/e/{responderId}/viewform (public responder link, which uses a different ID than the editor formId)
    if (/\/forms\/d\/e\/([a-zA-Z0-9_-]+)/i.test(trimmed)) {
      const m = trimmed.match(/\/forms\/d\/e\/([a-zA-Z0-9_-]+)/i);
      return {
        formId: m ? m[1] : trimmed,
        isPublicResponderUrl: true,
      };
    }

    // Standard editor/form URL: /forms/d/{formId}/edit
    const match = trimmed.match(/\/forms\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return {
        formId: match[1],
        isPublicResponderUrl: false,
      };
    }

    return {
      formId: trimmed,
      isPublicResponderUrl: false,
    };
  },

  /**
   * Lists Google Forms available in the teacher's Google Drive (if accessible with current scopes)
   */
  async listUserGoogleForms(
    searchQuery?: string,
    providedToken?: string
  ): Promise<GoogleFormListItem[]> {
    const token = providedToken || getCachedAccessToken();
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
   * Fetches a Google Form's structure and its responses directly via the Google Forms API v1,
   * extracting student identifiers (name/email) and their final score.
   */
  async fetchGoogleFormEvaluations(
    idOrUrl: string,
    providedToken?: string
  ): Promise<DirectGoogleFormDataResult> {
    const { formId, isPublicResponderUrl } = this.extractFormId(idOrUrl);
    if (!formId) {
      throw new Error('Ingresa un enlace o ID válido de Google Forms.');
    }

    if (isPublicResponderUrl) {
      throw new Error(
        'Pegaste el enlace de vista pública (/forms/d/e/.../viewform). Por favor, copia el enlace de edición del formulario (el que ves arriba en tu navegador al editar el Forms: docs.google.com/forms/d/.../edit).'
      );
    }

    let token = providedToken || getCachedAccessToken();
    if (!token) {
      token = await requestGoogleAccessToken();
    }
    if (!token) {
      throw new Error('Debes conectar tu cuenta de Google para leer el formulario directamente.');
    }

    const safeFormId = encodeURIComponent(formId.trim());

    // 1. Fetch Form Metadata & Questions (to get title, question titles, and total quiz points)
    const formRes = await fetchGoogleApiWithRetry(
      `https://forms.googleapis.com/v1/forms/${safeFormId}`,
      {},
      token
    );

    if (!formRes.ok) {
      if (formRes.status === 401 || formRes.status === 403) {
        // Request fresh token with Forms scopes if needed
        const freshToken = await requestGoogleAccessToken();
        if (freshToken) {
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

    const formData = await formRes.json();
    const formTitle =
      formData?.info?.title ||
      formData?.info?.documentTitle ||
      'Evaluación de Google Forms';

    // Map questionId -> question title, and calculate total possible points in the Quiz
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

    // 2. Fetch Form Responses (submissions & scores)
    const responsesRes = await fetchGoogleApiWithRetry(
      `https://forms.googleapis.com/v1/forms/${safeFormId}/responses`,
      {},
      token
    );

    if (!responsesRes.ok) {
      throw new Error(
        `No se pudieron obtener las respuestas del Google Forms (Código ${responsesRes.status}).`
      );
    }

    const responsesData = await responsesRes.json();
    const responsesList: any[] = Array.isArray(responsesData?.responses)
      ? responsesData.responses
      : [];

    if (responsesList.length === 0) {
      throw new Error('Este formulario de Google Forms aún no tiene respuestas enviadas.');
    }

    // Build headers & rows compatible with our student roster matcher
    const questionHeaders = Object.values(questionIdToTitle);
    const headers = [
      'Marca temporal',
      'Puntuación',
      'Dirección de correo electrónico',
      ...questionHeaders,
    ];

    const effectiveMaxScore = totalQuizPoints > 0 ? totalQuizPoints : 10;

    const rows: Array<Record<string, any>> = responsesList.map((resp) => {
      // Calculate earned score: either resp.totalScore or sum of individual answer grades
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
            // In Google Forms API, a grade object with 0 points omits the `score` field (`grade: {}`)
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
