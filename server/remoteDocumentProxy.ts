/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SSRF-hardened remote Google Workspace document proxy (`/api/workspace/fetch-remote-document`).
 * Enforces HTTPS-only allowlisted Google document hosts, DNS resolution filtering against
 * loopback/RFC1918/link-local/metadata/private IPv6 ranges, manual redirect validation on every hop,
 * and strict request timeouts.
 */

import type express from "express";
import dns from "dns/promises";
import net from "net";

const ALLOWED_REMOTE_DOC_HOSTS = new Set([
  "docs.google.com",
  "drive.google.com",
  "forms.gle",
  "sheets.googleapis.com",
  "www.googleapis.com",
]);

const REMOTE_FETCH_TIMEOUT_MS = 10000;

function isPrivateOrReservedIp(ip: string): boolean {
  const cleanIp = ip.toLowerCase().replace(/^::ffff:/, "");
  if (net.isIPv4(cleanIp)) {
    const [a, b] = cleanIp.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(cleanIp)) {
    return (
      cleanIp === "::" ||
      cleanIp === "::1" ||
      cleanIp.startsWith("fc") ||
      cleanIp.startsWith("fd") ||
      cleanIp.startsWith("fe8") ||
      cleanIp.startsWith("fe9") ||
      cleanIp.startsWith("fea") ||
      cleanIp.startsWith("feb") ||
      cleanIp.startsWith("ff")
    );
  }
  return true;
}

function isAllowedGoogleDocHost(host: string): boolean {
  const cleanHost = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (ALLOWED_REMOTE_DOC_HOSTS.has(cleanHost)) return true;
  if (cleanHost.endsWith(".googleusercontent.com")) return true;
  return false;
}

async function isSafeRemoteFetchUrl(candidateUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || !isAllowedGoogleDocHost(host)) return false;
    if (net.isIP(host)) return false;
    const records = await dns.lookup(host, { all: true });
    if (!records || records.length === 0) return false;
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function safeFetchWithManualRedirects(
  initialUrl: string,
  headers: Record<string, string>,
  maxRedirects = 5
): Promise<{ response: Response; finalUrl: string } | null> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!(await isSafeRemoteFetchUrl(currentUrl))) {
      return null;
    }
    const resp = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return { response: resp, finalUrl: currentUrl };
      const resolvedNext = new URL(location, currentUrl).toString();
      // Stop cleanly on Google sign-in redirects without treating as SSRF error
      if (resolvedNext.includes("accounts.google.com")) {
        return { response: resp, finalUrl: resolvedNext };
      }
      currentUrl = resolvedNext;
      continue;
    }
    return { response: resp, finalUrl: currentUrl };
  }
  return null;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractTitleFromHtml(html: string, fallback: string): string {
  const ogMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = decodeHtmlEntities((ogMatch && ogMatch[1]) || (titleMatch && titleMatch[1]) || "");
  const cleaned = rawTitle
    .replace(/\s*-\s*Formularios de Google$/i, "")
    .replace(/\s*-\s*Google Forms$/i, "")
    .replace(/\s*-\s*Hojas de cálculo de Google$/i, "")
    .replace(/\s*-\s*Google Sheets$/i, "")
    .replace(/\s*-\s*Documentos de Google$/i, "")
    .replace(/\s*-\s*Google Docs$/i, "")
    .trim();
  return cleaned || fallback;
}

function isGoogleSignInPage(text: string, finalUrl = ""): boolean {
  if (finalUrl.includes("accounts.google.com")) return true;
  const head = text.slice(0, 2500);
  return (
    head.includes("accounts.google.com/ServiceLogin") ||
    head.includes("accounts.google.com/v3/signin")
  );
}

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
};

export async function handleFetchRemoteDocument(
  req: express.Request,
  res: express.Response
): Promise<express.Response> {
  try {
    const rawUrl = String(req.body?.url || "").trim();
    const targetSheet = String(req.body?.sheetName || "").trim().slice(0, 120);
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: "URL requerida" });
    }

    if (/^https?:\/\//i.test(rawUrl) && !(await isSafeRemoteFetchUrl(rawUrl))) {
      return res.status(400).json({
        ok: false,
        error: "Solo se admiten enlaces HTTPS oficiales de Google Docs, Google Sheets, Google Forms o Google Drive.",
      });
    }

    // 1. Check if it's a Google Forms link (or forms.gle shortlink)
    if (/\/forms\/(?:u\/\d+\/)?d\//i.test(rawUrl) || /forms\.gle\//i.test(rawUrl)) {
      const fetched = await safeFetchWithManualRedirects(rawUrl, FETCH_HEADERS);
      if (!fetched) {
        return res.status(400).json({ ok: false, error: "URL o redirección de formulario bloqueada por seguridad." });
      }
      const { response: resp, finalUrl } = fetched;
      const html = resp.ok ? await resp.text() : "";
      const responderMatch = finalUrl.match(/\/forms\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9-_]+)/i);
      const editorMatch = !responderMatch
        ? finalUrl.match(/\/forms\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/i)
        : null;
      const title = html ? extractTitleFromHtml(html, "Evaluación de Google Forms") : "Evaluación de Google Forms";

      return res.json({
        ok: true,
        kind: "form",
        resolvedUrl: finalUrl,
        title,
        responderId: responderMatch ? responderMatch[1] : null,
        formId: editorMatch ? editorMatch[1] : null,
      });
    }

    // 2. Check if it's a Google Docs link
    const docMatch = rawUrl.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/i);
    if (docMatch) {
      const docId = docMatch[1];
      let title = "Documento de Google Docs";

      try {
        const fetched = await safeFetchWithManualRedirects(
          `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=html`,
          FETCH_HEADERS
        );
        if (fetched && fetched.response.ok) {
          const htmlText = await fetched.response.text();
          if (htmlText && !isGoogleSignInPage(htmlText, fetched.finalUrl)) {
            title = extractTitleFromHtml(htmlText, title);
            return res.json({ ok: true, kind: "doc", title, html: htmlText });
          }
        }
      } catch {}

      try {
        const fetched = await safeFetchWithManualRedirects(
          `https://docs.google.com/document/d/${encodeURIComponent(docId)}/export?format=txt`,
          FETCH_HEADERS
        );
        if (fetched && fetched.response.ok) {
          const txt = await fetched.response.text();
          if (txt && !txt.trim().startsWith("<!DOCTYPE html") && !isGoogleSignInPage(txt, fetched.finalUrl)) {
            return res.json({ ok: true, kind: "doc", title, text: txt });
          }
        }
      } catch {}

      try {
        const fetched = await safeFetchWithManualRedirects(
          `https://docs.google.com/document/d/${encodeURIComponent(docId)}/mobilebasic`,
          FETCH_HEADERS
        );
        if (fetched && fetched.response.ok) {
          const mobileHtml = await fetched.response.text();
          if (mobileHtml && !isGoogleSignInPage(mobileHtml, fetched.finalUrl)) {
            title = extractTitleFromHtml(mobileHtml, title);
            return res.json({ ok: true, kind: "doc", title, html: mobileHtml });
          }
        }
      } catch {}

      return res.status(403).json({
        ok: false,
        error: "El documento de Google Docs es privado. Inicia sesión con tu cuenta de Google o habilita el acceso por enlace.",
      });
    }

    // 3. Check if it's a Google Sheets link (or spreadsheet ID)
    const sheetMatch = rawUrl.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/i);
    const gidMatch = rawUrl.match(/[#?&]gid=(\d+)/i);
    const spreadsheetId = sheetMatch ? sheetMatch[1] : (/^[a-zA-Z0-9-_]{15,80}$/.test(rawUrl) ? rawUrl : "");

    if (spreadsheetId) {
      const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
      const sheetParam = targetSheet ? `&sheet=${encodeURIComponent(targetSheet)}` : gidParam;

      const candidateCsvUrls = [
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:csv${sheetParam}`,
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=csv${gidParam}`,
      ];

      for (const csvUrl of candidateCsvUrls) {
        try {
          const fetched = await safeFetchWithManualRedirects(csvUrl, FETCH_HEADERS);
          if (fetched && fetched.response.ok) {
            const text = await fetched.response.text();
            if (
              text &&
              !text.trim().startsWith("<!DOCTYPE html") &&
              !text.trim().startsWith("<html") &&
              !isGoogleSignInPage(text, fetched.finalUrl)
            ) {
              return res.json({
                ok: true,
                kind: "sheet",
                spreadsheetId,
                title: "Hoja de Google Sheets",
                csvText: text,
              });
            }
          }
        } catch {}
      }

      // Try htmlview fallback for public/shared sheets
      try {
        const fetched = await safeFetchWithManualRedirects(
          `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/htmlview`,
          FETCH_HEADERS
        );
        if (fetched && fetched.response.ok) {
          const htmlText = await fetched.response.text();
          if (htmlText && !isGoogleSignInPage(htmlText, fetched.finalUrl) && htmlText.includes("<table")) {
            const title = extractTitleFromHtml(htmlText, "Hoja de Google Sheets");
            return res.json({
              ok: true,
              kind: "sheet",
              spreadsheetId,
              title,
              htmlText,
            });
          }
        }
      } catch {}

      return res.status(403).json({
        ok: false,
        error: "La hoja de Google Sheets requiere permisos de lectura.",
      });
    }

    return res.status(400).json({
      ok: false,
      error: "Solo se pueden importar enlaces válidos de Google Docs, Google Sheets o Google Forms.",
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Error al consultar documento remoto." });
  }
}
