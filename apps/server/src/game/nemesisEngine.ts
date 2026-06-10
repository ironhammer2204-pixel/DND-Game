import { Pool, PoolClient } from "pg";
import { CombatEncounter, CombatParticipant, Nemesis, NemesisHistoryEntry, NemesisPersonality, NemesisTier } from "@dnd/shared";
import { MONSTERS } from "@dnd/shared";
import { RoomManager } from "../websocket/roomManager";
import { dmService } from "../ai/dmService";
import { buildCampaignSnapshot } from "../ai/contextBuilder";
import { tickNpcAgendas } from "./npcAgendaEngine";
import { updatePlayerReputation } from "./factionEngine";
import {
  EPITHETS,
  PERSONALITY_PRESETS,
  SCARS,
  TIER_STAT_BONUSES,
  nextTier,
  pickPersonality,
} from "./nemesisConfig";
import {
  createEntryFromSource,
  updateEntryFromEvent,
  recordHistoryEvent,
  computeImportance,
} from "./encyclopediaEngine";

interface PromotionContext {
  encounterId?: string;
  reason: string;
  targetCharacterId?: string | null;
  grudgeScore?: number;
  tier?: NemesisTier;
}

interface HistoryInput {
  eventType: string;
  summary: string;
  encounterId?: string | null;
  actorCharacterId?: string | null;
  mechanicalData?: Record<string, unknown>;
}

function asJson<T>(value: T): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function rowToNemesis(row: Record<string, unknown>): Nemesis {
  return {
    ...row,
    traits: asJson(row.traits ?? {}),
    tactics: asJson(row.tactics ?? {}),
    stats: asJson(row.stats ?? {}),
    scars: asJson(row.scars ?? []),
    appearance: asJson(row.appearance ?? {}),
    minion_ids: (row.minion_ids as string[]) ?? [],
  } as Nemesis;
}

function rowToHistory(row: Record<string, unknown>): NemesisHistoryEntry {
  return {
    ...row,
    mechanical_data: asJson(row.mechanical_data ?? {}),
  } as NemesisHistoryEntry;
}

export function generateNemesisName(sourceMonsterId?: string, personality?: NemesisPersonality): string {
  const monster = MONSTERS.find((item) => item.id === sourceMonsterId);
  const root = monster?.name ?? "Unknown Foe";
  const prefixByPersonality: Record<NemesisPersonality, string> = {
    brutal: "Ghar",
    cowardly: "Snik",
    cunning: "Veyra",
    honorable: "Kael",
    vengeful: "Mord",
    warlord: "Drok",
    paranoid: "Keth",
  };
  const prefix = personality ? prefixByPersonality[personality] : "Rav";
  return `${prefix} ${root}`;
}

export function generateNemesisEpithet(tier: NemesisTier, seed: string): string {
  const options = EPITHETS[tier];
  const index = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % options.length;
  return options[index];
}

function buildStats(enemy: CombatParticipant, tier: NemesisTier) {
  const bonuses = TIER_STAT_BONUSES[tier];
  const hp = Math.max(enemy.hp_max + bonuses.hp, enemy.hp_current + bonuses.hp);
  return {
    hp_max: hp,
    ac: enemy.ac,
    attack_bonus: enemy.attack_bonus + bonuses.attack_bonus,
    damage_dice: enemy.damage_dice,
    damage_modifier: enemy.damage_modifier + bonuses.damage_modifier,
    xp_value: (enemy.xp_value || 0) + bonuses.hp * 5,
  };
}

export async function getNemesisById(client: PoolClient | Pool, campaignId: string, nemesisId: string): Promise<Nemesis | null> {
  const res = await client.query(
    `SELECT n.*, f.name AS faction_name, l.name AS location_name, c.name AS target_character_name
     FROM public.nemeses n
     LEFT JOIN public.factions f ON f.id = n.faction_id
     LEFT JOIN public.locations l ON l.id = n.location_id
     LEFT JOIN public.characters c ON c.id = n.target_character_id
     WHERE n.id = $1 AND n.campaign_id = $2`,
    [nemesisId, campaignId]
  );
  return res.rows[0] ? rowToNemesis(res.rows[0]) : null;
}

export async function recordNemesisHistory(
  client: PoolClient | Pool,
  campaignId: string,
  nemesisId: string,
  input: HistoryInput
): Promise<NemesisHistoryEntry> {
  const res = await client.query(
    `INSERT INTO public.nemesis_history
     (nemesis_id, campaign_id, encounter_id, event_type, actor_character_id, summary, mechanical_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      nemesisId,
      campaignId,
      input.encounterId || null,
      input.eventType,
      input.actorCharacterId || null,
      input.summary,
      JSON.stringify(input.mechanicalData || {}),
    ]
  );
  return rowToHistory(res.rows[0]);
}

export async function promoteEnemyToNemesis(
  client: PoolClient | Pool,
  campaignId: string,
  enemy: CombatParticipant,
  context: PromotionContext
): Promise<{ nemesis: Nemesis; history: NemesisHistoryEntry }> {
  if (enemy.nemesis_id) {
    const existing = await getNemesisById(client, campaignId, enemy.nemesis_id);
    if (existing) {
      const history = await recordNemesisHistory(client, campaignId, existing.id, {
        eventType: "nemesis_returned",
        summary: `${existing.name} ${existing.epithet || ""} survived another brush with the party.`,
        encounterId: context.encounterId,
        actorCharacterId: context.targetCharacterId,
        mechanicalData: { reason: context.reason },
      });
      return { nemesis: existing, history };
    }
  }

  const tier = context.tier || "soldier";
  const personality = pickPersonality(`${enemy.name}:${context.reason}`);
  const name = generateNemesisName(enemy.source_monster_id, personality);
  const epithet = generateNemesisEpithet(tier, `${enemy.name}:${campaignId}`);
  const preset = PERSONALITY_PRESETS[personality];
  const stats = buildStats(enemy, tier);
  const appearance = {
    silhouette: enemy.source_monster_id || "unknown",
    colors: tier === "warlord" ? ["iron", "crimson"] : ["ash", "gold"],
    mark: epithet,
  };

  const res = await client.query(
    `INSERT INTO public.nemeses
     (campaign_id, source_monster_id, name, epithet, tier, status, level, xp, personality,
      traits, tactics, stats, appearance, location_id, target_character_id, grudge_score, bounty_on_party, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10, $11, $12,
             (SELECT (world_state->>'starting_location_id')::uuid FROM public.campaigns WHERE id = $1),
             $13, $14, $15, now())
     RETURNING *`,
    [
      campaignId,
      enemy.source_monster_id || null,
      name,
      epithet,
      tier,
      tier === "warlord" ? 3 : tier === "lieutenant" ? 2 : 1,
      enemy.xp_value || 0,
      personality,
      JSON.stringify({ personality_traits: preset.traits }),
      JSON.stringify({ target_rule: preset.targetRule, aggression: preset.aggression }),
      JSON.stringify(stats),
      JSON.stringify(appearance),
      context.targetCharacterId || null,
      context.grudgeScore || 20,
      Math.max(10, (enemy.xp_value || 10) * 2),
    ]
  );

  const nemesis = rowToNemesis(res.rows[0]);
  const history = await recordNemesisHistory(client, campaignId, nemesis.id, {
    eventType: "nemesis_promoted",
    summary: `${nemesis.name} ${nemesis.epithet || ""} rose from ${enemy.name}'s defeat and now remembers the party.`,
    encounterId: context.encounterId,
    actorCharacterId: context.targetCharacterId,
    mechanicalData: { reason: context.reason, source_enemy: enemy.name, tier },
  });

  await client.query(
    "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'combat', $2)",
    [
      campaignId,
      JSON.stringify({
        action_type: "nemesis_promoted",
        text: `${nemesis.name} ${nemesis.epithet || ""} has become a ${nemesis.tier} nemesis.`,
        nemesis_id: nemesis.id,
      }),
    ]
  );
  await handleNemesisQuestIntegration(client, campaignId, nemesis, "promoted");

  // Encyclopedia: auto-create entry for the new nemesis
  void createEntryFromSource(client, "npc", nemesis.id, campaignId).catch((e: Error) =>
    console.error("[nemesisEngine] encyclopedia createEntryFromSource failed:", e.message)
  );

  return { nemesis, history };
}

export async function levelNemesisAfterEncounter(
  client: PoolClient | Pool,
  campaignId: string,
  nemesisId: string,
  xpGain: number
): Promise<Nemesis | null> {
  const nemesis = await getNemesisById(client, campaignId, nemesisId);
  if (!nemesis) return null;

  const encounters = await client.query(
    "SELECT count(*)::int AS count FROM public.nemesis_history WHERE nemesis_id = $1 AND event_type IN ('nemesis_returned','nemesis_promoted')",
    [nemesisId]
  );
  const historyCount = Number(encounters.rows[0]?.count || 0);
  const shouldTierUp = historyCount >= 3 && nemesis.tier !== "archnemesis";
  const tier = shouldTierUp ? nextTier(nemesis.tier) : nemesis.tier;
  const level = nemesis.level + 1;
  const bonuses = TIER_STAT_BONUSES[tier];
  const nextStats = {
    ...nemesis.stats,
    hp_max: Number(nemesis.stats.hp_max || 1) + 5 + bonuses.hp,
    attack_bonus: Number(nemesis.stats.attack_bonus || 0) + (shouldTierUp ? 1 : 0),
    damage_modifier: Number(nemesis.stats.damage_modifier || 0) + (shouldTierUp ? 1 : 0),
  };

  const res = await client.query(
    `UPDATE public.nemeses
     SET level = $1, xp = xp + $2, tier = $3, stats = $4, epithet = CASE WHEN $5 THEN $6 ELSE epithet END
     WHERE id = $7 AND campaign_id = $8
     RETURNING *`,
    [
      level,
      xpGain,
      tier,
      JSON.stringify(nextStats),
      shouldTierUp,
      generateNemesisEpithet(tier, nemesis.id),
      nemesisId,
      campaignId,
    ]
  );

  const updated = rowToNemesis(res.rows[0]);
  await recordNemesisHistory(client, campaignId, nemesisId, {
    eventType: shouldTierUp ? "nemesis_tiered_up" : "nemesis_leveled",
    summary: shouldTierUp
      ? `${updated.name} rose to ${updated.tier} tier.`
      : `${updated.name} grew stronger from the latest encounter.`,
    mechanicalData: { level, tier, xpGain },
  });
  if (shouldTierUp) {
    await handleNemesisQuestIntegration(client, campaignId, updated, "tiered_up");
  }
  return updated;
}

export async function applyNemesisScar(
  client: PoolClient | Pool,
  campaignId: string,
  nemesisId: string,
  seed: string
): Promise<Nemesis | null> {
  const nemesis = await getNemesisById(client, campaignId, nemesisId);
  if (!nemesis) return null;
  const existingScarTypes = new Set(nemesis.scars.map((scar) => scar.type));
  const scar = SCARS.find((item) => !existingScarTypes.has(item.type));
  if (!scar) return nemesis;

  const nextScars = [...nemesis.scars, {
    type: scar.type,
    label: scar.label,
    effect: scar.effect,
    applied_at: new Date().toISOString(),
  }];
  const nextStats = { ...nemesis.stats };
  for (const [key, penalty] of Object.entries(scar.statPenalty)) {
    nextStats[key] = Number(nextStats[key] || 0) + penalty;
  }
  const nextTraits = {
    ...nemesis.traits,
    scar_traits: [...(nemesis.traits.scar_traits || []), scar.trait],
  };
  const grudgeScore = nemesis.grudge_score + 15;

  const res = await client.query(
    `UPDATE public.nemeses
     SET scars = $1, stats = $2, traits = $3, grudge_score = $4
     WHERE id = $5 AND campaign_id = $6
     RETURNING *`,
    [JSON.stringify(nextScars), JSON.stringify(nextStats), JSON.stringify(nextTraits), grudgeScore, nemesisId, campaignId]
  );

  const updated = rowToNemesis(res.rows[0]);
  await recordNemesisHistory(client, campaignId, nemesisId, {
    eventType: "nemesis_scarred",
    summary: `${updated.name} gained a permanent scar: ${scar.label}.`,
    mechanicalData: { scar, seed },
  });

  // Encyclopedia: update nemesis entry with scar data
  const nemesisEntryRes = await client.query(
    "SELECT id FROM public.encyclopedia_entries WHERE source_type = 'npc' AND source_id = $1",
    [nemesisId]
  );
  if (nemesisEntryRes.rows.length > 0) {
    const importance = computeImportance({ player_characters_involved: 1 });
    void updateEntryFromEvent(client, nemesisEntryRes.rows[0].id, campaignId, { latest_scar: scar }, importance).catch(() => {});
  }

  return updated;
}

export function selectNemesisTarget(nemesis: Pick<Nemesis, "personality" | "target_character_id">, alivePlayers: CombatParticipant[]): CombatParticipant | null {
  if (alivePlayers.length === 0) return null;
  const preset = PERSONALITY_PRESETS[nemesis.personality];
  if ((preset.prefersGrudgeTarget || preset.targetRule === "grudge") && nemesis.target_character_id) {
    const grudgeTarget = alivePlayers.find((player) => player.id === nemesis.target_character_id);
    if (grudgeTarget) return grudgeTarget;
  }
  if (preset.targetRule === "lowest_hp") {
    return [...alivePlayers].sort((a, b) => a.hp_current - b.hp_current)[0];
  }
  if (preset.targetRule === "strongest") {
    return [...alivePlayers].sort((a, b) => (b.attack_bonus + b.hp_max) - (a.attack_bonus + a.hp_max))[0];
  }
  if (preset.targetRule === "caster") {
    return alivePlayers.find((player) => player.damage_dice === "1d6") || alivePlayers[0];
  }
  return alivePlayers[0];
}

export async function evaluateCombatForNemesisPromotion(client: PoolClient | Pool, encounter: CombatEncounter, reason: "victory" | "defeat") {
  const enemies = encounter.participants.filter((p) => p.type === "enemy");
  const existingNemeses = enemies.filter((enemy) => enemy.nemesis_id);

  for (const enemy of existingNemeses) {
    if (!enemy.nemesis_id) continue;
    if (enemy.hp_current <= 0) {
      const res = await client.query(
        "UPDATE public.nemeses SET status = 'dead', last_seen_at = now() WHERE id = $1 AND campaign_id = $2 RETURNING *",
        [enemy.nemesis_id, encounter.campaign_id]
      );
      if (res.rows[0]) {
        const nemesis = rowToNemesis(res.rows[0]);
        const history = await recordNemesisHistory(client, encounter.campaign_id, nemesis.id, {
          eventType: "nemesis_killed",
          summary: `${nemesis.name} ${nemesis.epithet || ""} was defeated by the party.`,
          encounterId: encounter.id,
          mechanicalData: { reason },
        });
        RoomManager.broadcastToRoom(encounter.campaign_id, "NEMESIS_UPDATE", { nemesis, history_entry: history, reason: "killed" });
        await handleNemesisQuestIntegration(client, encounter.campaign_id, nemesis, "killed");

        // Encyclopedia: record nemesis death as high-importance history event
        const entryRes = await client.query(
          "SELECT id FROM public.encyclopedia_entries WHERE source_type = 'npc' AND source_id = $1",
          [nemesis.id]
        );
        if (entryRes.rows.length > 0) {
          const importance = computeImportance({ deaths_involved: 1, player_characters_involved: encounter.participants.filter(p => p.type === "player").length });
          void recordHistoryEvent(
            client, encounter.campaign_id, entryRes.rows[0].id,
            "assassination",
            `${nemesis.name} Defeated`,
            `${nemesis.name} ${nemesis.epithet || ""} was slain by the party after a fierce battle.`,
            importance,
            { sourceType: "combat", sourceId: encounter.id }
          ).catch(() => {});
        }

        // Apply -20 faction relation drop on nemesis death
        if (nemesis.faction_id) {
          const players = encounter.participants.filter((p) => p.type === "player");
          for (const player of players) {
            const repCheck = await client.query(
              "SELECT id, score FROM public.player_faction_reputation WHERE campaign_id = $1 AND character_id = $2 AND faction_id = $3",
              [encounter.campaign_id, player.id, nemesis.faction_id]
            );
            if (repCheck.rows.length > 0) {
              const nextScore = Math.max(-100, repCheck.rows[0].score - 20);
              await client.query(
                "UPDATE public.player_faction_reputation SET score = $1 WHERE id = $2",
                [nextScore, repCheck.rows[0].id]
              );
            } else {
              await client.query(
                `INSERT INTO public.player_faction_reputation (campaign_id, character_id, faction_id, score, tier)
                 VALUES ($1, $2, $3, -20, 'unknown')`,
                [encounter.campaign_id, player.id, nemesis.faction_id]
              );
            }
          }
          await updatePlayerReputation(client, encounter.campaign_id);
        }

        // Auto-assign grudge to a successor if one is available
        await assignSuccessor(client, encounter.campaign_id, nemesis.id);
      }
    } else {
      await levelNemesisAfterEncounter(client, encounter.campaign_id, enemy.nemesis_id, enemy.xp_value || 25);
      if (enemy.hp_current <= Math.ceil(enemy.hp_max * 0.25)) {
        const scarred = await applyNemesisScar(client, encounter.campaign_id, enemy.nemesis_id, encounter.id);
        if (scarred) {
          RoomManager.broadcastToRoom(encounter.campaign_id, "NEMESIS_UPDATE", { nemesis: scarred, reason: "scarred" });
        }
      }
    }
  }

  if (reason !== "defeat") return;
  const candidate = enemies
    .filter((enemy) => enemy.hp_current > 0 && !enemy.nemesis_id)
    .sort((a, b) => (b.damage_dealt || 0) + (b.downed_character_ids?.length || 0) * 25 - ((a.damage_dealt || 0) + (a.downed_character_ids?.length || 0) * 25))[0];

  if (!candidate) return;
  const targetCharacterId = candidate.downed_character_ids?.[0] || encounter.participants.find((p) => p.type === "player")?.id || null;
  const tier: NemesisTier = (candidate.downed_character_ids?.length || 0) > 0 ? "lieutenant" : "soldier";
  const { nemesis, history } = await promoteEnemyToNemesis(client, encounter.campaign_id, candidate, {
    encounterId: encounter.id,
    reason: "party_defeat",
    targetCharacterId,
    grudgeScore: 35 + (candidate.downed_character_ids?.length || 0) * 10,
    tier,
  });
  RoomManager.broadcastToRoom(encounter.campaign_id, "NEMESIS_UPDATE", { nemesis, history_entry: history, reason: "promoted" });
}

export async function triggerNemesisAmbush(client: PoolClient | Pool, campaignId: string, nemesisId: string): Promise<Nemesis | null> {
  const res = await client.query(
    "UPDATE public.nemeses SET status = 'ambushing', last_seen_at = now() WHERE id = $1 AND campaign_id = $2 RETURNING *",
    [nemesisId, campaignId]
  );
  if (!res.rows[0]) return null;
  const nemesis = rowToNemesis(res.rows[0]);
  await recordNemesisHistory(client, campaignId, nemesis.id, {
    eventType: "nemesis_ambush_triggered",
    summary: `${nemesis.name} ${nemesis.epithet || ""} is preparing an ambush.`,
    mechanicalData: { grudge_score: nemesis.grudge_score },
  });
  RoomManager.broadcastToRoom(campaignId, "NEMESIS_AMBUSH", {
    nemesis,
    location_id: nemesis.location_id,
    message: `${nemesis.name} ${nemesis.epithet || ""} is hunting the party.`,
  });
  return nemesis;
}

export async function assignSuccessor(
  client: PoolClient | Pool,
  campaignId: string,
  deadNemesisId: string
): Promise<Nemesis | null> {
  const deadNemesis = await getNemesisById(client, campaignId, deadNemesisId);
  if (!deadNemesis) return null;

  // Check if a successor is already explicitly designated
  if (deadNemesis.successor_nemesis_id) {
    const designated = await getNemesisById(client, campaignId, deadNemesis.successor_nemesis_id);
    if (designated && designated.status !== "dead") {
      await client.query(
        `UPDATE public.nemeses
         SET grudge_score = grudge_score + $1,
             target_character_id = COALESCE(target_character_id, $2),
             bounty_on_party = bounty_on_party + $3
         WHERE id = $4`,
        [deadNemesis.grudge_score, deadNemesis.target_character_id, deadNemesis.bounty_on_party, designated.id]
      );
      await recordNemesisHistory(client, campaignId, designated.id, {
        eventType: "nemesis_successor_named",
        summary: `${designated.name} ${designated.epithet || ""} inherits ${deadNemesis.name}'s grudge and bounty.`,
        mechanicalData: {
          inherited_from: deadNemesis.id,
          grudge_transferred: deadNemesis.grudge_score,
          bounty_transferred: deadNemesis.bounty_on_party,
        },
      });
      const updated = await getNemesisById(client, campaignId, designated.id);
      if (updated) {
        RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
          nemesis: updated,
          reason: "successor_activated",
        });
        await handleNemesisQuestIntegration(client, campaignId, updated, "successor", deadNemesisId);
      }
      return updated;
    }
  }

  // Auto-select: pick highest-tier active nemesis in the same faction, or any active nemesis
  const candidateRes = await client.query(
    `SELECT id FROM public.nemeses
     WHERE campaign_id = $1
       AND id != $2
       AND status IN ('active', 'missing')
     ORDER BY
       CASE WHEN faction_id = $3 THEN 0 ELSE 1 END,
       CASE tier
         WHEN 'warlord' THEN 0 WHEN 'lieutenant' THEN 1 WHEN 'soldier' THEN 2 ELSE 3 END,
       grudge_score DESC
     LIMIT 1`,
    [campaignId, deadNemesisId, deadNemesis.faction_id]
  );

  if (candidateRes.rows.length === 0) return null; // No successor available

  const successorId = candidateRes.rows[0].id as string;
  await client.query(
    `UPDATE public.nemeses
     SET grudge_score = grudge_score + $1,
         target_character_id = COALESCE(target_character_id, $2),
         bounty_on_party = bounty_on_party + $3
     WHERE id = $4`,
    [deadNemesis.grudge_score, deadNemesis.target_character_id, deadNemesis.bounty_on_party, successorId]
  );

  // Link the dead nemesis's successor field
  await client.query(
    "UPDATE public.nemeses SET successor_nemesis_id = $1 WHERE id = $2",
    [successorId, deadNemesisId]
  );

  const successor = await getNemesisById(client, campaignId, successorId);
  if (successor) {
    await recordNemesisHistory(client, campaignId, successorId, {
      eventType: "nemesis_successor_named",
      summary: `${successor.name} ${successor.epithet || ""} takes up the grudge left by the fallen ${deadNemesis.name}.`,
      mechanicalData: {
        inherited_from: deadNemesisId,
        grudge_transferred: deadNemesis.grudge_score,
        bounty_transferred: deadNemesis.bounty_on_party,
      },
    });
    RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", {
      nemesis: successor,
      reason: "successor_activated",
    });
    await handleNemesisQuestIntegration(client, campaignId, successor, "successor", deadNemesisId);

    // Encyclopedia: record succession event
    const succEntryRes = await client.query(
      "SELECT id FROM public.encyclopedia_entries WHERE source_type = 'npc' AND source_id = $1",
      [successorId]
    );
    if (succEntryRes.rows.length > 0) {
      const importance = computeImportance({ factions_involved: 1, player_characters_involved: 1 });
      void recordHistoryEvent(
        client, campaignId, succEntryRes.rows[0].id,
        "succession",
        `${successor.name} Claims Succession`,
        `${successor.name} ${successor.epithet || ""} inherited the grudge and bounty of ${deadNemesis.name}.`,
        importance
      ).catch(() => {});
    }
  }
  return successor;
}

export function coordinateNemesisMinions(
  nemesis: Pick<Nemesis, "personality" | "tier" | "minion_ids">,
  alivePlayers: CombatParticipant[]
): { command: string; priority_target?: CombatParticipant } {
  if (nemesis.tier !== "warlord" && nemesis.tier !== "archnemesis") {
    return { command: "attack_freely" };
  }
  if (alivePlayers.length === 0) return { command: "hold" };

  // Warlords direct minions to focus fire on the weakest player
  const weakest = [...alivePlayers].sort((a, b) => a.hp_current - b.hp_current)[0];
  return {
    command: "focus_fire",
    priority_target: weakest,
  };
}

export async function handleNemesisQuestIntegration(
  client: PoolClient | Pool,
  campaignId: string,
  nemesis: Nemesis,
  eventType: "promoted" | "killed" | "tiered_up" | "successor",
  oldNemesisId?: string
): Promise<void> {
  try {
    if (eventType === "promoted") {
      const existingRes = await client.query(
        "SELECT id, objectives FROM public.quests WHERE campaign_id = $1 AND status = 'active'",
        [campaignId]
      );

      let hasActiveQuest = false;
      for (const row of existingRes.rows) {
        const objectives = Array.isArray(row.objectives) ? row.objectives : [];
        if (objectives.some((obj: Record<string, unknown>) => obj.nemesis_id === nemesis.id)) {
          hasActiveQuest = true;
          break;
        }
      }

      if (!hasActiveQuest) {
        let rewards: Record<string, number> = { gold: 100, xp: 150 };
        if (nemesis.tier === "lieutenant") rewards = { gold: 250, xp: 300 };
        else if (nemesis.tier === "warlord") rewards = { gold: 600, xp: 800 };
        else if (nemesis.tier === "archnemesis") rewards = { gold: 1500, xp: 2000 };

        let title = `Defeat ${nemesis.name}`;
        let description = `A new threat has arisen. ${nemesis.name} ${nemesis.epithet || ""} must be stopped.`;
        let objectives: Record<string, unknown>[] = [];

        if ((nemesis.tier === "warlord" || nemesis.tier === "archnemesis") && nemesis.faction_id) {
          title = `Break Faction Hold: ${nemesis.name}`;
          description = `${nemesis.name} ${nemesis.epithet || ""} commands faction forces in this region. Defeat their minions and dismantle their operation.`;
          objectives = [
            { text: `Defeat 3 minions of ${nemesis.name}`, completed: false },
            { text: `Defeat ${nemesis.name} ${nemesis.epithet || ""}`, completed: false, nemesis_id: nemesis.id }
          ];
        } else if (nemesis.tier === "lieutenant") {
          title = `Eliminate Minions of ${nemesis.name}`;
          description = `${nemesis.name} ${nemesis.epithet || ""} is expanding their grasp. Cleanse their scouts and eliminate them.`;
          objectives = [
            { text: `Track down and defeat ${nemesis.name}'s forward scouts`, completed: false },
            { text: `Defeat ${nemesis.name} ${nemesis.epithet || ""}`, completed: false, nemesis_id: nemesis.id }
          ];
        } else {
          objectives = [
            { text: `Defeat ${nemesis.name} ${nemesis.epithet || ""}`, completed: false, nemesis_id: nemesis.id }
          ];
        }

        const questRes = await client.query(
          `INSERT INTO public.quests (campaign_id, type, title, description, objectives, rewards)
           VALUES ($1, 'side', $2, $3, $4, $5)
           RETURNING *`,
          [campaignId, title, description, JSON.stringify(objectives), JSON.stringify(rewards)]
        );

        RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: questRes.rows[0] });
      }
    }

    else if (eventType === "killed") {
      const questsRes = await client.query(
        "SELECT id, objectives, title FROM public.quests WHERE campaign_id = $1 AND status = 'active'",
        [campaignId]
      );

      for (const row of questsRes.rows) {
        const objectives = Array.isArray(row.objectives) ? [...row.objectives] : [];
        let updated = false;
        for (const obj of objectives) {
          if (obj.nemesis_id === nemesis.id && !obj.completed) {
            obj.completed = true;
            updated = true;
          }
        }

        if (updated) {
          const allCompleted = objectives.every((obj: Record<string, unknown>) => obj.completed);
          const nextStatus = allCompleted ? "complete" : "active";
          const updatedQuestRes = await client.query(
            `UPDATE public.quests
             SET objectives = $1, status = $2, completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE NULL END
             WHERE id = $3
             RETURNING *`,
            [JSON.stringify(objectives), nextStatus, row.id]
          );

          RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: updatedQuestRes.rows[0] });

          if (allCompleted) {
            await client.query(
              `INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'quest', $2)`,
              [
                campaignId,
                JSON.stringify({
                  action_type: "quest_completed",
                  text: `Quest Complete: "${row.title}"! The threat of ${nemesis.name} has been put to rest.`,
                }),
              ]
            );
          }
        }
      }
    }

    else if (eventType === "tiered_up") {
      const questsRes = await client.query(
        "SELECT id, objectives, title, rewards, description FROM public.quests WHERE campaign_id = $1 AND status = 'active'",
        [campaignId]
      );

      for (const row of questsRes.rows) {
        const objectives = Array.isArray(row.objectives) ? row.objectives : [];
        if (objectives.some((obj: Record<string, unknown>) => obj.nemesis_id === nemesis.id)) {
          const currentRewards = row.rewards || {};
          const nextRewards = {
            ...currentRewards,
            gold: Math.ceil((currentRewards.gold || 100) * 1.5),
            xp: Math.ceil((currentRewards.xp || 150) * 1.5),
          };

          const nextObjectives = objectives.map((obj: Record<string, unknown>) => {
            if (obj.nemesis_id === nemesis.id) {
              return {
                ...obj,
                text: `Defeat ${nemesis.name} ${nemesis.epithet || ""}`,
              };
            }
            return obj;
          });

          const nextDesc = `${row.description || ""}\n(Update: ${nemesis.name} has grown stronger, now holding the title of "${nemesis.epithet || ""}". The stakes are higher!)`;

          const updatedQuestRes = await client.query(
            `UPDATE public.quests
             SET objectives = $1, rewards = $2, description = $3
             WHERE id = $4
             RETURNING *`,
            [JSON.stringify(nextObjectives), JSON.stringify(nextRewards), nextDesc, row.id]
          );

          RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: updatedQuestRes.rows[0] });
        }
      }
    }

    else if (eventType === "successor" && oldNemesisId) {
      const questsRes = await client.query(
        "SELECT id, objectives, title, description FROM public.quests WHERE campaign_id = $1 AND status = 'active'",
        [campaignId]
      );

      for (const row of questsRes.rows) {
        const objectives = Array.isArray(row.objectives) ? [...row.objectives] : [];
        if (objectives.some((obj: Record<string, unknown>) => obj.nemesis_id === oldNemesisId)) {
          objectives.push({
            text: `Defeat the successor, ${nemesis.name} ${nemesis.epithet || ""}`,
            completed: false,
            nemesis_id: nemesis.id,
          });

          const nextDesc = `${row.description || ""}\n(The grudge lives on! ${nemesis.name} ${nemesis.epithet || ""} has claimed leadership after the fall of their predecessor.)`;

          const updatedQuestRes = await client.query(
            `UPDATE public.quests
             SET objectives = $1, description = $2
             WHERE id = $3
             RETURNING *`,
            [JSON.stringify(objectives), nextDesc, row.id]
          );

          RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: updatedQuestRes.rows[0] });
        }
      }
    }
  } catch (err: unknown) {
    console.error("handleNemesisQuestIntegration error:", err instanceof Error ? err.message : String(err));
  }
}
