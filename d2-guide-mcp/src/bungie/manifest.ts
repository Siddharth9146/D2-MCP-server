import fs from "node:fs";
import path from "node:path";
import { config, log } from "../config.js";
import { bungieFile, bungieGet } from "./client.js";

/**
 * We only keep the fields the tools actually use. The raw item table is very large;
 * slimming it once on download keeps memory and startup time reasonable afterwards.
 */
export interface ItemDef {
  hash: number;
  name: string;
  description: string;
  flavorText?: string;
  icon?: string;
  typeName: string; // e.g. "Auto Rifle", "Helmet", "Trait"
  tierName?: string; // "Exotic", "Legendary", ...
  itemType: number;
  itemSubType: number;
  classType: number; // 0 Titan, 1 Hunter, 2 Warlock, 3 any
  bucketHash?: number;
  damageTypeHash?: number;
  ammoType?: number; // 1 primary, 2 special, 3 heavy
  breakerType?: number;
  collectibleHash?: number;
  plugCategory?: string;
  perkHashes?: number[]; // sandbox perks; aspects and fragments keep their description there
  equippable: boolean;
}

export interface SimpleDef {
  hash: number;
  name: string;
  description: string;
}
export interface BucketDef extends SimpleDef {
  category: number;
}
export interface ClassDef extends SimpleDef {
  classType: number;
}
export interface ActivityDef extends SimpleDef {
  isPvP: boolean;
  activityTypeHash?: number;
}
export interface CollectibleDef {
  hash: number;
  source: string;
}

interface Tables {
  items: Record<number, ItemDef>;
  stats: Record<number, SimpleDef>;
  damageTypes: Record<number, SimpleDef>;
  classes: Record<number, ClassDef>;
  buckets: Record<number, BucketDef>;
  collectibles: Record<number, CollectibleDef>;
  activities: Record<number, ActivityDef>;
  activityTypes: Record<number, SimpleDef>;
  sandboxPerks: Record<number, SimpleDef>;
}

/** Bump when the slimmed fields change, so an existing cache is rebuilt. */
const SCHEMA = 2;

type Raw = Record<string, any>;

const SOURCES: Record<keyof Tables, { table: string; slim: (d: Raw) => any | null }> = {
  items: {
    table: "DestinyInventoryItemDefinition",
    slim: (d) => {
      const name = d.displayProperties?.name;
      if (!name || d.redacted) return null;
      return {
        hash: d.hash,
        name,
        description: d.displayProperties?.description ?? "",
        flavorText: d.flavorText || undefined,
        icon: d.displayProperties?.icon,
        typeName: d.itemTypeDisplayName ?? "",
        tierName: d.inventory?.tierTypeName || undefined,
        itemType: d.itemType ?? 0,
        itemSubType: d.itemSubType ?? 0,
        classType: d.classType ?? 3,
        bucketHash: d.inventory?.bucketTypeHash,
        damageTypeHash: d.defaultDamageTypeHash || undefined,
        ammoType: d.equippingBlock?.ammoType || undefined,
        breakerType: d.breakerType || undefined,
        collectibleHash: d.collectibleHash,
        plugCategory: d.plug?.plugCategoryIdentifier,
        perkHashes: d.perks?.length ? d.perks.map((p: Raw) => p.perkHash) : undefined,
        equippable: !!d.equippable,
      } satisfies ItemDef;
    },
  },
  stats: { table: "DestinyStatDefinition", slim: simple },
  damageTypes: { table: "DestinyDamageTypeDefinition", slim: simple },
  classes: {
    table: "DestinyClassDefinition",
    slim: (d) => ({ ...simple(d), classType: d.classType }),
  },
  buckets: {
    table: "DestinyInventoryBucketDefinition",
    slim: (d) => ({ ...simple(d), category: d.category }),
  },
  collectibles: {
    table: "DestinyCollectibleDefinition",
    slim: (d) => (d.sourceString ? { hash: d.hash, source: d.sourceString.replace(/^Source:\s*/i, "") } : null),
  },
  activities: {
    table: "DestinyActivityDefinition",
    slim: (d) => {
      const s = simple(d);
      return s.name ? { ...s, isPvP: !!d.isPvP, activityTypeHash: d.activityTypeHash } : null;
    },
  },
  activityTypes: { table: "DestinyActivityTypeDefinition", slim: simple },
  sandboxPerks: {
    table: "DestinySandboxPerkDefinition",
    slim: (d) => {
      const s = simple(d);
      return s.description ? s : null;
    },
  },
};

function simple(d: Raw): SimpleDef {
  return {
    hash: d.hash,
    name: d.displayProperties?.name ?? "",
    description: d.displayProperties?.description ?? "",
  };
}

interface ManifestMeta {
  version: string;
  jsonWorldComponentContentPaths: Record<string, Record<string, string>>;
}

export class Manifest {
  private nameIndex: { key: string; kind: "item" | "activity"; hash: number }[] = [];

  constructor(
    public version: string,
    public t: Tables,
  ) {
    for (const it of Object.values(t.items)) this.nameIndex.push({ key: it.name.toLowerCase(), kind: "item", hash: it.hash });
    for (const a of Object.values(t.activities)) this.nameIndex.push({ key: a.name.toLowerCase(), kind: "activity", hash: a.hash });
  }

  /** Bungie's manifest version embeds its build date, e.g. "244213.26.06.29.2000-1-bnet.65864" is 2026-06-29. */
  builtOn(): string | undefined {
    const m = /\.(\d{2})\.(\d{2})\.(\d{2})\./.exec(this.version);
    return m ? `20${m[1]}-${m[2]}-${m[3]}` : undefined;
  }

  item(hash: number | undefined): ItemDef | undefined {
    return hash === undefined ? undefined : this.t.items[hash];
  }

  /** Ranked name search: exact > prefix > word-prefix > substring. Dedupes identical names. */
  search(query: string, kind: "item" | "activity" | "any" = "any", limit = 10) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: { score: number; kind: "item" | "activity"; hash: number; key: string }[] = [];
    for (const e of this.nameIndex) {
      if (kind !== "any" && e.kind !== kind) continue;
      let score = 0;
      if (e.key === q) score = 100;
      else if (e.key.startsWith(q)) score = 70;
      else if (e.key.includes(` ${q}`)) score = 50;
      else if (e.key.includes(q)) score = 30;
      if (!score) continue;
      // Prefer "real" items (weapons/armor/exotics) over plugs, ornaments and shaders.
      if (e.kind === "item") {
        const it = this.t.items[e.hash];
        if (it.itemType === 3 || it.itemType === 2) score += 10;
        if (it.tierName === "Exotic") score += 3;
        if (!it.typeName) score -= 15;
      }
      scored.push({ score, ...e });
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: typeof scored = [];
    for (const s of scored) {
      const k = `${s.kind}:${s.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }
}

let loading: Promise<Manifest> | null = null;

export function getManifest(): Promise<Manifest> {
  loading ??= loadManifest().catch((e) => {
    loading = null; // allow a retry on the next tool call
    throw e;
  });
  return loading;
}

async function loadManifest(): Promise<Manifest> {
  fs.mkdirSync(config.manifestDir, { recursive: true });
  const currentFile = path.join(config.manifestDir, "current.json");
  const cached = readJson<{ version: string; schema?: number }>(currentFile);

  let meta: ManifestMeta | null = null;
  try {
    meta = await bungieGet<ManifestMeta>("/Destiny2/Manifest/");
  } catch (e) {
    if (!cached) throw e;
    log(`could not check manifest version (${(e as Error).message}); using cached ${cached.version}`);
  }

  const version = meta?.version ?? cached!.version;
  const dir = path.join(config.manifestDir, version.replace(/[^\w.-]/g, "_"));

  if (!cached || cached.schema !== SCHEMA || cached.version !== version || !fs.existsSync(path.join(dir, "items.json"))) {
    const paths = meta!.jsonWorldComponentContentPaths[config.language];
    if (!paths) throw new Error(`Manifest has no language "${config.language}"`);
    log(`downloading manifest ${version} (first run or Bungie pushed an update — this can take a minute)`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [key, src] of Object.entries(SOURCES)) {
      const raw = await bungieFile<Record<string, Raw>>(paths[src.table]);
      const slim: Record<number, unknown> = {};
      for (const d of Object.values(raw)) {
        const s = src.slim(d);
        if (s) slim[d.hash] = s;
      }
      fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(slim));
      log(`  ${src.table}: ${Object.keys(slim).length} entries`);
    }
    fs.writeFileSync(currentFile, JSON.stringify({ version, schema: SCHEMA }));
    // Drop older manifest versions.
    for (const d of fs.readdirSync(config.manifestDir)) {
      const p = path.join(config.manifestDir, d);
      if (p !== dir && fs.statSync(p).isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    }
  }

  const tables = {} as Tables;
  for (const key of Object.keys(SOURCES) as (keyof Tables)[]) {
    tables[key] = readJson(path.join(dir, `${key}.json`)) ?? {};
  }
  log(`manifest ${version} loaded (${Object.keys(tables.items).length} items)`);
  return new Manifest(version, tables);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
