import type { OwnedItem, Profile } from "../bungie/profile.js";
import { characterLabel } from "../bungie/profile.js";

export const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

export function where(profile: Profile, it: OwnedItem): string {
  switch (it.location) {
    case "equipped":
      return `equipped on ${characterLabel(profile, it.characterId)}`;
    case "character":
      return `in ${characterLabel(profile, it.characterId)} inventory`;
    case "postmaster":
      return `at the Postmaster (${characterLabel(profile, it.characterId)}) — pick it up before it's lost`;
    case "vault":
      return "in vault";
    default:
      return "account-wide";
  }
}

/** One compact line per item; enough for the model to reason, short enough to list many. */
export function itemLine(profile: Profile, it: OwnedItem, opts: { perks?: boolean } = {}): string {
  const bits = [it.tierName, it.damageType, it.typeName].filter(Boolean);
  let s = `- **${it.name}** — ${bits.join(" ")}`;
  if (it.ammo) s += ` · ${it.ammo} ammo`;
  if (it.power) s += ` · power ${it.power}`;
  s += ` · ${where(profile, it)}`;
  if (it.instanceId) s += ` · id ${it.instanceId}`;
  if (opts.perks) for (const l of perkLines(it)) s += `\n  ${l}`;
  return s;
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function agoText(iso: string): string {
  const d = daysSince(iso);
  if (d < 1) return "today";
  if (d === 1) return "1 day ago";
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

/** Armor shows its real perks (intrinsics, exotic perks) and the mods slotted into it on separate lines. */
export function perkLines(it: OwnedItem): string[] {
  if (!it.perks?.length) return [];
  const isMod = (p: { type?: string }) => /armor mod$/i.test(p.type ?? "");
  const perks = it.perks.filter((p) => !(it.itemType === 2 && isMod(p)));
  const mods = it.perks.filter((p) => it.itemType === 2 && isMod(p));
  const uniq = (xs: { name: string }[]) => [...new Set(xs.map((x) => x.name))].join(", ");
  const out: string[] = [];
  if (perks.length) out.push(`perks: ${uniq(perks)}`);
  if (mods.length) out.push(`slotted mods: ${uniq(mods)}`);
  return out;
}

export function matchClass(profile: Profile, cls?: string) {
  if (!cls || cls.toLowerCase() === "all") return profile.characters;
  const c = profile.characters.filter((ch) => ch.className.toLowerCase() === cls.toLowerCase());
  if (!c.length) {
    throw new Error(
      `No ${cls} character on this account. Characters: ${profile.characters.map((x) => x.className).join(", ")}`,
    );
  }
  return c;
}
