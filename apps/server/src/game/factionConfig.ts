import { FactionActionType, FactionPersonality, FactionType } from "@dnd/shared";

export type ActionCategory = "military" | "economic" | "political" | "covert" | "religious";

export interface FactionActionDef {
  type: FactionActionType;
  category: ActionCategory;
  pressureCost: number;
  cooldownCycles: number;
  description: string;
  targetType: "location" | "npc" | "faction" | "trade_route" | "player";
  // Minimum stats required to perform the action
  minStats?: {
    military?: number;
    wealth?: number;
    influence?: number;
    stability?: number;
  };
  // Base effects on the executing faction
  selfEffects?: {
    military?: number;
    wealth?: number;
    influence?: number;
    stability?: number;
  };
  // Base effects on the target location/npc/faction
  targetEffects?: {
    stability?: number;
    control_percent?: number;
    relation_score?: number;
  };
}

export const FACTION_ACTIONS_CONFIG: Record<FactionActionType, FactionActionDef> = {
  patrol: {
    type: "patrol",
    category: "military",
    pressureCost: 50,
    cooldownCycles: 1,
    description: "Patrol roads and boundaries to secure trade and maintain order.",
    targetType: "location",
    minStats: { military: 20 },
    selfEffects: { stability: 2 },
    targetEffects: { stability: 5, control_percent: 10 }
  },
  raid: {
    type: "raid",
    category: "military",
    pressureCost: 100,
    cooldownCycles: 2,
    description: "Launch a swift strike on a target territory to plunder resources.",
    targetType: "location",
    minStats: { military: 40 },
    selfEffects: { wealth: 15, stability: -5 },
    targetEffects: { stability: -15, control_percent: -10 }
  },
  siege: {
    type: "siege",
    category: "military",
    pressureCost: 250,
    cooldownCycles: 4,
    description: "Lay siege to a fortified location to break their defenses.",
    targetType: "location",
    minStats: { military: 80, wealth: 50 },
    selfEffects: { military: -15, wealth: -10 },
    targetEffects: { stability: -30, control_percent: 25 }
  },
  invade: {
    type: "invade",
    category: "military",
    pressureCost: 400,
    cooldownCycles: 6,
    description: "Launch a full-scale invasion to annex a territory.",
    targetType: "location",
    minStats: { military: 120, wealth: 100 },
    selfEffects: { military: -30, wealth: -25, stability: -10 },
    targetEffects: { stability: -50, control_percent: 50 }
  },
  fortify: {
    type: "fortify",
    category: "military",
    pressureCost: 120,
    cooldownCycles: 3,
    description: "Strengthen defenses at a controlled location.",
    targetType: "location",
    minStats: { military: 30 },
    selfEffects: { stability: 15 },
    targetEffects: { stability: 20, control_percent: 15 }
  },
  recruit: {
    type: "recruit",
    category: "military",
    pressureCost: 80,
    cooldownCycles: 2,
    description: "Levy new soldiers and acquire arms to boost military power.",
    targetType: "faction",
    minStats: {},
    selfEffects: { military: 20, wealth: -10 },
    targetEffects: {}
  },
  bribe_official: {
    type: "bribe_official",
    category: "economic",
    pressureCost: 90,
    cooldownCycles: 2,
    description: "Pay off key local figures to ease operations and win favor.",
    targetType: "npc",
    minStats: { wealth: 30 },
    selfEffects: { wealth: -15, influence: 15 },
    targetEffects: { relation_score: 10 }
  },
  fund_trade_route: {
    type: "fund_trade_route",
    category: "economic",
    pressureCost: 150,
    cooldownCycles: 3,
    description: "Establish and protect trade routes to secure long-term revenue.",
    targetType: "trade_route",
    minStats: { wealth: 50, influence: 20 },
    selfEffects: { wealth: 30, stability: 5 },
    targetEffects: {}
  },
  create_shortage: {
    type: "create_shortage",
    category: "economic",
    pressureCost: 110,
    cooldownCycles: 3,
    description: "Hoard goods to raise prices and weaken public morale.",
    targetType: "location",
    minStats: { wealth: 40 },
    selfEffects: { wealth: 25 },
    targetEffects: { stability: -15 }
  },
  price_manipulation: {
    type: "price_manipulation",
    category: "economic",
    pressureCost: 80,
    cooldownCycles: 2,
    description: "Use market monopoly to siphon local wealth.",
    targetType: "location",
    minStats: { wealth: 30, influence: 15 },
    selfEffects: { wealth: 15 },
    targetEffects: { stability: -5, control_percent: 5 }
  },
  corrupt_governor: {
    type: "corrupt_governor",
    category: "political",
    pressureCost: 200,
    cooldownCycles: 4,
    description: "Subvert a governor's loyalty to manipulate local policy.",
    targetType: "npc",
    minStats: { influence: 40, wealth: 50 },
    selfEffects: { wealth: -20, influence: 25 },
    targetEffects: { relation_score: 20 }
  },
  replace_mayor: {
    type: "replace_mayor",
    category: "political",
    pressureCost: 300,
    cooldownCycles: 5,
    description: "Oust the local mayor and install a handpicked puppet.",
    targetType: "location",
    minStats: { influence: 60, military: 40 },
    selfEffects: { influence: 30, stability: -10 },
    targetEffects: { stability: -20, control_percent: 30 }
  },
  pass_law: {
    type: "pass_law",
    category: "political",
    pressureCost: 180,
    cooldownCycles: 3,
    description: "Enact local taxes or restrictions that favor your operations.",
    targetType: "location",
    minStats: { influence: 50 },
    selfEffects: { wealth: 15, influence: 10 },
    targetEffects: { stability: -5, control_percent: 15 }
  },
  assassination: {
    type: "assassination",
    category: "covert",
    pressureCost: 250,
    cooldownCycles: 4,
    description: "Silently eliminate a rival leader or high-value obstacle.",
    targetType: "npc",
    minStats: { influence: 30 },
    selfEffects: { influence: -10, stability: -5 },
    targetEffects: { stability: -25, relation_score: -30 }
  },
  blackmail: {
    type: "blackmail",
    category: "covert",
    pressureCost: 100,
    cooldownCycles: 2,
    description: "Leverage secrets to force cooperation and subvert authority.",
    targetType: "npc",
    minStats: { influence: 20 },
    selfEffects: { influence: 15 },
    targetEffects: { relation_score: 15 }
  },
  spy_network: {
    type: "spy_network",
    category: "covert",
    pressureCost: 70,
    cooldownCycles: 1,
    description: "Infiltrate key locations to spy and map target movements.",
    targetType: "location",
    minStats: { influence: 20 },
    selfEffects: { influence: 10 },
    targetEffects: { control_percent: 5 }
  },
  sabotage: {
    type: "sabotage",
    category: "covert",
    pressureCost: 150,
    cooldownCycles: 3,
    description: "Infiltrate and sabotage military stockpiles or structures.",
    targetType: "location",
    minStats: { influence: 30 },
    selfEffects: { stability: -5 },
    targetEffects: { stability: -15, control_percent: -10 }
  },
  convert_citizens: {
    type: "convert_citizens",
    category: "religious",
    pressureCost: 80,
    cooldownCycles: 2,
    description: "Spread doctrine to align the citizenry to your cause.",
    targetType: "location",
    minStats: { influence: 25 },
    selfEffects: { influence: 15, stability: 5 },
    targetEffects: { control_percent: 10 }
  },
  build_temple: {
    type: "build_temple",
    category: "religious",
    pressureCost: 220,
    cooldownCycles: 4,
    description: "Erect a sacred temple to anchor local faith and devotion.",
    targetType: "location",
    minStats: { influence: 50, wealth: 60 },
    selfEffects: { wealth: -30, influence: 30, stability: 15 },
    targetEffects: { stability: 15, control_percent: 20 }
  },
  declare_holy_war: {
    type: "declare_holy_war",
    category: "religious",
    pressureCost: 500,
    cooldownCycles: 7,
    description: "Call for a crusade or jihad against non-believers or rivals.",
    targetType: "faction",
    minStats: { influence: 80, military: 80 },
    selfEffects: { military: 20, stability: -15 },
    targetEffects: { relation_score: -50 }
  }
};

export const PERSONALITY_WEIGHTS: Record<FactionPersonality, Record<FactionActionType, number>> = {
  expansionist: {
    patrol: 2.0,
    raid: 2.5,
    siege: 3.0,
    invade: 3.5,
    fortify: 1.5,
    recruit: 2.0,
    bribe_official: 0.8,
    fund_trade_route: 0.5,
    create_shortage: 0.6,
    price_manipulation: 0.5,
    corrupt_governor: 1.0,
    replace_mayor: 2.0,
    pass_law: 1.2,
    assassination: 1.0,
    blackmail: 0.8,
    spy_network: 1.5,
    sabotage: 1.2,
    convert_citizens: 0.5,
    build_temple: 0.5,
    declare_holy_war: 1.5
  },
  merchant: {
    patrol: 1.2,
    raid: 0.4,
    siege: 0.3,
    invade: 0.2,
    fortify: 1.0,
    recruit: 0.8,
    bribe_official: 2.5,
    fund_trade_route: 3.5,
    create_shortage: 2.0,
    price_manipulation: 3.0,
    corrupt_governor: 2.0,
    replace_mayor: 1.5,
    pass_law: 1.8,
    assassination: 0.6,
    blackmail: 1.2,
    spy_network: 1.5,
    sabotage: 0.8,
    convert_citizens: 0.4,
    build_temple: 0.6,
    declare_holy_war: 0.2
  },
  religious: {
    patrol: 1.0,
    raid: 0.5,
    siege: 1.0,
    invade: 1.0,
    fortify: 1.2,
    recruit: 1.5,
    bribe_official: 1.0,
    fund_trade_route: 0.8,
    create_shortage: 0.5,
    price_manipulation: 0.5,
    corrupt_governor: 1.5,
    replace_mayor: 1.8,
    pass_law: 1.5,
    assassination: 0.8,
    blackmail: 1.0,
    spy_network: 1.2,
    sabotage: 0.8,
    convert_citizens: 3.5,
    build_temple: 3.0,
    declare_holy_war: 3.5
  },
  revolutionary: {
    patrol: 0.4,
    raid: 2.0,
    siege: 1.2,
    invade: 1.0,
    fortify: 0.8,
    recruit: 2.0,
    bribe_official: 1.5,
    fund_trade_route: 0.4,
    create_shortage: 1.8,
    price_manipulation: 0.8,
    corrupt_governor: 2.5,
    replace_mayor: 3.0,
    pass_law: 0.5,
    assassination: 2.5,
    blackmail: 2.0,
    spy_network: 2.0,
    sabotage: 3.0,
    convert_citizens: 1.5,
    build_temple: 0.4,
    declare_holy_war: 0.8
  },
  defensive: {
    patrol: 3.0,
    raid: 0.5,
    siege: 0.3,
    invade: 0.2,
    fortify: 3.5,
    recruit: 2.5,
    bribe_official: 1.0,
    fund_trade_route: 1.2,
    create_shortage: 0.4,
    price_manipulation: 0.6,
    corrupt_governor: 1.2,
    replace_mayor: 1.0,
    pass_law: 1.5,
    assassination: 0.8,
    blackmail: 0.8,
    spy_network: 1.8,
    sabotage: 0.6,
    convert_citizens: 1.0,
    build_temple: 1.2,
    declare_holy_war: 0.4
  },
  isolationist: {
    patrol: 1.5,
    raid: 0.2,
    siege: 0.1,
    invade: 0.1,
    fortify: 3.0,
    recruit: 2.5,
    bribe_official: 0.5,
    fund_trade_route: 0.6,
    create_shortage: 0.2,
    price_manipulation: 0.4,
    corrupt_governor: 0.5,
    replace_mayor: 0.5,
    pass_law: 0.8,
    assassination: 0.3,
    blackmail: 0.4,
    spy_network: 1.0,
    sabotage: 0.3,
    convert_citizens: 1.5,
    build_temple: 2.5,
    declare_holy_war: 0.1
  }
};

export interface VictoryConditionConfig {
  type: FactionType;
  requiredTerritories: number;
  minTerritoryControl: number;
  minStability: number;
  minMilitary?: number;
  minWealth?: number;
  minInfluence?: number;
}

export const VICTORY_CONDITIONS: Record<FactionType, VictoryConditionConfig> = {
  empire: {
    type: "empire",
    requiredTerritories: 3,
    minTerritoryControl: 80,
    minStability: 80,
    minMilitary: 150
  },
  merchant: {
    type: "merchant",
    requiredTerritories: 2,
    minTerritoryControl: 60,
    minStability: 70,
    minWealth: 300,
    minInfluence: 150
  },
  cult: {
    type: "cult",
    requiredTerritories: 1,
    minTerritoryControl: 75,
    minStability: 80,
    minInfluence: 200
  },
  rebel: {
    type: "rebel",
    requiredTerritories: 2,
    minTerritoryControl: 70,
    minStability: 85,
    minMilitary: 120,
    minInfluence: 120
  },
  criminal: {
    type: "criminal",
    requiredTerritories: 1,
    minTerritoryControl: 60,
    minStability: 60,
    minWealth: 200,
    minInfluence: 150
  },
  secret: {
    type: "secret",
    requiredTerritories: 1,
    minTerritoryControl: 50,
    minStability: 80,
    minInfluence: 250
  },
  neutral: {
    type: "neutral",
    requiredTerritories: 2,
    minTerritoryControl: 50,
    minStability: 75
  }
};
