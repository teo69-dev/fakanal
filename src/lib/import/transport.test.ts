import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { describe, expect, it, vi } from "vitest";

// The real transport wired to a pretend node:https: what matters here is HOW it asks (options) and that it
// decompresses and refuses what it cannot read.
const captured = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined, reply: undefined as { status: number; headers: Record<string, string>; body: Buffer } | undefined }));

vi.mock("node:https", () => {
  const request = (options: Record<string, unknown>, onResponse: (res: unknown) => void) => {
    captured.options = options;
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      const reply = captured.reply as NonNullable<typeof captured.reply>;
      const res = Object.assign(Readable.from([reply.body]), { statusCode: reply.status, headers: reply.headers });
      onResponse(res);
    };
    return req;
  };
  return { default: { request }, request };
});

import { createSafeLookup } from "./ssrf";
import { ImportError, httpsTransport } from "./fetch";

async function readAll(body: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of body) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts).toString("utf8");
}

const ask = (reply: NonNullable<typeof captured.reply>, lookup = createSafeLookup()) => {
  captured.reply = reply;
  return httpsTransport(lookup)(new URL("https://example.com/recept/1?x=2"), { signal: new AbortController().signal });
};

describe("httpsTransport", () => {
  it("asks over https on port 443, through the safe lookup, with a fresh connection and no cookies", async () => {
    const lookup = createSafeLookup();
    await ask({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("x") }, lookup);
    const o = captured.options as Record<string, unknown>;
    expect(o.hostname).toBe("example.com");
    expect(o.port).toBe(443);
    expect(o.path).toBe("/recept/1?x=2");
    expect(o.method).toBe("GET");
    expect(o.lookup).toBe(lookup); // the connection resolves the name through the address filter
    expect(o.agent).toBe(false); // no pooled connection that was checked for another request
    const headers = o.headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("cookie");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("authorization");
  });

  it("returns an uncompressed body as it is", async () => {
    const r = await ask({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<html>sima</html>") });
    expect(r.status).toBe(200);
    expect(await readAll(r.body)).toBe("<html>sima</html>");
  });

  it("decompresses gzip, deflate and brotli", async () => {
    const text = "<html>Pörkölt</html>";
    const cases: [string, Buffer][] = [
      ["gzip", zlib.gzipSync(text)],
      ["x-gzip", zlib.gzipSync(text)],
      ["deflate", zlib.deflateSync(text)],
      ["br", zlib.brotliCompressSync(text)],
    ];
    for (const [encoding, body] of cases) {
      const r = await ask({ status: 200, headers: { "content-type": "text/html", "content-encoding": encoding }, body });
      expect(await readAll(r.body), encoding).toBe(text);
    }
  });

  it("refuses a content encoding it cannot read", async () => {
    await expect(ask({ status: 200, headers: { "content-encoding": "zstd" }, body: Buffer.from("x") })).rejects.toBeInstanceOf(ImportError);
  });

  it("hands redirect headers through so the caller can check the target", async () => {
    const r = await ask({ status: 302, headers: { location: "https://example.com/b" }, body: Buffer.from("") });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("https://example.com/b");
  });

  it("a compressed body that grows far beyond the limit can be cut off by the reader (the output is not read ahead)", async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(50 * 1024 * 1024, 97)); // 50 MB of "a" in a few KB
    expect(bomb.length).toBeLessThan(100 * 1024);
    const r = await ask({ status: 200, headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: bomb });
    let total = 0;
    for await (const chunk of r.body) {
      total += chunk.byteLength;
      if (total > 2 * 1024 * 1024) break; // fetchHtml stops here
    }
    expect(total).toBeGreaterThan(2 * 1024 * 1024);
    expect(total).toBeLessThan(10 * 1024 * 1024); // far less than the 50 MB it would grow to
  });
});
