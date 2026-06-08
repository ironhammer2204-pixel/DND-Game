export const RACES = [
  "Human",
  "Elf",
  "Dwarf",
  "Halfling",
  "Dragonborn",
  "Gnome",
  "Half-Elf",
  "Half-Orc",
  "Tiefling",
] as const;

export type Race = typeof RACES[number];

export const CLASSES = [
  "Fighter",
  "Wizard",
  "Rogue",
  "Cleric",
  "Barbarian",
  "Bard",
  "Druid",
  "Monk",
  "Paladin",
  "Ranger",
  "Sorcerer",
  "Warlock",
] as const;

export type Class = typeof CLASSES[number];

export const DICE_TYPES = [
  "d4",
  "d6",
  "d8",
  "d10",
  "d12",
  "d20",
  "d100",
] as const;

export type DiceType = typeof DICE_TYPES[number];

export const SKILLS = [
  "acrobatics",
  "animalHandling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleightOfHand",
  "stealth",
  "survival",
] as const;

export type SkillName = typeof SKILLS[number];

export const SKILL_LABELS: Record<SkillName, string> = {
  acrobatics: "Acrobatics",
  animalHandling: "Animal Handling",
  arcana: "Arcana",
  athletics: "Athletics",
  deception: "Deception",
  history: "History",
  insight: "Insight",
  intimidation: "Intimidation",
  investigation: "Investigation",
  medicine: "Medicine",
  nature: "Nature",
  perception: "Perception",
  performance: "Performance",
  persuasion: "Persuasion",
  religion: "Religion",
  sleightOfHand: "Sleight of Hand",
  stealth: "Stealth",
  survival: "Survival",
};

export const ATTRIBUTES = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
] as const;

export type AttributeName = typeof ATTRIBUTES[number];

export const ATTRIBUTE_LABELS: Record<AttributeName, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export const SKILL_TO_ATTRIBUTE: Record<SkillName, AttributeName> = {
  acrobatics: "dex",
  animalHandling: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleightOfHand: "dex",
  stealth: "dex",
  survival: "wis",
};

export * from "./monsters.js";
export * from "./npcTemplates.js";
export * from "./locationTemplates.js";
export * from "./questTemplates.js";

