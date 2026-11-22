import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Fetches a public http(s) URL for the admin (image URLs on import, news
 * articles, YouTube checks), so a quiz file can't make the server probe the
 * home network:
 * - every resolved address is checked against non-public ranges with Node's
 *   BlockList (IPv4-mapped/compatible IPv6, NAT64 and 6to4 included);
 * - the check happens inside the socket's own DNS lookup, so the address that
 *   was validated is the one connected to (no DNS-rebinding window);
 * - redirects are followed by hand and re-checked; time and size are capped.
 */

export class FetchError extends Error {}

let enabled = true;
/** Turns all outbound fetches off (tests, or an install without internet). */
export function setExternalFetch(on: boolean) {
  enabled = on;
}

// Separate lists: Node matches IPv4 addresses against IPv6 rules as ::ffff:a.b.c.d,
// so the IPv4-mapped rule below would otherwise block every IPv4 address.
const blocked4 = new net.BlockList();
const blocked6 = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT, Tailscale
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) {
  blocked4.addSubnet(net4, prefix, "ipv4");
}
for (const [net6, prefix] of [
  ["::", 96], // unspecified, loopback and IPv4-compatible
  ["::ffff:0:0", 96], // IPv4-mapped: never needed for public fetches
  ["64:ff9b::", 96], // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64], // discard
  ["2001::", 23], // IETF special purpose, incl. Teredo
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked6.addSubnet(net6, prefix, "ipv6");
}

function isPublicIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !blocked4.check(ip, "ipv4");
  if (family === 6) return !blocked6.check(ip, "ipv6");
  return false;
}

/** DNS lookup for http(s).request that refuses non-public addresses. */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) return callback(new FetchError("host_not_found"), "", 0);
    if (!list.every((a) => isPublicIp(a.address))) return callback(new FetchError("private_address"), "", 0);
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0]!.address, list[0]!.family);
    }
  });
};

function checkUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("unsupported_url");
  if (url.username || url.password) throw new FetchError("unsupported_url");
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) throw new FetchError("unsupported_url");
  // Literal IPs never reach the lookup, so check them here.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicIp(host)) throw new FetchError("private_address");
}

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(url: URL, accept: string, maxBytes: number, deadline: number): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        headers: { accept, "accept-encoding": "identity", "user-agent": "Kwistig/0.1 (self-hosted quiz app)" },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
        }
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          res.destroy();
          return reject(new FetchError("too_large"));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new FetchError("too_large"));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", () => reject(new FetchError("fetch_failed")));
      },
    );
    req.on("timeout", () => req.destroy(new FetchError("timeout")));
    req.on("error", (e) => reject(e instanceof FetchError ? e : new FetchError("fetch_failed")));
    req.end();
  });
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

export async function safeFetch(
  raw: string,
  { maxBytes = 10 * 1024 * 1024, timeoutMs = 10_000, accept = "*/*" } = {},
): Promise<SafeFetchResult> {
  let url = new URL(raw);
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop < 4; hop++) {
    checkUrl(url);
    if (!enabled) throw new FetchError("offline");
    if (Date.now() >= deadline) throw new FetchError("timeout");
    const res = await request(url, accept, maxBytes, deadline);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location) throw new FetchError(`http_${res.status}`);
      url = new URL(location, url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new FetchError(`http_${res.status}`);
    return { buffer: res.body, contentType: String(res.headers["content-type"] ?? ""), finalUrl: url.toString() };
  }
  throw new FetchError("too_many_redirects");
}

export const _test = { isPublicIp, guardedLookup };
