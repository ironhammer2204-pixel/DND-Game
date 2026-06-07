export interface MonsterDefinition {
  id: string;
  name: string;
  hp_max: number;
  ac: number;
  attack_bonus: number;
  damage_dice: string; // e.g. '1d6'
  damage_modifier: number;
  xp_value: number;
  base_stats: {
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
  };
}

export const MONSTERS: MonsterDefinition[] = [
  {
    id: "goblin",
    name: "Goblin",
    hp_max: 7,
    ac: 15,
    attack_bonus: 4,
    damage_dice: "1d6",
    damage_modifier: 2,
    xp_value: 50,
    base_stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  },
  {
    id: "kobold",
    name: "Kobold",
    hp_max: 5,
    ac: 12,
    attack_bonus: 4,
    damage_dice: "1d4",
    damage_modifier: 2,
    xp_value: 25,
    base_stats: { str: 7, dex: 15, con: 9, int: 8, wis: 7, cha: 8 },
  },
  {
    id: "orc",
    name: "Orc",
    hp_max: 15,
    ac: 13,
    attack_bonus: 5,
    damage_dice: "1d12",
    damage_modifier: 3,
    xp_value: 100,
    base_stats: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
  },
  {
    id: "skeleton",
    name: "Skeleton",
    hp_max: 13,
    ac: 13,
    attack_bonus: 4,
    damage_dice: "1d6",
    damage_modifier: 2,
    xp_value: 50,
    base_stats: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
  },
  {
    id: "red_dragon",
    name: "Red Dragon Wyrmling",
    hp_max: 75,
    ac: 17,
    attack_bonus: 6,
    damage_dice: "1d10",
    damage_modifier: 4,
    xp_value: 1100,
    base_stats: { str: 19, dex: 10, con: 17, int: 12, wis: 11, cha: 15 },
  },
];
