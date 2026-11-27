import http from "node:http";
import type https from "node:https";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchHtml, httpsTransport, ImportError } from "./fetch";

// The REAL transport, the real streams and the real time limit, against a local server. The only substitute is the
// connection itself: the requester sends the request to this plain-http server instead of to port 443 (the https
// layer and the address filter are covered elsewhere). What matters here is that a server that stalls or lies cannot
// hold the reader past the limit, compressed or not, and that what it sends is read correctly.

let server: http.Server;
let port = 0;
const OK_HTML = '<html><head><script type="application/ld+json">{"@type":"Recipe","name":"Élő teszt"}</script></head></html>';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? "/";
    const big = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 97));
    if (path === "/ok") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(OK_HTML);
    } else if (path === "/ok-gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(zlib.gzipSync(OK_HTML));
    } else if (path === "/ok-br") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" });
      res.end(zlib.brotliCompressSync(OK_HTML));
    } else if (path === "/stall-plain") {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>");
      // never ends
    } else if (path === "/stall-gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.write(zlib.gzipSync(OK_HTML).subarray(0, 12)); // the start of a gzip stream, then silence
    } else if (path === "/stall-br") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "br" });
      res.write(zlib.brotliCompressSync(OK_HTML).subarray(0, 6));
    } else if (path === "/no-headers") {
      // the response never starts
    } else if (path === "/bomb") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end(big);
    } else if (path === "/redirect") {
      res.writeHead(302, { location: "https://example.com/ok" });
      res.end();
    } else if (path === "/redirect-to-http") {
      res.writeHead(302, { location: "http://example.com/ok" });
      res.end();
    } else if (path === "/bad-gzip") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.end("this is not gzip data at all");
    } else {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("nincs");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// sends every request of the transport to the local server, keeping the path
const transport = () => {
  const requester = ((options: https.RequestOptions, callback: (res: http.IncomingMessage) => void) =>
    http.request({ ...options, hostname: "127.0.0.1", port, lookup: undefined }, callback)) as unknown as typeof https.request;
  return httpsTransport(undefined, requester);
};

const outcome = async (path: string, timeoutMs = 400, maxBytes?: number) => {
  const start = performance.now();
  try {
    const page = await fetchHtml(`https://example.com${path}`, { transport: transport(), timeoutMs, maxBytes });
    return { ok: true as const, html: page.html, ms: performance.now() - start };
  } catch (error) {
    return { ok: false as const, code: error instanceof ImportError ? error.code : `other:${String(error)}`, ms: performance.now() - start };
  }
};

describe("the real transport against a local server", () => {
  it("reads a plain, a gzip and a brotli page", async () => {
    for (const path of ["/ok", "/ok-gzip", "/ok-br"]) {
      const r = await outcome(path);
      expect(r.ok && r.html, path).toBe(OK_HTML);
    }
  });

  it("follows a redirect and refuses one to http", async () => {
    // the redirect target is example.com again, which the requester sends to the same server
    expect((await outcome("/redirect")).ok).toBe(true);
    const refused = await outcome("/redirect-to-http");
    expect(!refused.ok && refused.code).toBe("blocked");
  });

  it("gives up at the time limit when the body stops halfway: plain, gzip and brotli alike", async () => {
    for (const path of ["/stall-plain", "/stall-gzip", "/stall-br"]) {
      const r = await outcome(path, 400);
      expect(r.ok, path).toBe(false);
      expect(!r.ok && r.code, path).toBe("timeout");
      expect(r.ms, path).toBeGreaterThan(300);
      expect(r.ms, path).toBeLessThan(2500); // not "hangs until the platform kills the function"
    }
  });

  it("gives up at the time limit when the server never answers at all", async () => {
    const r = await outcome("/no-headers", 400);
    expect(!r.ok && r.code).toBe("timeout");
    expect(r.ms).toBeLessThan(2500);
  });

  it("cuts a compression bomb off at the size limit instead of unpacking it", async () => {
    const r = await outcome("/bomb", 4000, 1024 * 1024);
    expect(!r.ok && r.code).toBe("too_large");
    expect(r.ms).toBeLessThan(3000);
  });

  it("reports a corrupt compressed body as a failed download, not as a crash", async () => {
    const r = await outcome("/bad-gzip");
    expect(!r.ok && r.code).toBe("fetch_failed");
  });

  it("reports an error status", async () => {
    const r = await outcome("/missing");
    expect(!r.ok && r.code).toBe("http_status");
  });

  it("does not leave the process waiting afterwards: the stalled connections are closed on the way out", async () => {
    await outcome("/stall-gzip", 200);
    await outcome("/stall-plain", 200);
    await new Promise((r) => setTimeout(r, 100));
    const open = await new Promise<number>((resolve) => server.getConnections((_e, n) => resolve(n)));
    expect(open).toBe(0);
  });
});
