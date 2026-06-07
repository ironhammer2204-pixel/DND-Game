import { Pool, PoolClient } from "pg";
import { pool } from "../db/client.js";
import { 
  NPC_TEMPLATES, 
  LOCATION_TEMPLATES, 
  QUEST_TEMPLATES, 
  NPCTemplate,
  LocationTemplate,
  QuestTemplate,
  Nemesis,
  CombatParticipant
} from "@dnd/shared";
import { RoomManager } from "../websocket/roomManager.js";
import { dmService } from "../ai/dmService.js";
import { buildCampaignSnapshot } from "../ai/contextBuilder.js";
import { 
  triggerNemesisAmbush, 
  getNemesisById, 
  recordNemesisHistory 
} from "./nemesisEngine.js";
import { runFactionCycle } from "./factionEngine.js";
import { tickNpcAgendas } from "./npcAgendaEngine.js";

// Helper to convert DB row to Nemesis matching nemesisEngine format
function rowToNemesis(row: any): Nemesis {
  const asJson = (val: any) => typeof val === "string" ? JSON.parse(val) : val;
  return {
    ...row,
    traits: asJson(row.traits ?? {}),
    tactics: asJson(row.tactics ?? {}),
    stats: asJson(row.stats ?? {}),
    scars: asJson(row.scars ?? []),
    appearance: asJson(row.appearance ?? {}),
    minion_ids: row.minion_ids ?? [],
  };
}

/**
 * 1. Tick Nemesis Movement and Rest Ambush
 */
export async function tickNemesisMovement(
  client: PoolClient | Pool,
  campaignId: string,
  isRestAction: boolean
): Promise<void> {
  const campaignRes = await client.query(
    "SELECT world_state FROM public.campaigns WHERE id = $1",
    [campaignId]
  );
  if (campaignRes.rows.length === 0) return;
  const worldState = campaignRes.rows[0].world_state || {};
  const charLocations = worldState.character_locations || {};
  const partyLocations = Array.from(new Set(Object.values(charLocations) as string[]));

  if (partyLocations.length === 0) return;

  const nemesesRes = await client.query(
    "SELECT * FROM public.nemeses WHERE campaign_id = $1 AND status IN ('active', 'ambushing')",
    [campaignId]
  );
  const nemeses = nemesesRes.rows.map(rowToNemesis);

  if (isRestAction) {
    for (const nemesis of nemeses) {
      if (nemesis.grudge_score >= 80 && nemesis.location_id) {
        const isAtPartyLocation = partyLocations.includes(nemesis.location_id);
        if (isAtPartyLocation) {
          await triggerNemesisAmbush(client, campaignId, nemesis.id);
          
          const locRes = await client.query("SELECT name FROM public.locations WHERE id = $1", [nemesis.location_id]);
          const locName = locRes.rows[0]?.name || "their camp";

          const payload = {
            action_type: "ambush",
            text: `AMBUSH! While resting at ${locName}, the party is suddenly ambushed by ${nemesis.name} ${nemesis.epithet || ""}!`,
            nemesis_id: nemesis.id,
          };
          const logRes = await client.query(
            "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'exploration', $2) RETURNING id, created_at",
            [campaignId, JSON.stringify(payload)]
          );
          
          RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
            id: logRes.rows[0].id,
            type: "exploration",
            actor_name: nemesis.name,
            payload,
            timestamp: logRes.rows[0].created_at
          });

          if (dmService.isEnabled() && logRes.rows[0].id) {
            const snapshot = await buildCampaignSnapshot(client, campaignId);
            if (snapshot.nemesis && snapshot.location) {
              dmService.enqueueNemesisAmbush(pool, logRes.rows[0].id, campaignId, {
                party: snapshot.party,
                location: snapshot.location,
                nemesis: snapshot.nemesis,
              });
            }
          }
        }
      }
    }
  }

  const movementChance = 0.4;
  const movedNemeses: Record<string, string> = {};

  for (const nemesis of nemeses) {
    if (Math.random() > movementChance) continue;
    
    const currentLocId = nemesis.location_id;
    if (!currentLocId) continue;

    const locRes = await client.query(
      "SELECT id, name, connected_locations FROM public.locations WHERE id = $1",
      [currentLocId]
    );
    if (locRes.rows.length === 0) continue;
    const connectedIds: string[] = locRes.rows[0].connected_locations || [];
    if (connectedIds.length === 0) continue;

    let targetLocId = "";
    const partyConnected = connectedIds.filter(id => partyLocations.includes(id));
    
    if (nemesis.grudge_score > 50 && partyConnected.length > 0 && Math.random() < 0.7) {
      targetLocId = partyConnected[Math.floor(Math.random() * partyConnected.length)];
    } else {
      targetLocId = connectedIds[Math.floor(Math.random() * connectedIds.length)];
    }

    if (targetLocId && targetLocId !== currentLocId) {
      movedNemeses[nemesis.id] = targetLocId;
    }
  }

  for (const [nemesisId, targetLocId] of Object.entries(movedNemeses)) {
    const nemesis = nemeses.find((n: Nemesis) => n.id === nemesisId)!;
    
    await client.query(
      "UPDATE public.nemeses SET location_id = $1, last_seen_at = now() WHERE id = $2",
      [targetLocId, nemesisId]
    );

    await recordNemesisHistory(client, campaignId, nemesisId, {
      eventType: "nemesis_moved",
      summary: `${nemesis.name} moved to a new location.`,
      mechanicalData: { from_location_id: nemesis.location_id, to_location_id: targetLocId }
    });

    if (nemesis.tier === "warlord" || nemesis.tier === "archnemesis") {
      await client.query(
        `UPDATE public.locations
         SET state = state || jsonb_build_object('nemesis_controlled', true, 'controlling_nemesis_id', $1)
         WHERE id = $2`,
         [nemesisId, targetLocId]
      );

      const otherWarlords = await client.query(
        `SELECT id FROM public.nemeses
         WHERE campaign_id = $1 AND location_id = $2 AND tier IN ('warlord', 'archnemesis') AND id != $3 AND status IN ('active', 'ambushing')`,
        [campaignId, nemesis.location_id, nemesisId]
      );
      if (otherWarlords.rows.length === 0 && nemesis.location_id) {
        await client.query(
          `UPDATE public.locations
           SET state = state - 'nemesis_controlled' - 'controlling_nemesis_id'
           WHERE id = $1`,
          [nemesis.location_id]
        );
      }
    }

    if (nemesis.faction_id) {
      const factionMembers = nemeses.filter((n: Nemesis) => n.faction_id === nemesis.faction_id && n.id !== nemesis.id && n.location_id);
      for (const member of factionMembers) {
        const memberLocRes = await client.query("SELECT connected_locations FROM public.locations WHERE id = $1", [member.location_id]);
        const memberConnections: string[] = memberLocRes.rows[0]?.connected_locations || [];
        if (memberConnections.includes(targetLocId) && Math.random() < 0.5) {
          await client.query(
            "UPDATE public.nemeses SET location_id = $1, last_seen_at = now() WHERE id = $2",
            [targetLocId, member.id]
          );
          await recordNemesisHistory(client, campaignId, member.id, {
            eventType: "nemesis_moved",
            summary: `${member.name} relocated to reinforce ${nemesis.name}.`,
            mechanicalData: { from_location_id: member.location_id, to_location_id: targetLocId }
          });
        }
      }
    }
  }

  if (Object.keys(movedNemeses).length > 0) {
    const updatedNemesesRes = await client.query(
      "SELECT n.*, f.name AS faction_name, l.name AS location_name, c.name AS target_character_name FROM public.nemeses n LEFT JOIN public.factions f ON f.id = n.faction_id LEFT JOIN public.locations l ON l.id = n.location_id LEFT JOIN public.characters c ON c.id = n.target_character_id WHERE n.campaign_id = $1",
      [campaignId]
    );
    for (const row of updatedNemesesRes.rows) {
      const nemesis = rowToNemesis(row);
      RoomManager.broadcastToRoom(campaignId, "NEMESIS_UPDATE", { nemesis, reason: "heartbeat_movement" });
    }
  }
}

/**
 * 2. Tick Faction Power & Pressure
 */
export async function tickFactionPressure(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const factionsRes = await client.query(
    "SELECT id, name, power_level, disposition FROM public.factions WHERE campaign_id = $1",
    [campaignId]
  );
  if (factionsRes.rows.length === 0) return;

  for (const faction of factionsRes.rows) {
    let powerDelta = 0;
    
    // Check controlled locations via active Warlord nemeses in this faction
    const controlledRes = await client.query(
      `SELECT count(*)::int AS count FROM public.locations l
       JOIN public.nemeses n ON (l.state->>'controlling_nemesis_id')::uuid = n.id
       WHERE n.faction_id = $1 AND l.state->>'nemesis_controlled' = 'true'`,
      [faction.id]
    );
    const locCount = controlledRes.rows[0]?.count || 0;
    powerDelta += locCount * 5;

    // Faction decays/grows slightly naturally
    powerDelta += faction.disposition === "hostile" ? 1 : 2;

    const newPower = Math.min(100, Math.max(1, faction.power_level + powerDelta));
    
    await client.query(
      "UPDATE public.factions SET power_level = $1 WHERE id = $2",
      [newPower, faction.id]
    );

    // Trigger Faction Events at thresholds (50, 70, 90)
    if (newPower >= 70 && faction.power_level < 70) {
      // Set Campaign Flag: faction_ascendant
      await updateCampaignFlag(client, campaignId, "faction_ascendant", true);

      // Log Faction Escalation Action
      const logRes = await client.query(
        `INSERT INTO public.npc_action_log (campaign_id, npc_id, action_type, summary)
         VALUES ($1, $2, 'faction_escalation', $3) RETURNING id`,
        [
          campaignId,
          null, // System event — no specific NPC
          `The ${faction.name} faction has expanded their sphere of influence. Assassination squads are active.`
        ]
      );

      RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
        id: logRes.rows[0].id,
        type: "system",
        payload: {
          action_type: "faction_escalation",
          text: `WARNING: The ${faction.name} faction power has crossed threshold levels. Word reaches the taverns of their ascendance.`
        },
        timestamp: new Date().toISOString()
      });
    }
  }
}

/**
 * 3. Tick NPC Agendas
 * Canonical implementation lives in npcAgendaEngine.ts — imported above.
 * This local duplicate has been removed to prevent double-ticking.
 */

/**
 * 4. Check Location Unlocks
 */
export async function checkLocationUnlocks(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const campaignRes = await client.query(
    "SELECT world_state, world_flags FROM public.campaigns WHERE id = $1",
    [campaignId]
  );
  if (campaignRes.rows.length === 0) return;
  const worldState = campaignRes.rows[0].world_state || {};
  const worldFlags = campaignRes.rows[0].world_flags || {};
  const discoveredLocationIds = new Set<string>(worldState.discovered_location_ids || []);

  // Get active party level
  const charRes = await client.query("SELECT MAX(level) AS max_level FROM public.characters WHERE campaign_id = $1 AND is_alive = true", [campaignId]);
  const partyLevel = charRes.rows[0]?.max_level || 1;

  // Read already instantiated locations by template key
  const instantiatedRes = await client.query("SELECT state->>'template_id' AS template_id FROM public.locations WHERE campaign_id = $1", [campaignId]);
  const instantiatedTemplateIds = new Set<string>(instantiatedRes.rows.map(r => r.template_id).filter(Boolean));

  for (const template of LOCATION_TEMPLATES) {
    if (instantiatedTemplateIds.has(template.id)) continue;

    const cond = template.unlock_conditions;
    let satisfies = true;

    // Check level min
    if (cond.party_level_min && partyLevel < cond.party_level_min) satisfies = false;

    // Check world flags
    if (cond.world_flags_required) {
      for (const flag of cond.world_flags_required) {
        if (!worldFlags[flag]) {
          satisfies = false;
          break;
        }
      }
    }

    if (satisfies) {
      // Instantiate Location
      const nextLocationId = crypto.randomUUID();
      await client.query(
        `INSERT INTO public.locations (id, campaign_id, name, type, description, lore, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          nextLocationId, 
          campaignId, 
          template.name, 
          template.type, 
          template.description, 
          template.lore, 
          JSON.stringify({ template_id: template.id, discovered: true })
        ]
      );

      // Add to discovered_location_ids
      discoveredLocationIds.add(nextLocationId);

      // Log event
      const logRes = await client.query(
        "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'exploration', $2) RETURNING id, created_at",
        [campaignId, JSON.stringify({ action_type: "location_discovered", text: `A new location has been discovered: ${template.name}!`, location_id: nextLocationId })]
      );

      RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
        id: logRes.rows[0].id,
        type: "exploration",
        payload: {
          action_type: "location_discovered",
          text: `A new path opens: ${template.name} is now accessible.`
        },
        timestamp: logRes.rows[0].created_at ? new Date(logRes.rows[0].created_at).toISOString() : new Date().toISOString()
      });
    }
  }

  // Update campaign discovered location lists
  await client.query(
    "UPDATE public.campaigns SET world_state = jsonb_set(world_state, '{discovered_location_ids}', $1) WHERE id = $2",
    [JSON.stringify(Array.from(discoveredLocationIds)), campaignId]
  );
}

/**
 * 5. Check Quest Triggers
 */
export async function checkQuestTriggers(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const campaignRes = await client.query(
    "SELECT world_flags FROM public.campaigns WHERE id = $1",
    [campaignId]
  );
  if (campaignRes.rows.length === 0) return;
  const worldFlags = campaignRes.rows[0].world_flags || {};

  const activeQuestsRes = await client.query(
    "SELECT title FROM public.quests WHERE campaign_id = $1",
    [campaignId]
  );
  const existingTitles = new Set<string>(activeQuestsRes.rows.map(r => r.title));

  for (const template of QUEST_TEMPLATES) {
    if (existingTitles.has(template.title)) continue;

    const cond = template.trigger_conditions;
    let satisfies = true;

    if (cond.world_flags_required) {
      for (const flag of cond.world_flags_required) {
        if (!worldFlags[flag]) satisfies = false;
      }
    }

    if (satisfies) {
      // Map templates locations and NPCs to instantiated equivalents
      const objectives = template.objectives.map(obj => {
        return {
          text: obj.text,
          completed: false,
          condition: obj.condition
        };
      });

      const questRes = await client.query(
        `INSERT INTO public.quests (campaign_id, type, title, description, objectives, rewards, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         RETURNING *`,
        [campaignId, template.type, template.title, template.description, JSON.stringify(objectives), JSON.stringify(template.rewards)]
      );

      RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: questRes.rows[0] });

      await client.query(
        "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'quest', $2)",
        [campaignId, JSON.stringify({ action_type: "quest_unlocked", text: `New Quest Unlocked: "${template.title}"` })]
      );
    }
  }
}

/**
 * 6. Check NPC Spawns
 */
export async function checkNpcSpawns(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const locationsRes = await client.query(
    "SELECT id, type, name FROM public.locations WHERE campaign_id = $1",
    [campaignId]
  );

  for (const loc of locationsRes.rows) {
    // Count NPCs in this location
    const npcsCountRes = await client.query("SELECT count(*)::int AS count FROM public.npcs WHERE location_id = $1 AND is_alive = true", [loc.id]);
    const npcCount = npcsCountRes.rows[0]?.count || 0;

    if (npcCount < 3) {
      // Choose template matching location type
      const candidates = NPC_TEMPLATES.filter(t => t.location_types.includes(loc.type));
      if (candidates.length === 0) continue;

      const template = candidates[Math.floor(Math.random() * candidates.length)];
      const name = template.name_pool[Math.floor(Math.random() * template.name_pool.length)] || "Unknown Traveler";

      // Verify name does not conflict with active NPCs in this campaign
      const conflictRes = await client.query("SELECT id FROM public.npcs WHERE campaign_id = $1 AND name = $2 AND is_alive = true", [campaignId, name]);
      if (conflictRes.rows.length > 0) continue; // Skip if name exists

      await client.query(
        `INSERT INTO public.npcs (campaign_id, name, role, location_id, is_alive, base_stats, short_term_goal, long_term_goal, secret, urgency, power_level)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10)`,
        [
          campaignId, 
          name, 
          template.role, 
          loc.id, 
          JSON.stringify(template.base_stats),
          template.short_term_goal || null,
          template.long_term_goal || null,
          template.secret || null,
          1, // Default Urgency
          1  // Default Power Level
        ]
      );

      await client.query(
        "INSERT INTO public.npc_action_log (campaign_id, npc_id, action_type, summary) VALUES ($1, $2, 'spawn', $3)",
        [campaignId, null, `${name} arrived at ${loc.name}.`]
      );
    }
  }
}

/**
 * 7. Check Quest Objectives
 */
export async function checkQuestObjectives(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const questsRes = await client.query(
    "SELECT id, title, objectives, rewards, status FROM public.quests WHERE campaign_id = $1 AND status = 'active'",
    [campaignId]
  );
  if (questsRes.rows.length === 0) return;

  const charactersRes = await client.query("SELECT id FROM public.characters WHERE campaign_id = $1 AND is_alive = true", [campaignId]);
  const characterIds = charactersRes.rows.map(r => r.id);

  for (const quest of questsRes.rows) {
    const objectives = Array.isArray(quest.objectives) ? quest.objectives : [];
    let updated = false;

    for (const obj of objectives) {
      if (obj.completed) continue;

      const cond = obj.condition;
      if (!cond) continue;

      if (cond.type === "location_visit") {
        // Find instantiated location matching template key
        const instLocRes = await client.query(
          "SELECT id FROM public.locations WHERE campaign_id = $1 AND (state->>'template_id' = $2 OR id::text = $2)",
          [campaignId, cond.location_id]
        );
        if (instLocRes.rows.length > 0) {
          const locId = instLocRes.rows[0].id;
          const charInLocRes = await client.query(
            "SELECT count(*)::int AS count FROM public.campaigns WHERE id = $1 AND (world_state->'character_locations')->>ANY($2::text[]) = $3",
            [campaignId, characterIds, locId]
          );
          if ((charInLocRes.rows[0]?.count || 0) > 0) {
            obj.completed = true;
            updated = true;
          }
        }
      } 
      
      else if (cond.type === "kill_count") {
        // Query event logs/behaviour logs to see if kills match the count
        const killsRes = await client.query(
          `SELECT count(*)::int AS count FROM public.character_behaviour_log
           WHERE campaign_id = $1 AND action_type = 'kill' AND context->>'target_faction' = $2`,
          [campaignId, cond.target_faction]
        );
        const killCount = killsRes.rows[0]?.count || 0;
        if (killCount >= (cond.required_count || 1)) {
          obj.completed = true;
          updated = true;
        }
      } 
      
      else if (cond.type === "npc_interaction") {
        const interactionRes = await client.query(
          `SELECT count(*)::int AS count FROM public.event_log
           WHERE campaign_id = $1 AND type = 'exploration' AND payload->>'action_type' = 'npc_interaction' AND payload->>'npc_archetype' = $2`,
          [campaignId, cond.npc_archetype]
        );
        if ((interactionRes.rows[0]?.count || 0) > 0) {
          obj.completed = true;
          updated = true;
        }
      }
    }

    if (updated) {
      const allCompleted = objectives.every((o: any) => o.completed);
      const nextStatus = allCompleted ? "complete" : "active";

      const updatedQuest = await client.query(
        `UPDATE public.quests
         SET objectives = $1, status = $2, completed_at = CASE WHEN $2 = 'complete' THEN now() ELSE NULL END
         WHERE id = $3
         RETURNING *`,
        [JSON.stringify(objectives), nextStatus, quest.id]
      );

      RoomManager.broadcastToRoom(campaignId, "QUEST_UPDATE", { quest: updatedQuest.rows[0] });

      if (allCompleted) {
        // Pay rewards
        const rewards = quest.rewards || {};
        const gold = rewards.gold || 0;
        const xp = rewards.xp || 0;

        await client.query("UPDATE public.characters SET gold = gold + $1, xp = xp + $2 WHERE campaign_id = $3 AND is_alive = true", [gold, xp, campaignId]);

        const logRes = await client.query(
          "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'quest', $2) RETURNING id, created_at",
          [campaignId, JSON.stringify({ action_type: "quest_complete", text: `Quest Complete: "${quest.title}"! Rewards granted: ${gold} gold, ${xp} XP.` })]
        );

        RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
          id: logRes.rows[0].id,
          type: "quest",
          payload: {
            action_type: "quest_complete",
            text: `Quest Complete: "${quest.title}"! Rewards granted.`
          },
          timestamp: logRes.rows[0].created_at ? new Date(logRes.rows[0].created_at).toISOString() : new Date().toISOString()
        });
      }
    }
  }
}

/**
 * 8. Check Consequence Arcs
 */
export async function checkConsequenceArcs(
  client: PoolClient | Pool,
  campaignId: string
): Promise<void> {
  const charactersRes = await client.query("SELECT id, name FROM public.characters WHERE campaign_id = $1 AND is_alive = true", [campaignId]);

  for (const char of charactersRes.rows) {
    const profileRes = await client.query("SELECT tag_scores FROM public.character_behaviour_profile WHERE character_id = $1", [char.id]);
    if (profileRes.rows.length === 0) continue;

    const scores = profileRes.rows[0].tag_scores || {};
    const shadow = Number(scores.shadow || 0);
    const betrayal = Number(scores.betrayal || 0);
    const cruelty = Number(scores.cruelty || 0);
    const mercy = Number(scores.mercy || 0);
    const curiosity = Number(scores.curiosity || 0);
    const forbidden = Number(scores.forbidden || 0);
    const cowardice = Number(scores.cowardice || 0);
    const loyalty = Number(scores.loyalty || 0);
    const chaos = Number(scores.chaos || 0);

    // Arc 1: Shadow Guild Job
    if (shadow >= 40 && betrayal >= 20) {
      await fireConsequenceArc(client, campaignId, char.id, "shadow_guild_job", async () => {
        const text = `A messenger slips an envelope under the door for ${char.name}. Inside is a job offer from the Shadow Syndicate.`;
        await triggerArcEvent(client, campaignId, char.id, text);
        await updateCampaignFlag(client, campaignId, "forbidden_contact", true);
      });
    }

    // Arc 2: Cruelty Vendetta
    if (cruelty >= 50 && mercy < 10) {
      await fireConsequenceArc(client, campaignId, char.id, "cruelty_vendetta", async () => {
        const text = `Rumours spread of a survivor seeking vengeance. An ambush team is tracking ${char.name}.`;
        await triggerArcEvent(client, campaignId, char.id, text);
        await updateCampaignFlag(client, campaignId, "blood_debt", true);
      });
    }

    // Arc 3: Entity Contact
    if (curiosity >= 60 && forbidden >= 30) {
      await fireConsequenceArc(client, campaignId, char.id, "entity_contact", async () => {
        const text = `During a rest, ${char.name} experiences a vivid dream of a dark entity making contact.`;
        await triggerArcEvent(client, campaignId, char.id, text);
        await updateCampaignFlag(client, campaignId, "forbidden_contact", true);
      });
    }

    // Arc 4: Village Destabilised
    if (chaos >= 50) {
      await fireConsequenceArc(client, campaignId, char.id, "village_destabilisation", async () => {
        const text = `Widespread panic and chaos from recent actions have destabilised the local governance.`;
        await triggerArcEvent(client, campaignId, char.id, text);
        await updateCampaignFlag(client, campaignId, "village_destabilised", true);
      });
    }
  }
}

/**
 * 9. Hidden Class Unlock Checks
 */
export async function checkHiddenClassUnlocks(
  client: PoolClient | Pool,
  characterId: string
): Promise<void> {
  const profileRes = await client.query("SELECT tag_scores FROM public.character_behaviour_profile WHERE character_id = $1", [characterId]);
  if (profileRes.rows.length === 0) return;

  const scores = profileRes.rows[0].tag_scores || {};
  const shadow = Number(scores.shadow || 0);
  const betrayal = Number(scores.betrayal || 0);
  const cruelty = Number(scores.cruelty || 0);
  const mercy = Number(scores.mercy || 0);
  const curiosity = Number(scores.curiosity || 0);
  const forbidden = Number(scores.forbidden || 0);
  const chaos = Number(scores.chaos || 0);
  const loyalty = Number(scores.loyalty || 0);
  const recklessness = Number(scores.recklessness || 0);

  // Hidden Classes Unlock definitions
  const hiddenClasses = [
    {
      id: "shadow_blade",
      name: "Shadow Blade",
      satisfied: shadow >= 50 && betrayal >= 30 && cruelty < 20,
      unlock_story: "A hooded assassin corners you in the shadows, handing you a razor-sharp dagger. 'You move like us. Take the blade.'"
    },
    {
      id: "oathbreaker",
      name: "Oathbreaker",
      satisfied: betrayal >= 60 && loyalty < 10,
      unlock_story: "Your sworn vows break as a cold shiver freezes your chest. You feel a dark, unholy energy rush through your weapon."
    },
    {
      id: "warden",
      name: "Warden",
      satisfied: mercy >= 50 && loyalty >= 40 && cruelty < 5,
      unlock_story: "A glowing spirit of the forest stands before you, blessing your shield with root and vine. 'Protect the weak.'"
    },
    {
      id: "forbidden_scholar",
      name: "Forbidden Scholar",
      satisfied: curiosity >= 70 && forbidden >= 40,
      unlock_story: "The ancient text burns your eyes, revealing dark equations of the outer planes that you cannot unsee."
    },
    {
      id: "chaos_herald",
      name: "Chaos Herald",
      satisfied: chaos >= 60 && recklessness >= 40,
      unlock_story: "Your mind expands into the roaring storm of pure chance. The fabric of fate seems to bend around your fingertips."
    }
  ];

  for (const hc of hiddenClasses) {
    if (hc.satisfied) {
      // Check if already unlocked
      const existsRes = await client.query("SELECT class_name FROM public.character_classes WHERE character_id = $1 AND class_name = $2", [characterId, hc.name]);
      if (existsRes.rows.length === 0) {
        await client.query(
          `INSERT INTO public.character_classes (character_id, class_type, class_name, unlock_story)
           VALUES ($1, 'hidden', $2, $3)`,
          [characterId, hc.name, hc.unlock_story]
        );

        // Fetch campaign_id
        const charRes = await client.query("SELECT campaign_id, name FROM public.characters WHERE id = $1", [characterId]);
        const campaignId = charRes.rows[0]?.campaign_id;
        const charName = charRes.rows[0]?.name || "The Hero";

        if (campaignId) {
          const logPayload = {
            action_type: "hidden_class_unlocked",
            text: `${charName} has unlocked a hidden class: ${hc.name}!`,
            character_id: characterId,
            class_name: hc.name
          };

          const logRes = await client.query(
            "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'system', $2, $3) RETURNING id, created_at",
            [campaignId, characterId, JSON.stringify(logPayload)]
          );

          RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
            id: logRes.rows[0].id,
            type: "system",
            actor_name: charName,
            payload: logPayload,
            timestamp: logRes.rows[0].created_at
          });

          // Generate AI story narration
          if (dmService.isEnabled() && logRes.rows[0].id) {
            const snapshot = await buildCampaignSnapshot(client, campaignId);
            dmService.enqueueAction(pool, logRes.rows[0].id, campaignId, {
              party: snapshot.party,
              location: snapshot.location ?? { name: "unknown", description: "" },
              npcs: snapshot.npcs,
              quests: snapshot.quests,
              recentEvents: snapshot.recentEvents,
              actorName: charName,
              actionDescription: `unlocked the hidden class: ${hc.name}`,
              serverResult: hc.unlock_story
            });
          }
        }
      }
    }
  }
}

/**
 * Consequence arc helpers
 */
async function fireConsequenceArc(
  client: PoolClient | Pool,
  campaignId: string,
  characterId: string,
  arcId: string,
  callback: () => Promise<void>
): Promise<void> {
  const checkRes = await client.query(
    "SELECT id FROM public.consequence_arc_log WHERE campaign_id = $1 AND character_id = $2 AND arc_id = $3",
    [campaignId, characterId, arcId]
  );
  if (checkRes.rows.length > 0) return; // Already fired

  await callback();

  await client.query(
    `INSERT INTO public.consequence_arc_log (campaign_id, character_id, arc_id, delivery_status)
     VALUES ($1, $2, $3, 'delivered')`,
    [campaignId, characterId, arcId]
  );
}

async function triggerArcEvent(
  client: PoolClient | Pool,
  campaignId: string,
  characterId: string,
  text: string
): Promise<void> {
  const payload = {
    action_type: "consequence_arc",
    text
  };

  const logRes = await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'exploration', $2, $3) RETURNING id, created_at",
    [campaignId, characterId, JSON.stringify(payload)]
  );

  RoomManager.broadcastToRoom(campaignId, "GAME_EVENT", {
    id: logRes.rows[0].id,
    type: "exploration",
    payload,
    timestamp: logRes.rows[0].created_at
  });
}

/**
 * Campaign Flags helper
 */
async function updateCampaignFlag(
  client: PoolClient | Pool,
  campaignId: string,
  flagKey: string,
  flagValue: any
): Promise<void> {
  await client.query(
    `UPDATE public.campaigns
     SET world_flags = jsonb_set(world_flags, $1::text[], $2::jsonb, true)
     WHERE id = $3`,
    [[flagKey], JSON.stringify(flagValue), campaignId]
  );
}

/**
 * Accumulated Behaviour updates helper
 */
export async function recordBehaviourEvent(
  client: PoolClient | Pool,
  campaignId: string,
  characterId: string,
  actionType: string,
  tags: string[],
  weight: number = 1,
  context: Record<string, any> = {}
): Promise<void> {
  // 1. Log the event
  await client.query(
    `INSERT INTO public.character_behaviour_log (character_id, campaign_id, action_type, tags, weight, context)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [characterId, campaignId, actionType, tags, weight, JSON.stringify(context)]
  );

  // 2. Increment behaviour profile tag scores
  const profileRes = await client.query(
    "SELECT tag_scores FROM public.character_behaviour_profile WHERE character_id = $1",
    [characterId]
  );

  let scores: Record<string, number> = {};
  if (profileRes.rows.length === 0) {
    scores = tags.reduce((acc: any, tag) => {
      acc[tag] = weight;
      return acc;
    }, {});
    await client.query(
      "INSERT INTO public.character_behaviour_profile (character_id, tag_scores, updated_at) VALUES ($1, $2, now())",
      [characterId, JSON.stringify(scores)]
    );
  } else {
    scores = profileRes.rows[0].tag_scores || {};
    for (const tag of tags) {
      scores[tag] = (Number(scores[tag] || 0)) + weight;
    }
    await client.query(
      "UPDATE public.character_behaviour_profile SET tag_scores = $1, updated_at = now() WHERE character_id = $2",
      [JSON.stringify(scores), characterId]
    );
  }

  // 3. Trigger check for hidden class unlocks
  await checkHiddenClassUnlocks(client, characterId);
}

/**
 * Main heartbeat runner
 */
export async function runWorldHeartbeat(
  client: PoolClient | Pool,
  campaignId: string,
  isRestAction: boolean
): Promise<void> {
  try {
    await tickNemesisMovement(client, campaignId, isRestAction);
    await runFactionCycle(client, campaignId, false);
    await tickNpcAgendas(client, campaignId);
    await checkLocationUnlocks(client, campaignId);
    await checkQuestTriggers(client, campaignId);
    await checkNpcSpawns(client, campaignId);
    await checkQuestObjectives(client, campaignId);
    await checkConsequenceArcs(client, campaignId);
  } catch (err) {
    console.error("[WorldEngine] Error during world heartbeat tick:", err);
  }
}
