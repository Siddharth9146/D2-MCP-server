import fs from "node:fs";
import { config, log } from "../config.js";

export interface Tokens {
  access_token: string;
  expires_at: number; // epoch ms
  refresh_token?: string;
  refresh_expires_at?: number; // epoch ms
  membership_id: string; // Bungie.net membership id
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  membership_id: string;
}

export function authorizeUrl(state: string): string {
  const u = new URL("/en/OAuth/Authorize", config.baseUrl);
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(new URL("/Platform/App/OAuth/Token/", config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      "X-API-Key": config.apiKey,
      "User-Agent": config.userAgent,
    },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Bungie token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const t = JSON.parse(text) as TokenResponse;
  const now = Date.now();
  return {
    access_token: t.access_token,
    // Refresh a minute early so a request never goes out with a token about to expire.
    expires_at: now + (t.expires_in - 60) * 1000,
    refresh_token: t.refresh_token,
    refresh_expires_at: t.refresh_expires_in ? now + t.refresh_expires_in * 1000 : undefined,
    membership_id: t.membership_id,
  };
}

export async function exchangeCode(code: string): Promise<Tokens> {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code });
  saveTokens(tokens);
  return tokens;
}

export function loadTokens(): Tokens | null {
  try {
    return JSON.parse(fs.readFileSync(config.tokenFile, "utf8")) as Tokens;
  } catch {
    return null;
  }
}

export function saveTokens(t: Tokens) {
  fs.writeFileSync(config.tokenFile, JSON.stringify(t, null, 2), { mode: 0o600 });
}

export class NotLoggedInError extends Error {
  constructor(reason: string) {
    super(
      `${reason} Run \`npm run login\` in the d2-guide-mcp folder to connect your Bungie account, then try again.`,
    );
  }
}

let refreshing: Promise<Tokens> | null = null;

/** Returns a valid access token, refreshing it if needed. */
export async function getAccessToken(forceRefresh = false): Promise<Tokens> {
  const t = loadTokens();
  if (!t) throw new NotLoggedInError("Not logged in to Bungie.net.");
  if (!forceRefresh && Date.now() < t.expires_at) return t;

  if (!t.refresh_token || (t.refresh_expires_at && Date.now() > t.refresh_expires_at)) {
    throw new NotLoggedInError("Your Bungie login has expired.");
  }
  // Collapse concurrent refreshes into one request.
  refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token })
    .then((nt) => {
      saveTokens(nt);
      log("refreshed Bungie access token");
      return nt;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
