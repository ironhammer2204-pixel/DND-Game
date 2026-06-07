import { NemesisPersonality, NemesisTier } from "@dnd/shared";

export interface PersonalityPreset {
  label: string;
  aggression: number;
  prefersGrudgeTarget: boolean;
  targetRule: "lowest_hp" | "caster" | "strongest" | "grudge" | "random";
  traits: string[];
}

export interface ScarPreset {
  type: string;
  label: string;
  effect: string;
  statPenalty: Record<string, number>;
  trait: string;
}

export const PERSONALITY_PRESETS: Record<NemesisPersonality, PersonalityPreset> = {
  brutal: {
    label: "Brutal",
    aggression: 90,
    prefersGrudgeTarget: false,
    targetRule: "lowest_hp",
    traits: ["merciless", "close_quarters"],
  },
  cowardly: {
    label: "Cowardly",
    aggression: 35,
    prefersGrudgeTarget: false,
    targetRule: "random",
    traits: ["ambusher", "retreats_when_wounded"],
  },
  cunning: {
    label: "Cunning",
    aggression: 65,
    prefersGrudgeTarget: false,
    targetRule: "caster",
    traits: ["disrupts_support", "sets_traps"],
  },
  honorable: {
    label: "Honorable",
    aggression: 70,
    prefersGrudgeTarget: false,
    targetRule: "strongest",
    traits: ["duelist", "keeps_oaths"],
  },
  vengeful: {
    label: "Vengeful",
    aggression: 95,
    prefersGrudgeTarget: true,
    targetRule: "grudge",
    traits: ["fixated", "reckless_revenge"],
  },
  warlord: {
    label: "Warlord",
    aggression: 75,
    prefersGrudgeTarget: true,
    targetRule: "caster",
    traits: ["commands_minions", "battlefield_control"],
  },
  paranoid: {
    label: "Paranoid",
    aggression: 55,
    prefersGrudgeTarget: false,
    targetRule: "strongest",
    traits: ["prepares_counters", "expects_betrayal"],
  },
};

export const TIER_ORDER: NemesisTier[] = ["soldier", "lieutenant", "warlord", "archnemesis"];

export const TIER_STAT_BONUSES: Record<NemesisTier, Record<string, number>> = {
  soldier: { hp: 0, attack_bonus: 0, damage_modifier: 0 },
  lieutenant: { hp: 8, attack_bonus: 1, damage_modifier: 1 },
  warlord: { hp: 18, attack_bonus: 2, damage_modifier: 2 },
  archnemesis: { hp: 32, attack_bonus: 3, damage_modifier: 4 },
};

export const EPITHETS: Record<NemesisTier, string[]> = {
  soldier: ["the Scarred", "Bonebreaker", "the Twice-Burned", "the Patient Blade"],
  lieutenant: ["the Relentless", "of the Broken Oath", "the Bloodied Captain"],
  warlord: ["the Undying", "Worldbreaker", "the Iron Banner"],
  archnemesis: ["the Inevitable", "of Ten Graves", "the Last Shadow"],
};

export const SCARS: ScarPreset[] = [
  {
    type: "blinded_eye",
    label: "Blinded Eye",
    effect: "-1 attack bonus, gains reckless hatred.",
    statPenalty: { attack_bonus: -1 },
    trait: "reckless_hatred",
  },
  {
    type: "severed_arm",
    label: "Maimed Arm",
    effect: "-1 damage modifier, favors ambush tactics.",
    statPenalty: { damage_modifier: -1 },
    trait: "ambush_fighter",
  },
  {
    type: "burn_marks",
    label: "Burn Marks",
    effect: "Remembers fire and becomes harder to intimidate.",
    statPenalty: {},
    trait: "fire_hardened",
  },
  {
    type: "broken_leg",
    label: "Broken Leg",
    effect: "-1 AC, prefers minions and ranged pressure.",
    statPenalty: { ac: -1 },
    trait: "keeps_distance",
  },
  {
    type: "cursed_wound",
    label: "Cursed Wound",
    effect: "Carries a strange wound that sharpens their grudge.",
    statPenalty: {},
    trait: "curse_driven",
  },
];

export function pickPersonality(seed: string): NemesisPersonality {
  const keys = Object.keys(PERSONALITY_PRESETS) as NemesisPersonality[];
  const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % keys.length;
  return keys[index];
}

export function nextTier(tier: NemesisTier): NemesisTier {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, index + 1)];
}
