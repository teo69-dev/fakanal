import dns from "node:dns";
import { BlockList, isIP } from "node:net";

// Which network addresses the recipe import may connect to: PUBLIC ones only. Everything that reaches a machine on the
// server's own network (loopback, private ranges, link-local and the cloud metadata address, carrier-grade NAT) or is
// not a normal unicast address (multicast, reserved, documentation ranges) is refused.

const blockedV4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes the broadcast address
] as const) {
  blockedV4.addSubnet(net, prefix, "ipv4");
}

// IPv6: only global unicast (2000::/3) is allowed at all, which already excludes ::, ::1, fe80::/10, fc00::/7, ff00::/8
// and the IPv4-mapped (::ffff:a.b.c.d) and NAT64 forms; inside it the transition and documentation ranges are blocked.
const allowedV6 = new BlockList();
allowedV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [net, prefix] of [
  ["2001::", 23], // IETF protocol assignments: Teredo, benchmarking, ORCHID
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an IPv4 address)
  ["3fff::", 20], // documentation
] as const) {
  blockedV6.addSubnet(net, prefix, "ipv6");
}

/** True only for a normal public unicast address (IPv4 or IPv6, in text form). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return allowedV6.check(address, "ipv6") && !blockedV6.check(address, "ipv6");
  return false; // not an address at all
}

export class BlockedAddressError extends Error {
  readonly code = "EBLOCKED";
  constructor(host: string) {
    super(`${host} resolves to a non-public address`);
  }
}

export type Resolved = { address: string; family: number };
export type Resolver = (host: string, callback: (error: NodeJS.ErrnoException | null, addresses: Resolved[]) => void) => void;

const systemResolver: Resolver = (host, callback) => {
  dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => callback(error, addresses ?? []));
};

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * A `lookup` function for https.request. It runs at CONNECTION time and the socket connects to exactly the address it
 * returns, so the check cannot be outrun by a DNS answer that changes between "check" and "connect" (DNS rebinding).
 * If ANY of the addresses of the name is non-public, the whole name is refused.
 */
export function createSafeLookup(resolve: Resolver = systemResolver) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, []);
      if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
        return callback(new BlockedAddressError(hostname), []);
      }
      if (options.all) return callback(null, addresses);
      const first = addresses[0] as Resolved;
      return callback(null, first.address, first.family);
    });
  };
}
