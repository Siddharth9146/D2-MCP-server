import { config } from "../config.js";
import { getAccessToken } from "./auth.js";

/** Bungie wraps every response in this envelope; ErrorCode 1 means success. */
interface BungieEnvelope<T> {
  Response: T;
  ErrorCode: number;
  ErrorStatus: string;
  Message: string;
  ThrottleSeconds?: number;
}

export class BungieApiError extends Error {
  constructor(
    public status: string,
    message: string,
    public code: number,
  ) {
    super(`Bungie API error ${status}: ${message}`);
  }
}

// Bungie's documented limit is ~25 requests / 10s per app+user. Space requests out a little.
const MIN_INTERVAL_MS = 120;
let lastRequest = 0;
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  queue = queue.then(async () => {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
  });
  return queue;
}

export async function bungieGet<T>(pathAndQuery: string, opts: { auth?: boolean } = {}): Promise<T> {
  return request<T>(pathAndQuery, opts.auth ?? false, false);
}

async function request<T>(pathAndQuery: string, auth: boolean, retried: boolean): Promise<T> {
  await throttle();
  const headers: Record<string, string> = {
    "X-API-Key": config.apiKey,
    "User-Agent": config.userAgent,
  };
  if (auth) {
    const t = await getAccessToken(retried);
    headers.Authorization = `Bearer ${t.access_token}`;
  }

  const res = await fetch(new URL(`/Platform${pathAndQuery}`, config.baseUrl), { headers });

  if (res.status === 401 && auth && !retried) return request<T>(pathAndQuery, auth, true);

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    // Bungie serves HTML error pages during maintenance/outages.
    throw new BungieApiError(
      "NotJson",
      `Bungie.net returned a non-JSON response (HTTP ${res.status}). It may be down for maintenance.`,
      -1,
    );
  }
  const body = (await res.json()) as BungieEnvelope<T>;
  if (body.ErrorCode !== 1) {
    if (body.ErrorStatus === "SystemDisabled") {
      throw new BungieApiError(body.ErrorStatus, "The Destiny API is temporarily disabled (maintenance).", body.ErrorCode);
    }
    throw new BungieApiError(body.ErrorStatus, body.Message, body.ErrorCode);
  }
  return body.Response;
}

/** Fetch a static file Bungie hosts outside /Platform (manifest JSON tables). */
export async function bungieFile<T>(relativePath: string): Promise<T> {
  const res = await fetch(new URL(relativePath, config.baseUrl), {
    headers: { "User-Agent": config.userAgent },
  });
  if (!res.ok) throw new Error(`Failed to download ${relativePath}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
