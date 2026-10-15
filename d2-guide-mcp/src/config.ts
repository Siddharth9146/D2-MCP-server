import { config as loadEnv } from "dotenv";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Load .env from the project root regardless of the cwd the MCP client launches us from.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(projectRoot, ".env"), quiet: true });

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env in ${projectRoot} and fill in your Bungie app details.`,
    );
  }
  return v;
}

export const home = process.env.D2_GUIDE_HOME ?? path.join(os.homedir(), ".d2-guide");
fs.mkdirSync(home, { recursive: true });

export const config = {
  get apiKey() {
    return required("BUNGIE_API_KEY");
  },
  get clientId() {
    return required("BUNGIE_CLIENT_ID");
  },
  get clientSecret() {
    return required("BUNGIE_CLIENT_SECRET");
  },
  redirectUrl: process.env.BUNGIE_REDIRECT_URL ?? "https://localhost:7778/callback",
  language: process.env.D2_LANGUAGE ?? "en",
  /** Overridable only so the smoke test can point at a local mock. */
  baseUrl: process.env.BUNGIE_BASE_URL ?? "https://www.bungie.net",
  tokenFile: path.join(home, "tokens.json"),
  manifestDir: path.join(home, "manifest"),
  userAgent: "d2-guide-mcp/0.1.0 (+https://github.com/)",
};

/** stdout belongs to the MCP protocol — all logging goes to stderr. */
export function log(...args: unknown[]) {
  console.error("[d2-guide]", ...args);
}
