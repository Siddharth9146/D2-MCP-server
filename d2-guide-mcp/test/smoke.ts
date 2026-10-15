/**
 * End-to-end smoke test with no Bungie account needed: starts a mock of the Bungie.net
 * API, launches the built MCP server against it over stdio, and calls every tool and prompt.
 *   npm run build && npm run smoke
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const dp = (name: string, description = "") => ({ displayProperties: { name, description, icon: "/i.png" } });

// --- Fake manifest -------------------------------------------------------------
const DMG = { kinetic: 10, arc: 11, solar: 12, void: 13 };
const items: Record<number, any> = {
  1: { hash: 1, ...dp("Gjallarhorn", "Wolfpack rounds go hunting."), flavorText: "If there is a beast, this is its bane.", itemTypeDisplayName: "Rocket Launcher", inventory: { tierTypeName: "Exotic", bucketTypeHash: 500 }, itemType: 3, itemSubType: 8, classType: 3, defaultDamageTypeHash: DMG.solar, equippingBlock: { ammoType: 3 }, collectibleHash: 900, equippable: true },
  2: { hash: 2, ...dp("Ace of Spades"), itemTypeDisplayName: "Hand Cannon", inventory: { tierTypeName: "Exotic" }, itemType: 3, classType: 3, defaultDamageTypeHash: DMG.kinetic, equippingBlock: { ammoType: 1 }, equippable: true },
  3: { hash: 3, ...dp("Fatebringer"), itemTypeDisplayName: "Hand Cannon", inventory: { tierTypeName: "Legendary" }, itemType: 3, classType: 3, defaultDamageTypeHash: DMG.arc, equippingBlock: { ammoType: 1 }, collectibleHash: 901, equippable: true },
  4: { hash: 4, ...dp("Celestial Nighthawk", "Golden Gun fires one devastating shot."), itemTypeDisplayName: "Helmet", inventory: { tierTypeName: "Exotic" }, itemType: 2, classType: 1, equippable: true },
  5: { hash: 5, ...dp("Iron Forerunner Mask"), itemTypeDisplayName: "Helmet", inventory: { tierTypeName: "Legendary" }, itemType: 2, classType: 1, equippable: true },
  6: { hash: 6, ...dp("Nightstalker"), itemTypeDisplayName: "Void Subclass", itemType: 16, classType: 1, defaultDamageTypeHash: DMG.void, equippable: true },
  7: { hash: 7, ...dp("Glimmer"), itemTypeDisplayName: "Currency", itemType: 0, classType: 3 },
  8: { hash: 8, ...dp("Legendary Engram"), itemTypeDisplayName: "Engram", inventory: { tierTypeName: "Legendary" }, itemType: 8, classType: 3 },
  9: { hash: 9, ...dp("Iron Mountain Ward", "Hidden test armor"), itemTypeDisplayName: "Gauntlets", inventory: { tierTypeName: "Legendary" }, itemType: 2, classType: 0, equippable: true },
  // Plugs
  101: { hash: 101, ...dp("Wolfpack Rounds", "Rockets split into tracking cluster missiles."), itemTypeDisplayName: "Intrinsic", plug: { plugCategoryIdentifier: "intrinsics" } },
  102: { hash: 102, ...dp("Explosive Payload", "Projectiles deal additional area damage."), itemTypeDisplayName: "Trait", plug: { plugCategoryIdentifier: "frames" } },
  103: { hash: 103, ...dp("Default Shader"), itemTypeDisplayName: "Shader", plug: { plugCategoryIdentifier: "shader" } },
  104: { hash: 104, ...dp("Kill Clip", "Reloading after a kill grants increased damage."), itemTypeDisplayName: "Trait", plug: { plugCategoryIdentifier: "frames" } },
  105: { hash: 105, ...dp("Cosmetic Ornament"), itemTypeDisplayName: "Ornament", plug: { plugCategoryIdentifier: "armor_skins_hunter_head" } },
  106: { hash: 106, ...dp("Shadowshot", "Fire a tether that slows and weakens targets."), itemTypeDisplayName: "Void Super", plug: { plugCategoryIdentifier: "supers" } },
  107: { hash: 107, ...dp("Trapper's Ambush"), itemTypeDisplayName: "Void Aspect", plug: { plugCategoryIdentifier: "aspects" }, perks: [{ perkHash: 5000 }] },
  199: { hash: 199, ...dp(""), redacted: true },
};
const tables: Record<string, any> = {
  DestinyInventoryItemDefinition: items,
  DestinyStatDefinition: { 201: { hash: 201, ...dp("Impact") }, 202: { hash: 202, ...dp("Range") }, 203: { hash: 203, ...dp("Health") }, 204: { hash: 204, ...dp("Class") } },
  DestinyDamageTypeDefinition: { [DMG.kinetic]: { hash: DMG.kinetic, ...dp("Kinetic") }, [DMG.arc]: { hash: DMG.arc, ...dp("Arc") }, [DMG.solar]: { hash: DMG.solar, ...dp("Solar") }, [DMG.void]: { hash: DMG.void, ...dp("Void") } },
  DestinyClassDefinition: { 1: { hash: 1, classType: 1, ...dp("Hunter") } },
  DestinyInventoryBucketDefinition: { 138197802: { hash: 138197802, category: 2, ...dp("General") } },
  DestinyCollectibleDefinition: { 900: { hash: 900, sourceString: "Source: Exotic quest." }, 901: { hash: 901, sourceString: "Source: Vault of Glass raid." } },
  DestinyActivityDefinition: { 700: { hash: 700, ...dp("Pantheon", "Face the bosses of past raids in sequence."), activityTypeHash: 800, isPvP: false } },
  DestinyActivityTypeDefinition: { 800: { hash: 800, ...dp("Pinnacle Activity") } },
  DestinySandboxPerkDefinition: { 5000: { hash: 5000, ...dp("Trapper's Ambush", "Tethered targets take more damage.") } },
};

// --- Fake profile --------------------------------------------------------------
const HUNTER = "2305843009000000001";
const profile = {
  characters: {
    data: {
      [HUNTER]: { characterId: HUNTER, classType: 1, light: 450, minutesPlayedTotal: "54321", dateLastPlayed: "2025-12-01T10:00:00Z" },
    },
  },
  characterEquipment: {
    data: {
      [HUNTER]: {
        items: [
          { itemHash: 6, itemInstanceId: "s1", quantity: 1, bucketHash: 3284755031 },
          { itemHash: 2, itemInstanceId: "w1", quantity: 1, bucketHash: 1498876634 },
          { itemHash: 1, itemInstanceId: "w2", quantity: 1, bucketHash: 953998645 },
          { itemHash: 4, itemInstanceId: "a1", quantity: 1, bucketHash: 3448274439 },
        ],
      },
    },
  },
  characterInventories: {
    data: { [HUNTER]: { items: [{ itemHash: 8, quantity: 1, bucketHash: 215593132 }, { itemHash: 5, itemInstanceId: "a2", quantity: 1, bucketHash: 3448274439 }] } },
  },
  profileInventory: {
    data: {
      items: [
        { itemHash: 3, itemInstanceId: "v1", quantity: 1, bucketHash: 138197802 },
        { itemHash: 3, itemInstanceId: "v2", quantity: 1, bucketHash: 138197802 },
        { itemHash: 9, itemInstanceId: "v3", quantity: 1, bucketHash: 138197802 },
        { itemHash: 199, quantity: 1, bucketHash: 138197802 },
      ],
    },
  },
  profileCurrencies: { data: { items: [{ itemHash: 7, quantity: 250000 }] } },
  itemComponents: {
    instances: { data: { w1: { primaryStat: { value: 450 }, damageTypeHash: DMG.kinetic }, w2: { primaryStat: { value: 448 } }, v1: { primaryStat: { value: 400 } } } },
    stats: { data: { w2: { stats: { 201: { statHash: 201, value: 90 }, 202: { statHash: 202, value: 40 } } }, a1: { stats: { 203: { statHash: 203, value: 30 }, 204: { statHash: 204, value: 10 } } } } },
    sockets: {
      data: {
        w2: { sockets: [{ plugHash: 101, isVisible: true }, { plugHash: 102, isVisible: true }, { plugHash: 103, isVisible: true }] },
        s1: { sockets: [{ plugHash: 106, isVisible: true }, { plugHash: 107, isVisible: true }] },
        v1: { sockets: [{ plugHash: 104, isVisible: true }] },
        a1: { sockets: [{ plugHash: 105, isVisible: true }] },
      },
    },
  },
};

// --- Mock server ---------------------------------------------------------------
const calls: string[] = [];
const ok = (Response: unknown) => JSON.stringify({ Response, ErrorCode: 1, ErrorStatus: "Success", Message: "Ok" });
const mock = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  calls.push(`${req.method} ${url.pathname}`);
  const json = (code: number, body: string) => res.writeHead(code, { "Content-Type": "application/json" }).end(body);
  if (url.pathname.startsWith("/Platform") && req.headers["x-api-key"] !== "test-key") return json(401, "{}");

  if (url.pathname === "/Platform/App/OAuth/Token/") {
    return json(200, JSON.stringify({ access_token: "fresh", token_type: "Bearer", expires_in: 3600, refresh_token: "r2", refresh_expires_in: 7776000, membership_id: "42" }));
  }
  if (url.pathname === "/Platform/Destiny2/Manifest/") {
    const paths = Object.fromEntries(Object.keys(tables).map((t) => [t, `/common/json/en/${t}.json`]));
    return json(200, ok({ version: "100.26.06.29.2000-1-bnet.1", jsonWorldComponentContentPaths: { en: paths } }));
  }
  const tbl = url.pathname.match(/^\/common\/json\/en\/(\w+)\.json$/);
  if (tbl) return json(200, JSON.stringify(tables[tbl[1]]));

  // Everything below needs a valid (refreshed) bearer token.
  if (req.headers.authorization !== "Bearer fresh") return json(401, "{}");
  if (url.pathname === "/Platform/User/GetMembershipsForCurrentUser/") {
    return json(200, ok({ primaryMembershipId: "4611", destinyMemberships: [
      { membershipType: 2, membershipId: "999", displayName: "old", crossSaveOverride: 3 },
      { membershipType: 3, membershipId: "4611", bungieGlobalDisplayName: "Guardian", bungieGlobalDisplayNameCode: 42, crossSaveOverride: 3 },
    ] }));
  }
  if (url.pathname === "/Platform/Destiny2/3/Profile/4611/") return json(200, ok(profile));
  json(404, "{}");
});
await new Promise<void>((r) => mock.listen(0, r));
const port = (mock.address() as any).port;

// --- Run the real server against it -------------------------------------------
const home = fs.mkdtempSync(path.join(os.tmpdir(), "d2guide-"));
// Expired access token: forces the refresh path on the first authenticated call.
fs.writeFileSync(path.join(home, "tokens.json"), JSON.stringify({ access_token: "stale", expires_at: 0, refresh_token: "r1", refresh_expires_at: Date.now() + 1e9, membership_id: "42" }));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve("dist/index.js")],
  env: { ...process.env, BUNGIE_BASE_URL: `http://127.0.0.1:${port}`, D2_GUIDE_HOME: home, BUNGIE_API_KEY: "test-key", BUNGIE_CLIENT_ID: "1", BUNGIE_CLIENT_SECRET: "s" } as Record<string, string>,
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (d) => (stderr += d));
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const t = r.content.map((c: any) => c.text).join("\n");
  console.log(`\n━━ ${name} ${JSON.stringify(args)}${r.isError ? "  [isError]" : ""}\n${t}`);
  return { text: t as string, isError: !!r.isError };
};

let failed = false;
try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["explain_my_item", "get_account_overview", "get_equipped_loadout", "lookup_game_definition", "search_my_items", "vault_cleanup_summary"]);
  assert.ok((await client.listTools()).tools.every((t) => t.annotations?.readOnlyHint));

  let r = await call("get_account_overview");
  assert.match(r.text, /Guardian#0042/);
  assert.match(r.text, /Game data freshness[\s\S]*dated 2026-06-29/);
  assert.match(r.text, /Hunter\*\* — power 450, 905 h played/);
  assert.match(r.text, /Vault: 3 items \(2 weapons, 1 armor\)/);
  assert.match(r.text, /Postmaster: 1 item waiting/);
  assert.match(r.text, /Glimmer: 250,000/);

  r = await call("get_equipped_loadout", {});
  assert.match(r.text, /Subclass: \*\*Nightstalker\*\* \(Void\)/);
  assert.match(r.text, /Void Super: Shadowshot — Fire a tether/);
  assert.match(r.text, /Void Aspect: Trapper's Ambush — Tethered targets take more damage/);
  assert.match(r.text, /Gjallarhorn\*\* — Exotic Solar Rocket Launcher · Heavy ammo · power 448/);
  assert.match(r.text, /perks: Wolfpack Rounds, Explosive Payload/);
  assert.match(r.text, /exotic perk — Wolfpack Rounds: Rockets split into tracking cluster missiles/);
  assert.doesNotMatch(r.text, /Default Shader|Cosmetic Ornament/);
  assert.match(r.text, /stats \(total \d+\): Health 30, Class 10/);

  r = await call("get_equipped_loadout", { character: "Warlock" });
  assert.ok(r.isError && /No Warlock character/.test(r.text));

  r = await call("search_my_items", { query: "hand cannon", kind: "weapon" });
  assert.match(r.text, /^3 matches/);
  r = await call("search_my_items", { forClass: "Hunter", kind: "armor" });
  assert.match(r.text, /^2 matches/);
  assert.doesNotMatch(r.text, /Iron Mountain Ward/);
  r = await call("search_my_items", { element: "Arc" });
  assert.match(r.text, /^2 matches/);

  r = await call("explain_my_item", { item: "fatebringer" });
  assert.match(r.text, /Copies owned: 2/);
  assert.match(r.text, /\*\*Source:\*\* Vault of Glass raid/);
  assert.match(r.text, /Kill Clip\*\* \(Trait\): Reloading after a kill/);
  r = await call("explain_my_item", { item: "w2" });
  assert.match(r.text, /# Gjallarhorn/);
  assert.match(r.text, /Stats: Impact 90, Range 40/);
  r = await call("explain_my_item", { item: "Thunderlord" });
  assert.match(r.text, /doesn't own anything/);

  r = await call("lookup_game_definition", { name: "pantheon" });
  assert.match(r.text, /Pantheon \(activity: Pinnacle Activity\)/);
  r = await call("lookup_game_definition", { name: "kill clip", kind: "item" });
  assert.match(r.text, /Reloading after a kill/);

  r = await call("vault_cleanup_summary");
  assert.match(r.text, /Fatebringer \(Hand Cannon\) ×2/);
  assert.match(r.text, /Legendary Engram/);

  const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
  assert.deepEqual(prompts, ["explain_my_build", "returning_player_briefing"]);
  const pr: any = await client.getPrompt({ name: "returning_player_briefing", arguments: { focus: "raiding" } });
  assert.match(pr.messages[0].content.text, /get_account_overview[\s\S]*My focus: raiding/);
  // Hard rule: prompts must protect player creativity and limit build evaluation to endgame viability.
  const rule = /PLAYER CREATIVITY COMES FIRST[\s\S]*endgame content/;
  const communityPhrases = [
    "COMMUNITY SOURCES, ALWAYS",
    "Community input never overrides",
    "PROVEN SUGGESTIONS ARE WELCOME",
    "No evidence, no suggestion",
    "The evidence must also be current",
    "A BIT OLD source",
    "directly or indirectly",
    "not mentioned",
    "YOUTUBE AND CREATORS",
    "Always name the content creator or website",
    "FRESHNESS, ABSOLUTELY",
    "This Week in Destiny",
    "HOW TO CHECK FRESHNESS",
    "Never assume a year",
    "Game data freshness",
  ];
  const community = { test: (t: string) => communityPhrases.every((x) => t.includes(x)) };
  assert.match(pr.messages[0].content.text, new RegExp(`Today's date is ${new Date().toISOString().slice(0, 10)}`));
  assert.match(pr.messages[0].content.text, rule);
  assert.ok(community.test(pr.messages[0].content.text), "briefing prompt is missing a community/freshness rule");
  assert.doesNotMatch(pr.messages[0].content.text, /gap or easy improvement/);
  const eb: any = await client.getPrompt({ name: "explain_my_build", arguments: {} });
  assert.match(eb.messages[0].content.text, rule);
  assert.ok(community.test(eb.messages[0].content.text), "build prompt is missing a community/freshness rule");
  assert.doesNotMatch(eb.messages[0].content.text, /gap or easy improvement/);

  // Token was refreshed and persisted; manifest cached on disk.
  const saved = JSON.parse(fs.readFileSync(path.join(home, "tokens.json"), "utf8"));
  assert.equal(saved.access_token, "fresh");
  assert.ok(fs.existsSync(path.join(home, "manifest", "100.26.06.29.2000-1-bnet.1", "items.json")));
  const slim = JSON.parse(fs.readFileSync(path.join(home, "manifest", "100.26.06.29.2000-1-bnet.1", "items.json"), "utf8"));
  assert.ok(!slim[199], "redacted items are dropped");
  assert.equal(calls.filter((c) => c.endsWith("/OAuth/Token/")).length, 1, "exactly one refresh");
  assert.equal(calls.filter((c) => c.includes("/Profile/")).length, 1, "profile cached between calls");

  console.log("\n✅ all smoke checks passed");
} catch (e) {
  failed = true;
  console.error("\n❌", e, "\n--- server stderr ---\n" + stderr);
} finally {
  await client.close();
  mock.close();
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
