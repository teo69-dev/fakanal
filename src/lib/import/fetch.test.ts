import { describe, expect, it, vi } from "vitest";
import { decodeHtml, fetchHtml, IMPORT_MAX_REDIRECTS, ImportError, parseImportUrl, type Transport, type TransportResponse } from "./fetch";

const encoder = new TextEncoder();
const HTML = { "content-type": "text/html; charset=utf-8" };

function response(status: number, headers: Record<string, string>, body: string | Uint8Array[] = ""): TransportResponse & { destroyed: () => boolean } {
  const chunks = typeof body === "string" ? [encoder.encode(body)] : body;
  let destroyed = false;
  return {
    status,
    headers,
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          if (destroyed) return;
          yield chunk;
        }
      },
      destroy: () => {
        destroyed = true;
      },
    },
    destroyed: () => destroyed,
  };
}

/** A transport that answers with the given responses in order and records the addresses it was asked for. */
function script(...answers: (TransportResponse | Error)[]) {
  const asked: string[] = [];
  const transport: Transport = async (url) => {
    asked.push(url.href);
    const answer = answers[Math.min(asked.length - 1, answers.length - 1)] as TransportResponse | Error;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { transport, asked };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof ImportError ? error.code : `other:${String(error)}`;
  }
  return "no error";
};

describe("parseImportUrl", () => {
  it("accepts https on the default port with a public host name and drops the fragment", () => {
    expect(parseImportUrl("https://example.com/recept/1?x=2#lepesek")?.href).toBe("https://example.com/recept/1?x=2");
    expect(parseImportUrl("https://EXAMPLE.com./a")?.hostname).toBe("example.com.");
  });

  it("refuses everything else", () => {
    for (const bad of [
      "http://example.com/",
      "https://example.com:8443/",
      "https://example.com:443/x".replace(":443", ":444"),
      "https://user:pw@example.com/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://2130706433/",
      "https://localhost/",
      "https://intranet/",
      "https://nas.local/",
      "https://db.internal/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
      "",
      `https://example.com/${"a".repeat(2000)}`,
    ]) {
      expect(parseImportUrl(bad), bad).toBeNull();
    }
  });
});

describe("fetchHtml", () => {
  it("returns the page text and the final address", async () => {
    const { transport, asked } = script(response(200, HTML, "<html>Pörkölt</html>"));
    const page = await fetchHtml("https://example.com/r#x", { transport });
    expect(page).toEqual({ html: "<html>Pörkölt</html>", finalUrl: "https://example.com/r" });
    expect(asked).toEqual(["https://example.com/r"]);
  });

  it("refuses an unacceptable address without asking the network", async () => {
    const { transport, asked } = script(response(200, HTML, "x"));
    for (const bad of ["http://example.com/", "https://127.0.0.1/", "https://localhost/", "https://example.com:8443/", "nope"]) {
      expect(await code(fetchHtml(bad, { transport })), bad).toBe("invalid_url");
    }
    expect(asked).toEqual([]);
  });

  describe("redirects", () => {
    it("follows redirects, absolute and relative, and reports where it ended", async () => {
      const { transport, asked } = script(
        response(301, { location: "https://www.example.com/a" }),
        response(302, { location: "/b?x=1" }),
        response(200, HTML, "ok"),
      );
      const page = await fetchHtml("https://example.com/", { transport });
      expect(asked).toEqual(["https://example.com/", "https://www.example.com/a", "https://www.example.com/b?x=1"]);
      expect(page.finalUrl).toBe("https://www.example.com/b?x=1");
    });

    it("checks every target with the same rules as the first address", async () => {
      for (const location of [
        "http://example.com/plain",
        "https://127.0.0.1/",
        "https://[::1]/",
        "https://localhost/admin",
        "https://router/",
        "https://printer.local/",
        "https://metadata.internal/",
        "https://example.com:8443/",
        "https://user:pw@example.com/",
        "file:///etc/passwd",
        "javascript:alert(1)",
      ]) {
        const { transport, asked } = script(response(302, { location }), response(200, HTML, "SHOULD NOT BE READ"));
        expect(await code(fetchHtml("https://example.com/", { transport })), location).toBe("blocked");
        expect(asked, location).toEqual(["https://example.com/"]); // the second request was never made
      }
    });

    it("refuses a redirect without a usable Location", async () => {
      expect(await code(fetchHtml("https://example.com/", { transport: script(response(302, {})).transport }))).toBe("blocked");
      expect(await code(fetchHtml("https://example.com/", { transport: script(response(302, { location: "http://[" })).transport }))).toBe("blocked");
    });

    it("allows 3 redirects and refuses the 4th", async () => {
      const hops = (n: number) => Array.from({ length: n }, (_, i) => response(302, { location: `https://example.com/${i + 1}` }));
      const three = script(...hops(IMPORT_MAX_REDIRECTS), response(200, HTML, "done"));
      expect((await fetchHtml("https://example.com/", { transport: three.transport })).html).toBe("done");
      const four = script(...hops(IMPORT_MAX_REDIRECTS + 1), response(200, HTML, "done"));
      expect(await code(fetchHtml("https://example.com/", { transport: four.transport }))).toBe("too_many_redirects");
    });

    it("stops a redirect loop", async () => {
      const { transport } = script(response(302, { location: "https://example.com/" }));
      expect(await code(fetchHtml("https://example.com/", { transport }))).toBe("too_many_redirects");
    });

    it("drops the body of a redirect it follows", async () => {
      const first = response(302, { location: "https://example.com/next" }, "x".repeat(10));
      await fetchHtml("https://example.com/", { transport: script(first, response(200, HTML, "ok")).transport });
      expect(first.destroyed()).toBe(true);
    });
  });

  describe("answer checks", () => {
    it("refuses an error status and names it", async () => {
      for (const status of [403, 404, 410, 500, 503]) {
        const { transport } = script(response(status, HTML, "nope"));
        const error = await fetchHtml("https://example.com/", { transport }).catch((e) => e);
        expect(error).toBeInstanceOf(ImportError);
        expect(error.code).toBe("http_status");
        expect(error.detail).toBe(String(status));
      }
    });

    it("takes only text/html and application/xhtml+xml", async () => {
      for (const type of ["application/json", "application/pdf", "image/png", "text/plain", "text/htmlx", "", "application/octet-stream"]) {
        const { transport } = script(response(200, type ? { "content-type": type } : {}, "<html></html>"));
        expect(await code(fetchHtml("https://example.com/", { transport })), type).toBe("not_html");
      }
      for (const type of ["text/html", "TEXT/HTML; charset=UTF-8", "application/xhtml+xml"]) {
        const { transport } = script(response(200, { "content-type": type }, "<html></html>"));
        expect(await code(fetchHtml("https://example.com/", { transport })), type).toBe("no error");
      }
    });

    it("refuses a body over the size limit, by what actually arrives", async () => {
      const big = Array.from({ length: 5 }, () => new Uint8Array(400));
      const { transport } = script(response(200, HTML, big));
      expect(await code(fetchHtml("https://example.com/", { transport, maxBytes: 1000 }))).toBe("too_large");
      const ok = script(response(200, HTML, [new Uint8Array(1000)]));
      expect(await code(fetchHtml("https://example.com/", { transport: ok.transport, maxBytes: 1000 }))).toBe("no error"); // exactly the limit
    });

    it("stops reading and closes the body when it is too large", async () => {
      const r = response(200, HTML, Array.from({ length: 50 }, () => new Uint8Array(100)));
      await code(fetchHtml("https://example.com/", { transport: script(r).transport, maxBytes: 250 }));
      expect(r.destroyed()).toBe(true);
    });

    it("refuses at once when the declared length is already over the limit", async () => {
      const r = response(200, { ...HTML, "content-length": "5000" }, "small");
      expect(await code(fetchHtml("https://example.com/", { transport: script(r).transport, maxBytes: 1000 }))).toBe("too_large");
      expect(r.destroyed()).toBe(true);
    });
  });

  describe("time limit", () => {
    const hanging: Transport = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });

    it("gives up when the server does not answer", async () => {
      expect(await code(fetchHtml("https://example.com/", { transport: hanging, timeoutMs: 30 }))).toBe("timeout");
    });

    it("gives up when the body never finishes", async () => {
      const slow: Transport = async (_url, { signal }) => ({
        status: 200,
        headers: HTML,
        body: {
          async *[Symbol.asyncIterator]() {
            yield encoder.encode("<html>");
            await new Promise((_r, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
          },
        },
      });
      expect(await code(fetchHtml("https://example.com/", { transport: slow, timeoutMs: 30 }))).toBe("timeout");
    });

    it("covers the whole chain of redirects with one limit", async () => {
      let n = 0;
      const chain: Transport = (url, { signal }) => {
        if (n++ < 2) return new Promise((r) => setTimeout(() => r(response(302, { location: `https://example.com/${n}` })), 25));
        return hanging(url, { signal });
      };
      expect(await code(fetchHtml("https://example.com/", { transport: chain, timeoutMs: 60 }))).toBe("timeout");
    });
  });

  describe("connection errors", () => {
    it("maps a blocked address (from the safe lookup) to blocked", async () => {
      const error = Object.assign(new Error("resolves to a private address"), { code: "EBLOCKED" });
      expect(await code(fetchHtml("https://example.com/", { transport: script(error).transport }))).toBe("blocked");
    });

    it("maps other failures to fetch_failed and keeps only the error code as detail", async () => {
      const error = Object.assign(new Error("getaddrinfo ENOTFOUND secret-internal-name"), { code: "ENOTFOUND" });
      const caught = await fetchHtml("https://example.com/", { transport: script(error).transport }).catch((e) => e);
      expect(caught.code).toBe("fetch_failed");
      expect(caught.detail).toBe("ENOTFOUND");
      expect(String(caught.message)).not.toContain("secret-internal-name");
    });
  });
});

describe("decodeHtml", () => {
  // "árvíztűrő" in ISO-8859-2: a, r, v, i with acute, z, t, u with double acute, r, o with double acute
  const latin2 = Uint8Array.from([0xe1, 0x72, 0x76, 0xed, 0x7a, 0x74, 0xfb, 0x72, 0xf5]);

  it("decodes UTF-8 by default", () => {
    expect(decodeHtml(encoder.encode("árvíztűrő"), "text/html")).toBe("árvíztűrő");
  });

  it("uses the charset of the Content-Type header", () => {
    expect(decodeHtml(latin2, "text/html; charset=iso-8859-2")).toBe("árvíztűrő");
    expect(decodeHtml(latin2, 'text/html; charset="ISO-8859-2"')).toBe("árvíztűrő");
  });

  it("falls back to a <meta> charset in the first bytes", () => {
    const head = encoder.encode('<html><head><meta charset="iso-8859-2"></head><body>');
    const bytes = Uint8Array.from([...head, ...latin2]);
    expect(decodeHtml(bytes, "text/html")).toContain("árvíztűrő");
  });

  it("does not fail on an unknown charset name", () => {
    expect(decodeHtml(encoder.encode("abc"), "text/html; charset=no-such-charset")).toBe("abc");
  });
});

describe("transport is not touched for a refused address", () => {
  it("never calls the transport for an address that fails the rules", async () => {
    const transport = vi.fn();
    await fetchHtml("https://192.168.1.1/", { transport }).catch(() => undefined);
    expect(transport).not.toHaveBeenCalled();
  });
});
