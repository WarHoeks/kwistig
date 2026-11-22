import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Fetches a public http(s) URL for the admin (image URLs on import, news
 * articles). Refuses loopback, private, link-local and other non-public
 * addresses, re-checks every redirect, and caps time and size, so a quiz file
 * can't make the server probe the home network.
 */

export class FetchError extends Error {}

let enabled = true;
/** Turns all outbound fetches off (tests, or an install without internet). */
export function setExternalFetch(on: boolean) {
  enabled = on;
}

function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT / Tailscale
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return false;
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return false;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPublicIp(mapped[1]!);
  return true;
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("unsupported_url");
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) throw new FetchError("unsupported_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new FetchError("host_not_found");
  if (!addrs.every((a) => isPublicIp(a.address))) throw new FetchError("private_address");
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
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    if (!enabled) throw new FetchError("offline");
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { accept, "user-agent": "Kwistig/0.1 (self-hosted quiz app)" },
    }).catch((e: unknown) => {
      throw new FetchError((e as Error).name === "TimeoutError" ? "timeout" : "fetch_failed");
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body) throw new FetchError(`http_${res.status}`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new FetchError("too_large");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) throw new FetchError("too_large");
      chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "", finalUrl: url.toString() };
  }
  throw new FetchError("too_many_redirects");
}

export const _test = { isPublicIp };
