# d2-guide-mcp

An MCP server that turns any MCP client into a Destiny 2 guide for **new and returning players**.
It reads your own account through the official Bungie.net API and explains what you have, what your build does,
and what to do next, using Bungie's own item and activity descriptions instead of guesses.

Version 0.1 is **read-only**. It never moves, equips or deletes anything.

## What it can do

| Tool | What it's for |
|---|---|
| `get_account_overview` | Characters, power, hours played, how long since you last played, currencies, vault/Postmaster fill |
| `get_equipped_loadout` | Subclass, weapons (element, ammo, perks) and armor (stats, exotic perks) for a character |
| `search_my_items` | Find anything you own by name, type, rarity, element, class or location |
| `explain_my_item` | Full breakdown of an item you own: perks with descriptions, stats, drop source, every copy |
| `lookup_game_definition` | "What is X?" for any item, perk or activity in the game, owned or not |
| `vault_cleanup_summary` | Duplicates, biggest categories, rarity mix, anything stuck at the Postmaster |

Prompts (shown as slash-commands / prompt templates in most clients):

- **returning_player_briefing** catches you up on your account and gives three next steps.
- **explain_my_build** explains how your equipped gear works together.

Try asking:
- "I haven't played since 2024. Catch me up."
- "What does my Hunter's build actually do?"
- "Which of my hand cannons are worth keeping?"
- "What's Pantheon?"

## Setup (about 10 minutes)

You need Node.js 20+ and a Bungie.net account with Destiny 2 characters.

### 1. Create a Bungie app

Go to <https://www.bungie.net/en/Application> → **Create New App**:

- **OAuth Client Type:** Confidential (this gives you a refresh token, so you only log in about every 90 days)
- **Redirect URL:** `https://localhost:7778/callback`
- **Scope:** tick *Read your Destiny 2 information (Vault, Inventory, and Vendors)*. Nothing else is needed for v0.1.
- **Origin Header:** leave blank

Save, then copy the **API Key**, **OAuth client_id** and **OAuth client_secret**.

### 2. Install and configure

```bash
cd d2-guide-mcp
npm install
npm run build
cp .env.example .env     # paste the three values into .env
```

### 3. Log in once

```bash
npm run login
```

Your browser opens Bungie's consent page. After you approve, it redirects to `https://localhost:7778/callback`.
The login command serves that page with a self-signed certificate, so **your browser will show a certificate warning**.
That's expected: choose *Advanced → Proceed to localhost*. Tokens are saved to `~/.d2-guide/tokens.json`
(owner-read-only) and refresh automatically.

### 4. Add it to your MCP client

Add a stdio server to your MCP client's configuration. The exact file and menu depend on the client, but the entry looks like this:

```json
{
  "mcpServers": {
    "d2-guide": {
      "command": "node",
      "args": ["--max-old-space-size=4096", "/ABSOLUTE/PATH/TO/d2-guide-mcp/dist/index.js"]
    }
  }
}
```

Clients with a command-line installer usually accept the same command directly, for example:

```bash
<client> mcp add d2-guide -- node --max-old-space-size=4096 /ABSOLUTE/PATH/TO/d2-guide-mcp/dist/index.js
```

Restart the client. **The first start downloads the game manifest** (Bungie's item and activity database), which takes
a minute or two. After that it's cached and only re-downloaded when Bungie ships an update.

To poke at the tools directly: `npx @modelcontextprotocol/inspector node dist/index.js`

## How it works

```
src/
  index.ts            MCP server (stdio), registers tools + prompts, warms the manifest
  login.ts            one-time OAuth login on a local HTTPS callback
  prompts.ts          returning_player_briefing, explain_my_build
  tools/index.ts      the six tools
  tools/format.ts     text formatting helpers
  bungie/auth.ts      token storage + automatic refresh
  bungie/client.ts    API wrapper: API key, bearer token, throttling, Bungie error envelope
  bungie/manifest.ts  versioned manifest cache, slimmed to the fields we use, name search
  bungie/profile.ts   fetches your profile and flattens it into one item list
test/smoke.ts         end-to-end test against a mock Bungie API
```

Design choices:

- **The assistant explains; the code fetches.** Every tool returns compact Markdown built from real API and manifest data,
  and the prompts tell the model to look things up instead of answering from memory. That matters because
  Destiny's sandbox changes, and vaulted content is being restored.
- **The manifest is versioned.** On each start the server checks Bungie's manifest version and re-downloads only when
  it changed, so restored campaigns, raids and their loot show up automatically. If Bungie is down, it falls back
  to the cached copy.
- **The manifest is slimmed.** The raw item table is huge, so we keep about 15 fields per item and write that to disk.
  Later starts load the slim copy quickly.
- **Profile reads are cached for 30 seconds**, so one question that triggers several tool calls makes one API request.
- **Cosmetic noise is hidden**: shaders, ornaments, trackers and empty sockets are filtered from perk lists.

## Testing

```bash
npm run build && npm run smoke
```

This starts a mock Bungie API, launches the real server against it and checks every tool and prompt, plus token
refresh, manifest caching and redacted-item filtering. No Bungie account is needed.

## Known limits / roadmap

- No write actions yet. A natural next step is `transfer_item` / `equip_item` with explicit confirmation. Bungie only
  allows equipping in orbit, a social space or when offline, and it needs the *Move or equip Destiny gear* scope.
- Stats come from the API's computed values; armor stat breakdowns (base vs. mods) aren't shown yet.
- No meta/"god roll" knowledge. Adding community wishlists (the format DIM uses) would let it say *why* a roll is good.
- Activity rotations and vendor inventories aren't exposed yet (`Destiny2/Milestones`, `Vendors` endpoints).

Not affiliated with Bungie. Destiny is a trademark of Bungie, Inc.
