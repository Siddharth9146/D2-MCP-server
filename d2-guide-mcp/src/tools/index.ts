import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProfile, type OwnedItem, CLASS_NAMES, AMMO_NAMES } from "../bungie/profile.js";
import { getManifest } from "../bungie/manifest.js";
import { text, itemLine, where, agoText, perkLines, matchClass } from "./format.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const WEAPON = 3;
const ARMOR = 2;
const SUBCLASS = 16;

/** Turn thrown errors into tool results the model can read and relay. */
function safe<A>(fn: (args: A) => Promise<ReturnType<typeof text>>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      return { ...text(`Error: ${e instanceof Error ? e.message : String(e)}`), isError: true };
    }
  };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "get_account_overview",
    {
      title: "Account overview",
      description:
        "Start here. Summarises the player's Destiny 2 account: Bungie name, each character's class, power level, " +
        "hours played and how long since they last played, currencies, and how full the vault and Postmaster are. " +
        "Use it to judge whether the player is new, returning after a break, or active.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const p = await getProfile();
      const lines = [`# ${p.membership.bungieName}`, "", "## Characters"];
      for (const c of p.characters) {
        lines.push(
          `- **${c.className}** — power ${c.power}, ${Math.round(c.minutesPlayedTotal / 60)} h played, ` +
            `last played ${agoText(c.dateLastPlayed)} (id ${c.characterId})`,
        );
      }
      const vault = p.items.filter((i) => i.location === "vault");
      const postmaster = p.items.filter((i) => i.location === "postmaster");
      lines.push(
        "",
        "## Storage",
        `- Vault: ${vault.length} items (${vault.filter((i) => i.itemType === WEAPON).length} weapons, ` +
          `${vault.filter((i) => i.itemType === ARMOR).length} armor)`,
        `- Postmaster: ${postmaster.length} item${postmaster.length === 1 ? "" : "s"} waiting${postmaster.length ? " — the Postmaster has limited space; items are lost if it overflows" : ""}`,
      );
      if (p.currencies.length) {
        lines.push("", "## Currencies", ...p.currencies.map((c) => `- ${c.name}: ${c.quantity.toLocaleString()}`));
      }
      const built = (await getManifest()).builtOn();
      if (built) {
        lines.push(
          "",
          "## Game data freshness",
          `- Item and perk descriptions in these tools come from Bungie's game data dated ${built}. Anything changed by a later update is not reflected here, so check later patch notes before relying on it.`,
        );
      }
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "get_equipped_loadout",
    {
      title: "Equipped loadout",
      description:
        "Shows what a character currently has equipped: subclass, the three weapons (with element, ammo type and perks) " +
        "and armor (with stats and exotic perks). Use this to explain the player's current build in plain language.",
      inputSchema: {
        character: z
          .string()
          .optional()
          .describe('Class name: "Titan", "Hunter", "Warlock", or "all". Defaults to the most recently played character.'),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ character }: { character?: string }) => {
      const p = await getProfile();
      const chars = character ? matchClass(p, character) : p.characters.slice(0, 1);
      const out: string[] = [];
      for (const c of chars) {
        const eq = p.items.filter((i) => i.location === "equipped" && i.characterId === c.characterId);
        out.push(`# ${c.className} (power ${c.power})`);
        const sub = eq.find((i) => i.itemType === SUBCLASS);
        if (sub) out.push(`Subclass: **${sub.name}**${sub.damageType ? ` (${sub.damageType})` : ""}`);
        if (sub?.perks?.length) out.push(...subclassLines(sub));
        out.push("", "## Weapons", ...eq.filter((i) => i.itemType === WEAPON).map((i) => detailLine(i)));
        out.push("", "## Armor", ...eq.filter((i) => i.itemType === ARMOR).map((i) => detailLine(i)));
        out.push("");
      }
      return text(out.join("\n"));
    }),
  );

  server.registerTool(
    "search_my_items",
    {
      title: "Search my items",
      description:
        "Searches everything the player owns (all characters, vault, Postmaster). Filter by name text, kind, rarity, " +
        "element or class. Returns one line per item with where it is and its instance id (pass that id to explain_my_item).",
      inputSchema: {
        query: z.string().optional().describe("Text to match in the item name or type, e.g. 'hand cannon', 'Ace of Spades'"),
        kind: z.enum(["weapon", "armor", "any"]).default("any"),
        rarity: z.enum(["Exotic", "Legendary", "Rare", "Uncommon", "Common"]).optional(),
        element: z.string().optional().describe("Kinetic, Arc, Solar, Void, Stasis, Strand or Prismatic"),
        forClass: z.enum(["Titan", "Hunter", "Warlock"]).optional().describe("Only armor/items usable by this class"),
        location: z.enum(["vault", "equipped", "character", "postmaster"]).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: READ_ONLY,
    },
    safe(async (a: {
      query?: string;
      kind: "weapon" | "armor" | "any";
      rarity?: string;
      element?: string;
      forClass?: string;
      location?: string;
      limit: number;
    }) => {
      const p = await getProfile();
      const q = a.query?.toLowerCase();
      const classType = a.forClass ? Number(Object.entries(CLASS_NAMES).find(([, n]) => n === a.forClass)?.[0]) : undefined;
      const hits = p.items.filter(
        (i) =>
          (i.itemType === WEAPON || i.itemType === ARMOR || a.kind === "any") &&
          (a.kind !== "weapon" || i.itemType === WEAPON) &&
          (a.kind !== "armor" || i.itemType === ARMOR) &&
          (!q || i.name.toLowerCase().includes(q) || i.typeName.toLowerCase().includes(q)) &&
          (!a.rarity || i.tierName === a.rarity) &&
          (!a.element || i.damageType?.toLowerCase() === a.element.toLowerCase()) &&
          (classType === undefined || i.classType === classType || i.classType === 3) &&
          (!a.location || i.location === a.location),
      );
      if (!hits.length) return text("No matching items.");
      const tierRank = (t?: string) => ["Exotic", "Legendary", "Rare", "Uncommon", "Common"].indexOf(t ?? "") >>> 0;
      hits.sort((x, y) => tierRank(x.tierName) - tierRank(y.tierName) || (y.power ?? 0) - (x.power ?? 0) || x.name.localeCompare(y.name));
      const shown = hits.slice(0, a.limit);
      return text(
        `${hits.length} match${hits.length === 1 ? "" : "es"}${hits.length > shown.length ? ` (showing ${shown.length})` : ""}:\n` +
          shown.map((i) => itemLine(p, i)).join("\n"),
      );
    }),
  );

  server.registerTool(
    "explain_my_item",
    {
      title: "Explain one of my items",
      description:
        "Full detail on an item the player owns: description, lore line, every perk with its in-game description, stats, " +
        "where it drops, where the copy is, and how many copies they have. Use it to explain what an item does and whether it's worth keeping.",
      inputSchema: {
        item: z.string().describe("Item name (e.g. 'Gjallarhorn') or an instance id from search_my_items"),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ item }: { item: string }) => {
      const [p, m] = await Promise.all([getProfile(), getManifest()]);
      const q = item.trim().toLowerCase();
      let copies = p.items.filter((i) => i.instanceId === item.trim());
      if (!copies.length) copies = p.items.filter((i) => i.name.toLowerCase() === q);
      if (!copies.length) copies = p.items.filter((i) => i.name.toLowerCase().includes(q));
      if (!copies.length) {
        return text(`The player doesn't own anything matching "${item}". Use lookup_game_definition to explain an item they don't own.`);
      }
      const names = [...new Set(copies.map((c) => c.name))];
      if (names.length > 1) {
        return text(`"${item}" matches several items — ask which one:\n${names.slice(0, 15).map((n) => `- ${n}`).join("\n")}`);
      }
      const first = copies[0];
      const def = m.item(first.hash)!;
      const source = def.collectibleHash ? m.t.collectibles[def.collectibleHash]?.source : undefined;
      const out = [
        `# ${def.name}`,
        `${[def.tierName, first.damageType, def.typeName].filter(Boolean).join(" ")}${first.ammo ? ` · ${first.ammo} ammo` : ""}` +
          `${def.classType !== 3 ? ` · ${CLASS_NAMES[def.classType]} only` : ""}`,
      ];
      if (def.description) out.push("", def.description);
      if (def.flavorText) out.push("", `_${def.flavorText}_`);
      if (source) out.push("", `**Source:** ${source}`);
      out.push("", `## Copies owned: ${copies.length}`);
      for (const c of copies) {
        out.push(`### ${where(p, c)}${c.instanceId ? ` (id ${c.instanceId})` : ""}`);
        if (c.power) out.push(`Power ${c.power}`);
        if (c.stats && Object.keys(c.stats).length) {
          out.push(`Stats: ${Object.entries(c.stats).filter(([, v]) => v !== 0 || c.itemType === ARMOR).map(([k, v]) => `${k} ${v}`).join(", ")}`);
        }
        for (const perk of c.perks ?? []) {
          out.push(`- **${perk.name}**${perk.type ? ` (${perk.type})` : ""}: ${perk.description || "—"}`);
        }
      }
      return text(out.join("\n"));
    }),
  );

  server.registerTool(
    "lookup_game_definition",
    {
      title: "Look up anything in the game",
      description:
        "Searches Destiny 2's official game data (the manifest) for any item, perk, mod or activity by name — including " +
        "things the player does not own. Use it to answer 'what is X?' with Bungie's own description instead of guessing.",
      inputSchema: {
        name: z.string().describe("Name or part of a name, e.g. 'Gjallarhorn', 'Kill Clip', 'Pantheon'"),
        kind: z.enum(["item", "activity", "any"]).default("any"),
        limit: z.number().int().min(1).max(10).default(5),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ name, kind, limit }: { name: string; kind: "item" | "activity" | "any"; limit: number }) => {
      const m = await getManifest();
      const hits = m.search(name, kind, limit);
      if (!hits.length) return text(`Nothing in the game data matches "${name}".`);
      const out: string[] = [];
      for (const h of hits) {
        if (h.kind === "item") {
          const d = m.t.items[h.hash];
          const src = d.collectibleHash ? m.t.collectibles[d.collectibleHash]?.source : undefined;
          const dmg = d.damageTypeHash ? m.t.damageTypes[d.damageTypeHash]?.name : undefined;
          out.push(
            `## ${d.name}\n${[d.tierName, dmg, d.typeName].filter(Boolean).join(" ") || "Item"}` +
              `${d.ammoType ? ` · ${AMMO_NAMES[d.ammoType]} ammo` : ""}${d.classType !== 3 ? ` · ${CLASS_NAMES[d.classType]}` : ""}` +
              `${d.description ? `\n${d.description}` : ""}${d.flavorText ? `\n_${d.flavorText}_` : ""}${src ? `\nSource: ${src}` : ""}`,
          );
        } else {
          const a = m.t.activities[h.hash];
          const type = a.activityTypeHash ? m.t.activityTypes[a.activityTypeHash]?.name : undefined;
          out.push(`## ${a.name} (activity${type ? `: ${type}` : ""}${a.isPvP ? ", PvP" : ""})\n${a.description || "—"}`);
        }
      }
      return text(out.join("\n\n"));
    }),
  );

  server.registerTool(
    "vault_cleanup_summary",
    {
      title: "Vault cleanup summary",
      description:
        "Helps a returning player make sense of a cluttered vault: counts by category and rarity, duplicate weapons and " +
        "armor (same item, several copies), and anything stuck at the Postmaster. Use it to suggest what to review first. " +
        "Never tell the player to delete exotics or items you haven't looked at with explain_my_item.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    safe(async () => {
      const p = await getProfile();
      const gear = p.items.filter((i) => i.itemType === WEAPON || i.itemType === ARMOR);
      const vault = gear.filter((i) => i.location === "vault");

      const byType = new Map<string, number>();
      for (const i of vault) byType.set(i.typeName, (byType.get(i.typeName) ?? 0) + 1);
      const byTier = new Map<string, number>();
      for (const i of vault) byTier.set(i.tierName ?? "?", (byTier.get(i.tierName ?? "?") ?? 0) + 1);

      const dupes = new Map<string, OwnedItem[]>();
      for (const i of gear) {
        if (!i.instanceId) continue;
        const k = `${i.hash}`;
        dupes.set(k, [...(dupes.get(k) ?? []), i]);
      }
      const dupeList = [...dupes.values()].filter((v) => v.length > 1).sort((a, b) => b.length - a.length);
      const dupeWeapons = dupeList.filter((v) => v[0].itemType === WEAPON);
      const dupeArmor = dupeList.filter((v) => v[0].itemType === ARMOR);
      const dupeLine = (v: OwnedItem[]) =>
        `- ${v[0].name} (${v[0].tierName === "Exotic" ? "Exotic " : ""}${v[0].typeName}) ×${v.length}`;
      const postmaster = p.items.filter((i) => i.location === "postmaster");

      const out = [
        `# Vault: ${vault.length} weapons & armor`,
        "",
        "## By rarity",
        ...[...byTier].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
        "",
        "## Biggest categories",
        ...[...byType].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `- ${k}: ${v}`),
        "",
        `## Duplicate weapons (${dupeWeapons.length} different weapons with more than one copy)`,
        ...dupeWeapons.slice(0, 15).map(dupeLine),
        "",
        `## Duplicate armor (${dupeArmor.length} different pieces with more than one copy; rolls and stats differ, so compare before dismantling)`,
        ...dupeArmor.slice(0, 10).map(dupeLine),
      ];
      if (postmaster.length) {
        out.push("", `## Postmaster (${postmaster.length} items; each character's Postmaster holds 21 and drops the oldest when full)`);
        for (const ch of p.characters) {
          const mine = postmaster.filter((i) => i.characterId === ch.characterId);
          if (!mine.length) continue;
          const counts = new Map<string, number>();
          for (const i of mine) {
            const k = [i.name, i.tierName === "Legendary" ? "" : i.tierName, i.typeName].filter(Boolean).join(" · ");
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
          out.push(`- **${ch.className}** (${mine.length}/21): ${[...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join("; ")}`);
        }
      }
      return text(out.join("\n"));
    }),
  );
}

function detailLine(i: OwnedItem): string {
  let s = `- **${i.name}** — ${[i.tierName, i.damageType, i.typeName].filter(Boolean).join(" ")}`;
  if (i.ammo) s += ` · ${i.ammo} ammo`;
  if (i.power) s += ` · power ${i.power}`;
  if (i.itemType === ARMOR && i.stats && Object.keys(i.stats).length) {
    const total = Object.values(i.stats).reduce((a, b) => a + b, 0);
    s += `\n  stats (total ${total}): ${Object.entries(i.stats).map(([k, v]) => `${k} ${v}`).join(", ")}`;
  }
  for (const l of perkLines(i)) s += `\n  ${l}`;
  if (i.tierName === "Exotic") {
    for (const p of i.perks ?? []) {
      if (p.type === "Intrinsic" && p.description) s += `\n  exotic perk — ${p.name}: ${p.description.replace(/\s+/g, " ").slice(0, 400)}`;
    }
  }
  return s;
}

/** Group a subclass's plugs by kind (Super, Aspect, Fragment...) so the build reads like the in-game screen. */
function subclassLines(sub: OwnedItem): string[] {
  const groups = new Map<string, { name: string; description?: string }[]>();
  for (const p of sub.perks ?? []) groups.set(p.type || "Other", [...(groups.get(p.type || "Other") ?? []), p]);
  return [...groups].map(([type, ps]) => `- ${type}: ${ps.map((p) => (p.description ? `${p.name} — ${p.description.replace(/\s+/g, " ").slice(0, 200)}` : p.name)).join("; ")}`);
}
