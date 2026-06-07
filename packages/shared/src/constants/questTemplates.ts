export interface QuestObjectiveCondition {
  type: "kill_count" | "location_visit" | "npc_interaction";
  target_faction?: string;
  required_count?: number;
  location_id?: string;
  npc_archetype?: string;
}

export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  type: "main" | "side" | "random";
  trigger_conditions: {
    world_flags_required?: string[];
    locations_visited_required?: string[];
  };
  objectives: {
    text: string;
    condition: QuestObjectiveCondition;
  }[];
  rewards: {
    gold: number;
    xp: number;
    reputation?: Record<string, number>; // faction_id -> change
  };
}

export const QUEST_TEMPLATES: QuestTemplate[] = [
  {
    id: "clear_bandit_hideout",
    title: "Clear the Bandit Hideout",
    description: "The local sheriff has issued a bounty on the outlaws threatening trade routes. Locate and clear their camp.",
    type: "side",
    trigger_conditions: {
      locations_visited_required: ["oakhaven_village"]
    },
    objectives: [
      {
        text: "Travel to the Bandit Camp",
        condition: { type: "location_visit", location_id: "bandit_camp" }
      },
      {
        text: "Eliminate 5 Blackwater Syndicate bandits",
        condition: { type: "kill_count", target_faction: "Blackwater Syndicate", required_count: 5 }
      }
    ],
    rewards: {
      gold: 150,
      xp: 200
    }
  },
  {
    id: "rescue_wandering_merchant",
    title: "Rescue the Missing Merchant",
    description: "A merchant convoy went missing in the Briarwood Wilds. Find the merchant and guide them back.",
    type: "side",
    trigger_conditions: {
      locations_visited_required: ["briarwood_wilds"]
    },
    objectives: [
      {
        text: "Locate the wandering merchant in the forest wilds",
        condition: { type: "npc_interaction", npc_archetype: "merchant" }
      },
      {
        text: "Accompany the merchant to Oakhaven Village safety",
        condition: { type: "location_visit", location_id: "oakhaven_village" }
      }
    ],
    rewards: {
      gold: 100,
      xp: 150
    }
  },
  {
    id: "investigate_whispering_caves",
    title: "The Whispers in the Dark",
    description: "The cave tunnels have been echoing with unnatural voices. Investigate the whispering caves.",
    type: "side",
    trigger_conditions: {
      locations_visited_required: ["briarwood_wilds"]
    },
    objectives: [
      {
        text: "Investigate the Whispering Caverns",
        condition: { type: "location_visit", location_id: "whispering_caverns" }
      },
      {
        text: "Defeat 3 cave monsters",
        condition: { type: "kill_count", target_faction: "Cave Horrors", required_count: 3 }
      }
    ],
    rewards: {
      gold: 200,
      xp: 250
    }
  },
  {
    id: "defend_oakhaven",
    title: "Defend Oakhaven Village",
    description: "Village destabilisation has reached critical level. Help the local sheriff defend Oakhaven from incoming raids.",
    type: "side",
    trigger_conditions: {
      world_flags_required: ["village_destabilised"]
    },
    objectives: [
      {
        text: "Consult with the Sheriff in Oakhaven",
        condition: { type: "npc_interaction", npc_archetype: "protector" }
      },
      {
        text: "Defeat 5 occupying raiders",
        condition: { type: "kill_count", target_faction: "Syndicate Invaders", required_count: 5 }
      }
    ],
    rewards: {
      gold: 300,
      xp: 400
    }
  },
  {
    id: "ancient_gate_investigation",
    title: "The Ashen Gate Stirs",
    description: "Reports from the watchtower sentries claim the Ashen Gate is glowing with dark energy. Investigate the ruins.",
    type: "main",
    trigger_conditions: {
      locations_visited_required: ["crypt_of_the_fallen"]
    },
    objectives: [
      {
        text: "Investigate the Ashen Gate Ruins",
        condition: { type: "location_visit", location_id: "ashen_gate_ruins" }
      },
      {
        text: "Defeat 3 cult recruiters guarding the ruins",
        condition: { type: "kill_count", target_faction: "Ashen Cult", required_count: 3 }
      }
    ],
    rewards: {
      gold: 400,
      xp: 500
    }
  },
  {
    id: "faction_occupation_break",
    title: "Dismantle Faction Hold",
    description: "A rival faction has become ascendant. Travel to the capital city and negotiate or break their hold.",
    type: "side",
    trigger_conditions: {
      world_flags_required: ["faction_ascendant"]
    },
    objectives: [
      {
        text: "Meet with the Guild Leader in the capital city",
        condition: { type: "npc_interaction", npc_archetype: "leader" }
      },
      {
        text: "Defeat 4 ascendant faction operatives",
        condition: { type: "kill_count", target_faction: "Ascendant Order", required_count: 4 }
      }
    ],
    rewards: {
      gold: 500,
      xp: 600
    }
  },
  {
    id: "blood_debt_repayment",
    title: "Repay the Blood Debt",
    description: "An NPC was killed due to the party's action. A survivor seeks retribution or reparations at the defiled sanctuary.",
    type: "side",
    trigger_conditions: {
      world_flags_required: ["blood_debt"]
    },
    objectives: [
      {
        text: "Travel to the Defiled Sanctuary ruins",
        condition: { type: "location_visit", location_id: "defiled_sanctuary" }
      },
      {
        text: "Speak with the suspicious stranger who summoned you",
        condition: { type: "npc_interaction", npc_archetype: "cultist" }
      }
    ],
    rewards: {
      gold: 250,
      xp: 300
    }
  },
  {
    id: "slay_peak_dragon",
    title: "Slay the Wyrmling",
    description: "A red dragon wyrmling has been nesting at Dragon's Peak. Slay it before it destroys the surrounding valleys.",
    type: "side",
    trigger_conditions: {
      locations_visited_required: ["ashen_gate_ruins"]
    },
    objectives: [
      {
        text: "Climb up to Dragon's Peak",
        condition: { type: "location_visit", location_id: "dragons_peak" }
      },
      {
        text: "Defeat the Dragon Wyrmling",
        condition: { type: "kill_count", target_faction: "Red Dragons", required_count: 1 }
      }
    ],
    rewards: {
      gold: 800,
      xp: 1000
    }
  },
  {
    id: "forbidden_contact_offering",
    title: "A Deal in the Dark",
    description: "The dark entity has made contact. Travel to the sunken vault to retrieve the offering it demands.",
    type: "side",
    trigger_conditions: {
      world_flags_required: ["forbidden_contact"]
    },
    objectives: [
      {
        text: "Recover the offering inside the Sunken Vault",
        condition: { type: "location_visit", location_id: "sunken_vault" }
      },
      {
        text: "Deliver the offering to the hedge mage in Oakhaven",
        condition: { type: "npc_interaction", npc_archetype: "scholar" }
      }
    ],
    rewards: {
      gold: 600,
      xp: 800
    }
  },
  {
    id: "crypt_necromancy_cleansing",
    title: "Cleanse the Fallen Crypt",
    description: "Wizards at the High Academy report necromancers pillaging the old crypts. Purify the burial chambers.",
    type: "side",
    trigger_conditions: {
      locations_visited_required: ["high_academy"]
    },
    objectives: [
      {
        text: "Travel to the Crypt of the Fallen",
        condition: { type: "location_visit", location_id: "crypt_of_the_fallen" }
      },
      {
        text: "Defeat 4 skeletal monsters",
        condition: { type: "kill_count", target_faction: "Undead", required_count: 4 }
      }
    ],
    rewards: {
      gold: 350,
      xp: 400
    }
  }
];
