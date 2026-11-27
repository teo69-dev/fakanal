import { describe, expect, it } from "vitest";
import { BlockedAddressError, createSafeLookup, isPublicAddress, type Resolved, type Resolver } from "./ssrf";

describe("isPublicAddress", () => {
  it("accepts ordinary public addresses", () => {
    for (const ok of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:81b::200e", "2620:4f:8000::1", "2001:200::1"]) {
      expect(isPublicAddress(ok), ok).toBe(true);
    }
  });

  it("refuses loopback, private, link-local, metadata and carrier-grade NAT IPv4 ranges", () => {
    for (const bad of [
      "0.0.0.0",
      "0.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "100.64.0.1",
      "100.127.255.255",
      "127.0.0.1",
      "127.255.255.254",
      "169.254.169.254",
      "169.254.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
      "192.0.0.1",
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });

  it("refuses documentation, benchmarking, multicast and reserved IPv4 ranges", () => {
    for (const bad of ["192.0.2.1", "198.51.100.7", "203.0.113.9", "198.18.0.1", "198.19.255.255", "192.88.99.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255"]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });

  it("refuses IPv6 loopback, unspecified, link-local, unique-local, multicast and mapped or NAT64 forms", () => {
    for (const bad of [
      "::",
      "::1",
      "fe80::1",
      "fe80::1234:5678",
      "fc00::1",
      "fd12:3456:789a::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
      "::ffff:8.8.8.8", // even a mapped PUBLIC address is not accepted: only plain global unicast is
      "64:ff9b::7f00:1",
      "2001:db8::1",
      "2001::1", // Teredo
      "2001:2::1", // benchmarking
      "2001:10::1", // ORCHID
      "2001:1ff::1", // the rest of 2001::/23 (IETF protocol assignments)
      "2001:4:112::1", // AS112 sits inside the IETF block too: refused with it (a recipe site does not live there)
      "2002:7f00:1::1", // 6to4 embedding 127.0.0.1
      "3fff::1",
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });

  it("refuses anything that is not an address", () => {
    for (const bad of ["", "localhost", "example.com", "1.2.3", "999.1.1.1", "1.2.3.4.5", " 8.8.8.8", "8.8.8.8 ", "0x7f.0.0.1", "2130706433", "::g"]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

const resolverOf = (...answers: (Resolved[] | Error)[]): Resolver => {
  let call = 0;
  return (_host, callback) => {
    const answer = answers[Math.min(call++, answers.length - 1)] as Resolved[] | Error;
    if (answer instanceof Error) callback(answer as NodeJS.ErrnoException, []);
    else callback(null, answer);
  };
};

type Result = { error: NodeJS.ErrnoException | null; address: unknown; family: unknown };
const look = (lookup: ReturnType<typeof createSafeLookup>, options: { all?: boolean } = {}) =>
  new Promise<Result>((resolve) => lookup("example.com", options, (error, address, family) => resolve({ error, address, family })));

describe("createSafeLookup", () => {
  const PUBLIC: Resolved = { address: "93.184.216.34", family: 4 };

  it("hands a public answer to the connection, as one address or as the list", async () => {
    const lookup = createSafeLookup(resolverOf([PUBLIC]));
    expect(await look(lookup)).toEqual({ error: null, address: "93.184.216.34", family: 4 });
    expect(await look(lookup, { all: true })).toEqual({ error: null, address: [PUBLIC], family: undefined });
  });

  it("refuses a name that resolves to a private address", async () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
      const lookup = createSafeLookup(resolverOf([{ address, family: address.includes(":") ? 6 : 4 }]));
      const r = await look(lookup);
      expect(r.error, address).toBeInstanceOf(BlockedAddressError);
      expect(r.error?.code, address).toBe("EBLOCKED");
    }
  });

  it("refuses the whole name when ANY of its addresses is not public (a mix of public and private)", async () => {
    const lookup = createSafeLookup(resolverOf([PUBLIC, { address: "127.0.0.1", family: 4 }]));
    expect((await look(lookup, { all: true })).error).toBeInstanceOf(BlockedAddressError);
    expect((await look(lookup)).error).toBeInstanceOf(BlockedAddressError);
  });

  it("refuses an empty answer", async () => {
    expect((await look(createSafeLookup(resolverOf([])))).error).toBeInstanceOf(BlockedAddressError);
  });

  it("passes a resolver error on unchanged", async () => {
    const failure = Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    const r = await look(createSafeLookup(resolverOf(failure)));
    expect(r.error?.code).toBe("ENOTFOUND");
  });

  it("checks EVERY connection afresh, so an answer that turns private later (DNS rebinding) is caught", async () => {
    const lookup = createSafeLookup(resolverOf([PUBLIC], [{ address: "127.0.0.1", family: 4 }]));
    expect((await look(lookup)).error).toBeNull(); // the first answer is public
    expect((await look(lookup)).error).toBeInstanceOf(BlockedAddressError); // the name now points inside: refused
  });
});
