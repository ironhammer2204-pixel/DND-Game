export interface LocationTemplate {
  id: string;
  name: string;
  type: string; // 'city' | 'village' | 'dungeon' | 'wilderness' | 'ruins'
  description: string;
  lore: string;
  connected_template_ids: string[];
  unlock_conditions: {
    party_level_min?: number;
    world_flags_required?: string[];
    locations_visited_required?: string[];
  };
}

export const LOCATION_TEMPLATES: LocationTemplate[] = [
  {
    id: "oakhaven_village",
    name: "Oakhaven Village",
    type: "village",
    description: "A small, quiet farming community nestled at the edge of the great forest.",
    lore: "Founded decades ago by retired soldiers, Oakhaven is known for its high-quality timber and peaceful way of life.",
    connected_template_ids: ["briarwood_wilds", "bandit_camp"],
    unlock_conditions: {}
  },
  {
    id: "briarwood_wilds",
    name: "Briarwood Wilds",
    type: "wilderness",
    description: "A dense, overgrown forest filled with ancient trees, thorns, and hidden paths.",
    lore: "Tavern tales tell of dangerous beasts roaming the Briarwood, and how the trees seem to shift to trap unwary travelers.",
    connected_template_ids: ["oakhaven_village", "whispering_caverns", "smuggler_cove"],
    unlock_conditions: {}
  },
  {
    id: "whispering_caverns",
    name: "Whispering Caverns",
    type: "dungeon",
    description: "A dark network of caves where the wind creates low, echoing voices.",
    lore: "Miners abandoned this cave after they broke into a cavern that started whispering their darkest secrets back to them.",
    connected_template_ids: ["briarwood_wilds", "crypt_of_the_fallen"],
    unlock_conditions: {
      party_level_min: 2
    }
  },
  {
    id: "iron_keep",
    name: "Iron Keep",
    type: "city",
    description: "A massive walled city built of dark stone, serving as the military headquarters of the region.",
    lore: "The Keep has stood for three centuries, never once falling to an invader, guarded by the elite Iron Crown guard.",
    connected_template_ids: ["oakhaven_village", "high_academy", "barony_capital"],
    unlock_conditions: {}
  },
  {
    id: "shadowfen_swamps",
    name: "Shadowfen Swamps",
    type: "wilderness",
    description: "A foggy, dangerous bog where the water is toxic and the footing is treacherous.",
    lore: "Once a fertile valley, a magical cataclysm sank the region, transforming it into a swamp haunted by spirits.",
    connected_template_ids: ["briarwood_wilds", "defiled_sanctuary"],
    unlock_conditions: {
      world_flags_required: ["ancient_thing_stirring"]
    }
  },
  {
    id: "ashen_gate_ruins",
    name: "Ashen Gate Ruins",
    type: "ruins",
    description: "The scorched remnants of an ancient portal that once connected to the outer planes.",
    lore: "The gate was sealed during the first demon invasion, but recent reports say the stone has begun glowing red again.",
    connected_template_ids: ["shadowfen_swamps", "sunken_vault"],
    unlock_conditions: {
      party_level_min: 3,
      locations_visited_required: ["whispering_caverns"]
    }
  },
  {
    id: "blackwood_grove",
    name: "Blackwood Grove",
    type: "wilderness",
    description: "A dark, unnaturally silent grove where the leaves are black and no birds sing.",
    lore: "The grove is sacred to the shadow syndicate, who use its silence to conduct dark blood deals.",
    connected_template_ids: ["briarwood_wilds", "defiled_sanctuary"],
    unlock_conditions: {
      world_flags_required: ["village_destabilised"]
    }
  },
  {
    id: "crypt_of_the_fallen",
    name: "Crypt of the Fallen",
    type: "dungeon",
    description: "An ancient subterranean tomb where the heroes of the old kingdom rest.",
    lore: "Spies warn that necromancers have begun raiding the tombs to resurrect an army of skeletal knights.",
    connected_template_ids: ["whispering_caverns", "ashen_gate_ruins"],
    unlock_conditions: {
      party_level_min: 2
    }
  },
  {
    id: "smuggler_cove",
    name: "Smuggler's Cove",
    type: "wilderness",
    description: "A hidden rocky inlet on the coast, perfect for landing boats away from patrolling eyes.",
    lore: "Used for generations by thieves and pirates to import illegal contraband directly to the province.",
    connected_template_ids: ["briarwood_wilds", "iron_keep"],
    unlock_conditions: {}
  },
  {
    id: "high_academy",
    name: "High Academy of Magic",
    type: "city",
    description: "A cluster of towering spires housing the guild of wizards and sages.",
    lore: "The archive contains centuries of magical research, though the lower vault is sealed off for safety.",
    connected_template_ids: ["iron_keep", "sunken_vault"],
    unlock_conditions: {
      party_level_min: 2
    }
  },
  {
    id: "barony_capital",
    name: "Barony Capital City",
    type: "city",
    description: "The grand seat of power, filled with marketplaces, noble estates, and a gilded palace.",
    lore: "The political heart of the territory where trade laws are drafted and factions fight for influence.",
    connected_template_ids: ["iron_keep"],
    unlock_conditions: {}
  },
  {
    id: "bandit_camp",
    name: "Bandit Camp",
    type: "wilderness",
    description: "A fortified encampment of outlaws, built from stolen logs and hidden behind rocks.",
    lore: "Led by a ruthless lieutenant, this gang has been terrorizing Oakhaven merchants for months.",
    connected_template_ids: ["oakhaven_village"],
    unlock_conditions: {}
  },
  {
    id: "defiled_sanctuary",
    name: "Defiled Sanctuary",
    type: "ruins",
    description: "The overgrown stone pillars of a once-sacred church dedicated to the god of light.",
    lore: "Desecrated during the faction wars, it is now said to be a gathering point for dark cultists.",
    connected_template_ids: ["shadowfen_swamps", "blackwood_grove"],
    unlock_conditions: {
      world_flags_required: ["blood_debt"]
    }
  },
  {
    id: "dragons_peak",
    name: "Dragon's Peak",
    type: "wilderness",
    description: "A windswept mountain summit where the air is thin and the rocks are covered in frost.",
    lore: "The roost of a red dragon wyrmling who has been spotted hunting cattle from the villages below.",
    connected_template_ids: ["crypt_of_the_fallen"],
    unlock_conditions: {
      party_level_min: 4
    }
  },
  {
    id: "sunken_vault",
    name: "Sunken Vault",
    type: "dungeon",
    description: "A flooded treasury buried deep beneath the city canal systems.",
    lore: "Rumoured to hold the lost crown jewels, protected by water spirits and complex gear traps.",
    connected_template_ids: ["high_academy", "ashen_gate_ruins"],
    unlock_conditions: {
      party_level_min: 3,
      world_flags_required: ["ancient_thing_stirring"]
    }
  }
];
