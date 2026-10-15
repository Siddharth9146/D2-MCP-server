import { bungieGet } from "./client.js";
import { getManifest, type Manifest } from "./manifest.js";

const VAULT_BUCKET = 138197802;
const POSTMASTER_BUCKET = 215593132;

export const CLASS_NAMES: Record<number, string> = { 0: "Titan", 1: "Hunter", 2: "Warlock", 3: "Any class" };
export const AMMO_NAMES: Record<number, string> = { 1: "Primary", 2: "Special", 3: "Heavy" };
const ITEM_TYPE = { armor: 2, weapon: 3, subclass: 16 } as const;

// Socket plugs that are cosmetic or bookkeeping — noise for someone trying to understand their gear.
const HIDDEN_PLUG_CATEGORY = /shader|skins|ornament|tracker|memento|transmog|crafting|v400\.empty|masterworks\.stat|emote|deepsight|spawnfx/i;
const HIDDEN_PLUG_NAME = /^(empty|default|kill tracker|crucible tracker|upgrade armor|locked|no |random )/i;

export interface Membership {
  membershipType: number;
  membershipId: string;
  bungieName: string;
}

export interface Character {
  characterId: string;
  className: string;
  classType: number;
  power: number;
  minutesPlayedTotal: number;
  dateLastPlayed: string;
}

export interface Perk {
  name: string;
  description: string;
  type: string;
}

export interface OwnedItem {
  instanceId?: string;
  hash: number;
  name: string;
  typeName: string;
  tierName?: string;
  itemType: number;
  classType: number;
  location: "equipped" | "character" | "vault" | "postmaster" | "account";
  characterId?: string;
  quantity: number;
  power?: number;
  damageType?: string;
  ammo?: string;
  stats?: Record<string, number>;
  perks?: Perk[];
}

export interface Profile {
  membership: Membership;
  characters: Character[];
  items: OwnedItem[];
  currencies: { name: string; quantity: number }[];
  fetchedAt: number;
}

interface RawItem {
  itemHash: number;
  itemInstanceId?: string;
  quantity: number;
  bucketHash: number;
}

let membershipCache: Membership | null = null;
let profileCache: Profile | null = null;
const PROFILE_TTL_MS = 30_000;

export async function getMembership(): Promise<Membership> {
  if (membershipCache) return membershipCache;
  const r = await bungieGet<any>("/User/GetMembershipsForCurrentUser/", { auth: true });
  const list: any[] = r.destinyMemberships ?? [];
  if (!list.length) throw new Error("This Bungie.net account has no Destiny 2 characters.");
  // With Cross Save, only the primary membership holds the real characters.
  const pick =
    list.find((m) => m.membershipId === r.primaryMembershipId) ??
    list.find((m) => m.crossSaveOverride === m.membershipType) ??
    list[0];
  const name = pick.bungieGlobalDisplayName
    ? `${pick.bungieGlobalDisplayName}#${String(pick.bungieGlobalDisplayNameCode).padStart(4, "0")}`
    : pick.displayName;
  membershipCache = { membershipType: pick.membershipType, membershipId: pick.membershipId, bungieName: name };
  return membershipCache;
}

export async function getProfile(force = false): Promise<Profile> {
  if (!force && profileCache && Date.now() - profileCache.fetchedAt < PROFILE_TTL_MS) return profileCache;
  const [m, manifest] = await Promise.all([getMembership(), getManifest()]);
  // 100 profile, 102 vault/account inventory, 103 currencies, 200 characters,
  // 201 character inventories, 205 equipment, 300 instances, 304 stats, 305 sockets
  const components = "100,102,103,200,201,205,300,304,305";
  const r = await bungieGet<any>(`/Destiny2/${m.membershipType}/Profile/${m.membershipId}/?components=${components}`, {
    auth: true,
  });
  profileCache = buildProfile(m, r, manifest);
  return profileCache;
}

export function buildProfile(membership: Membership, r: any, manifest: Manifest): Profile {
  const instances = r.itemComponents?.instances?.data ?? {};
  const stats = r.itemComponents?.stats?.data ?? {};
  const sockets = r.itemComponents?.sockets?.data ?? {};

  const characters: Character[] = Object.values<any>(r.characters?.data ?? {})
    .map((c) => ({
      characterId: c.characterId,
      classType: c.classType,
      className: CLASS_NAMES[c.classType] ?? "Unknown",
      power: c.light,
      minutesPlayedTotal: Number(c.minutesPlayedTotal),
      dateLastPlayed: c.dateLastPlayed,
    }))
    .sort((a, b) => b.dateLastPlayed.localeCompare(a.dateLastPlayed));

  const items: OwnedItem[] = [];
  const add = (raw: RawItem, location: OwnedItem["location"], characterId?: string) => {
    const def = manifest.item(raw.itemHash);
    if (!def) return;
    const inst = raw.itemInstanceId ? instances[raw.itemInstanceId] : undefined;
    const item: OwnedItem = {
      instanceId: raw.itemInstanceId,
      hash: raw.itemHash,
      name: def.name,
      typeName: def.typeName,
      tierName: def.tierName,
      itemType: def.itemType,
      classType: def.classType,
      location: raw.bucketHash === POSTMASTER_BUCKET ? "postmaster" : location,
      characterId,
      quantity: raw.quantity,
      power: inst?.primaryStat?.value,
      ammo: def.ammoType ? AMMO_NAMES[def.ammoType] : undefined,
    };
    const dmg = inst?.damageTypeHash ?? def.damageTypeHash;
    if (dmg) item.damageType = manifest.t.damageTypes[dmg]?.name;

    if (raw.itemInstanceId && def.itemType === ITEM_TYPE.subclass) {
      item.perks = readPerks(sockets[raw.itemInstanceId]?.sockets ?? [], manifest);
    }
    if (raw.itemInstanceId && (def.itemType === ITEM_TYPE.weapon || def.itemType === ITEM_TYPE.armor)) {
      const st = stats[raw.itemInstanceId]?.stats;
      if (st) {
        item.stats = {};
        for (const s of Object.values<any>(st)) {
          const name = manifest.t.stats[s.statHash]?.name;
          if (name) item.stats[name] = s.value;
        }
      }
      item.perks = readPerks(sockets[raw.itemInstanceId]?.sockets ?? [], manifest);
    }
    items.push(item);
  };

  for (const raw of r.profileInventory?.data?.items ?? []) {
    add(raw, raw.bucketHash === VAULT_BUCKET ? "vault" : "account");
  }
  for (const [cid, inv] of Object.entries<any>(r.characterInventories?.data ?? {})) {
    for (const raw of inv.items ?? []) add(raw, "character", cid);
  }
  for (const [cid, eq] of Object.entries<any>(r.characterEquipment?.data ?? {})) {
    for (const raw of eq.items ?? []) add(raw, "equipped", cid);
  }

  const currencies = (r.profileCurrencies?.data?.items ?? [])
    .map((c: RawItem) => ({ name: manifest.item(c.itemHash)?.name ?? `#${c.itemHash}`, quantity: c.quantity }))
    .filter((c: { quantity: number }) => c.quantity > 0);

  return { membership, characters, items, currencies, fetchedAt: Date.now() };
}

function readPerks(socketList: any[], manifest: Manifest): Perk[] {
  const perks: Perk[] = [];
  for (const s of socketList) {
    if (!s.plugHash || s.isVisible === false) continue;
    const p = manifest.item(s.plugHash);
    if (!p || !p.name || HIDDEN_PLUG_NAME.test(p.name)) continue;
    if (p.plugCategory && HIDDEN_PLUG_CATEGORY.test(p.plugCategory)) continue;
    if (/^combat flair$/i.test(p.typeName)) continue; // kill-effect cosmetics, not perks
    const description = p.description || (p.perkHashes?.map((h) => manifest.t.sandboxPerks[h]?.description).find(Boolean) ?? "");
    perks.push({ name: p.name, description, type: p.typeName });
  }
  return perks;
}

export function characterLabel(profile: Profile, characterId?: string): string {
  if (!characterId) return "";
  const c = profile.characters.find((x) => x.characterId === characterId);
  return c ? c.className : characterId;
}
