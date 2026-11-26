// Which image addresses a recipe may point to. The visitor's browser loads the picture (not our server), so this is not
// about SSRF: it keeps a stolen password from aiming every visitor's browser at their own machine or network
// ("blind" requests to localhost, routers, intranet names) or at a bare IP the attacker watches.

// Reserved or internal-only top-level names: they never name a public site.
const BLOCKED_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "arpa", // in-addr.arpa, ip6.arpa, home.arpa
  "invalid",
  "test",
  "example",
  "onion",
];

const IPV4_LIKE = /^\d+\.\d+\.\d+\.\d+$/;

/** True for a public-looking host NAME: not an IP literal, not a single word, not an internal or reserved suffix. */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return false;
  // IPv6 literals keep their brackets in URL.hostname; every numeric IPv4 spelling (decimal, hex, octal, short) is
  // normalised by the URL parser to dotted decimal, so this one test covers them all
  if (host.startsWith("[") || host.includes(":") || IPV4_LIKE.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => l === "")) return false; // "localhost", "intranet", "a..b"
  return !BLOCKED_SUFFIXES.includes(labels[labels.length - 1] as string);
}

/** https only, no user:password@, and a public host name (see isPublicHostname). */
export function isAllowedImageUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.username === "" && u.password === "" && isPublicHostname(u.hostname);
  } catch {
    return false;
  }
}
