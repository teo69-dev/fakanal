import https from "node:https";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { isPublicHostname } from "@/lib/url";
import { createSafeLookup } from "./ssrf";

export const IMPORT_TIMEOUT_MS = 8000;
// a real Hungarian recipe site measured 2.5 MB for one page, so 2 MB would refuse normal pages
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2000;

export type ImportErrorCode =
  | "invalid_url" // the address the user gave is not an acceptable one
  | "blocked" // a redirect, or the name's DNS answer, leads somewhere that is not allowed
  | "timeout"
  | "fetch_failed"
  | "http_status"
  | "too_many_redirects"
  | "not_html"
  | "too_large";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly detail?: string,
  ) {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

/**
 * The address rules for an import (and for every redirect): https on the default port, no user:password@, a public
 * host NAME (no IP literal, no localhost or internal name). The addresses a name resolves to are checked later, at
 * connection time (see ssrf.ts).
 */
export function parseImportUrl(value: string): URL | null {
  if (value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (!isPublicHostname(url.hostname)) return null;
  url.hash = "";
  return url;
}

export type TransportResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  /** The body, already decompressed. */
  body: AsyncIterable<Uint8Array> & { destroy?: () => unknown };
};
export type Transport = (url: URL, options: { signal: AbortSignal }) => Promise<TransportResponse>;

const REQUEST_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; FakanalRecipeImport/1.0)",
  accept: "text/html,application/xhtml+xml;q=0.9",
  "accept-language": "hu,en;q=0.7",
  "accept-encoding": "gzip, deflate, br",
};

/** The real transport: https only, connecting through the safe lookup, a fresh connection per request. */
export function httpsTransport(lookup = createSafeLookup()): Transport {
  return (url, { signal }) =>
    new Promise((resolve, reject) => {
      const request = https.request(
        { hostname: url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: "GET", headers: REQUEST_HEADERS, lookup, agent: false, signal },
        (response) => {
          const headers: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(response.headers)) headers[name] = Array.isArray(value) ? value.join(", ") : value;
          const encoding = (headers["content-encoding"] ?? "").trim().toLowerCase();
          let body: Readable = response;
          if (encoding === "gzip" || encoding === "x-gzip") body = response.pipe(zlib.createGunzip());
          else if (encoding === "deflate") body = response.pipe(zlib.createInflate());
          else if (encoding === "br") body = response.pipe(zlib.createBrotliDecompress());
          else if (encoding !== "" && encoding !== "identity") {
            response.destroy();
            return reject(new ImportError("fetch_failed", `unsupported content-encoding ${encoding}`));
          }
          resolve({ status: response.statusCode ?? 0, headers, body });
        },
      );
      request.on("error", reject);
      request.end();
    });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && ((error as { name?: string }).name === "AbortError" || (error as { code?: string }).code === "ABORT_ERR");
}

function asImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error;
  if (isAbort(error)) return new ImportError("timeout");
  const code = (error as { code?: string } | null)?.code;
  if (code === "EBLOCKED") return new ImportError("blocked", "address");
  return new ImportError("fetch_failed", typeof code === "string" ? code : undefined);
}

/** Text of a response body: the charset from the Content-Type header, else from a <meta> in the first bytes, else UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let label = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType)?.[1];
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
    label = /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(body: TransportResponse["body"], maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new ImportError("too_large");
      chunks.push(chunk);
    }
  } catch (error) {
    body.destroy?.();
    throw error;
  }
  return Buffer.concat(chunks);
}

export type FetchDeps = { transport?: Transport; timeoutMs?: number; maxBytes?: number };

/**
 * Downloads one HTML page: at most IMPORT_MAX_REDIRECTS redirects (each target is checked with the same rules as the
 * first address), IMPORT_TIMEOUT_MS for everything together, IMPORT_MAX_BYTES of (decompressed) body, text/html only.
 */
export async function fetchHtml(input: string, deps: FetchDeps = {}): Promise<{ html: string; finalUrl: string }> {
  const transport = deps.transport ?? httpsTransport();
  const maxBytes = deps.maxBytes ?? IMPORT_MAX_BYTES;
  let url = parseImportUrl(input);
  if (!url) throw new ImportError("invalid_url");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? IMPORT_TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      const response = await transport(url, { signal: controller.signal });

      if (REDIRECTS.has(response.status)) {
        response.body.destroy?.();
        if (hop >= IMPORT_MAX_REDIRECTS) throw new ImportError("too_many_redirects");
        const location = response.headers.location;
        let next: URL | null = null;
        try {
          next = location ? parseImportUrl(new URL(location, url).href) : null;
        } catch {
          next = null;
        }
        if (!next) throw new ImportError("blocked", "redirect");
        url = next;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.body.destroy?.();
        throw new ImportError("http_status", String(response.status));
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
        response.body.destroy?.();
        throw new ImportError("not_html");
      }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > maxBytes && !response.headers["content-encoding"]) {
        response.body.destroy?.();
        throw new ImportError("too_large");
      }
      const bytes = await readCapped(response.body, maxBytes);
      return { html: decodeHtml(bytes, contentType), finalUrl: url.href };
    }
  } catch (error) {
    throw asImportError(error);
  } finally {
    clearTimeout(timer);
  }
}
