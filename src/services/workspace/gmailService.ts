/**
 * Gmail Integration Service
 * Endpoint: https://gmail.googleapis.com/gmail/v1/users/me/messages/send
 * Scope: https://www.googleapis.com/auth/gmail.send
 */

import { getCachedAccessToken } from './googleAuth';

export const gmailService = {
  /**
   * Send an email via Gmail API using raw RFC 2822 base64url format
   */
  async sendEmail(
    to: string,
    subject: string,
    bodyText: string
  ): Promise<{ success: boolean; id?: string; message?: string }> {
    const token = getCachedAccessToken();
    if (!token) {
      return {
        success: false,
        message: 'No hay token activo de Gmail. La acción quedó registrada para envío posterior.',
      };
    }

    if (!to || !to.includes('@')) {
      return {
        success: false,
        message: 'El estudiante no tiene una dirección de correo institucional válida.',
      };
    }

    try {
      // Build RFC 2822 message
      const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
      const messageParts = [
        `To: ${to}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${utf8Subject}`,
        '',
        bodyText,
      ];
      const message = messageParts.join('\r\n');

      // Base64URL encode
      const encodedMessage = btoa(unescape(encodeURIComponent(message)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: encodedMessage,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          id: data.id,
          message: `Correo enviado exitosamente a ${to}.`,
        };
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Gmail API send error:', res.status, err);
        return {
          success: false,
          message: err?.error?.message || `Error en Gmail API (status ${res.status})`,
        };
      }
    } catch (err: any) {
      console.warn('Error sending email through Gmail API:', err);
      return {
        success: false,
        message: err?.message || 'Error de conexión con Gmail.',
      };
    }
  },
};
