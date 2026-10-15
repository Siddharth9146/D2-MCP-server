#!/usr/bin/env node
/**
 * One-time login: opens Bungie's consent page and catches the redirect on a local
 * HTTPS server. Bungie only allows https redirect URLs, so we serve a self-signed
 * certificate — your browser will warn once; click "Advanced → proceed to localhost".
 */
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { generate } from "selfsigned";
import { config, home } from "./config.js";
import { authorizeUrl, exchangeCode } from "./bungie/auth.js";

async function cert() {
  const keyFile = path.join(home, "localhost-key.pem");
  const certFile = path.join(home, "localhost-cert.pem");
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  const pems = await generate([{ name: "commonName", value: "localhost" }], { keySize: 2048, algorithm: "sha256" });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui;max-width:520px;margin:15vh auto;padding:0 16px;line-height:1.5">
<h2>${title}</h2><p>${body}</p></body>`;

async function main() {
  const redirect = new URL(config.redirectUrl);
  if (redirect.protocol !== "https:" || !["localhost", "127.0.0.1"].includes(redirect.hostname)) {
    throw new Error(`BUNGIE_REDIRECT_URL must be https://localhost:<port>/<path> (got ${config.redirectUrl})`);
  }
  const state = crypto.randomBytes(16).toString("hex");
  const port = Number(redirect.port || 443);

  const done = new Promise<void>(async (resolve, reject) => {
    const server = https.createServer(await cert(), async (req, res) => {
      const url = new URL(req.url ?? "/", config.redirectUrl);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state || !code) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(page("Login failed", "State mismatch or missing code. Run <code>npm run login</code> again."));
        return;
      }
      try {
        const t = await exchangeCode(code);
        res.writeHead(200, { "Content-Type": "text/html" }).end(page("Connected ✔", "Your Bungie account is linked. You can close this tab and go back to your terminal."));
        console.log(`\nLogged in (Bungie.net membership ${t.membership_id}). Tokens saved to ${config.tokenFile}`);
        server.close();
        resolve();
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/html" }).end(page("Login failed", String(e)));
        server.close();
        reject(e);
      }
    });
    server.on("error", reject);
    server.listen(port, () => {
      const url = authorizeUrl(state);
      console.log("Opening Bungie.net to authorize d2-guide-mcp…\nIf nothing opens, visit:\n\n  " + url + "\n");
      console.log("Your browser will warn about the localhost certificate — that's expected; proceed to localhost.");
      openBrowser(url);
    });
  });
  await done;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
