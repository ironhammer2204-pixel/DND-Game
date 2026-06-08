import { Pool, PoolClient } from "pg";
import { dmService } from "../ai/dmService";
import { buildCampaignSnapshot } from "../ai/contextBuilder";

export interface AgendaState {
  current_step: number;
  ticks_at_current_step: number;
  last_action: string | null;
  blocked_reason: string | null;
}

export async function tickNpcAgendas(
  client: Pool | PoolClient,
  campaignId: string
) {
  // 1. Fetch all living NPCs in the campaign
  const { rows: npcs } = await client.query(
    `SELECT id, name, location_id, agenda_state, base_stats, short_term_goal, long_term_goal
     FROM public.npcs
     WHERE campaign_id = $1 AND is_alive = true`,
    [campaignId]
  );

  for (const npc of npcs) {
    if (!npc.short_term_goal) continue; // No goal to pursue

    let state: AgendaState = npc.agenda_state || {
      current_step: 0,
      ticks_at_current_step: 0,
      last_action: null,
      blocked_reason: null,
    };

    // Parse base stats to determine personality
    const stats = npc.base_stats || {};
    const fear = stats.fear || 50;
    const ambition = stats.ambition || 50;
    
    // Personality-driven stuck threshold. High ambition = low threshold (acts fast), high fear = high threshold (waits)
    // Range: roughly 1 to 5 ticks
    const stuckThreshold = Math.max(1, Math.round(3 + (fear - ambition) / 30));

    state.ticks_at_current_step += 1;

    let firedAction: string | null = null;
    let description: string | null = null;

    if (state.ticks_at_current_step >= stuckThreshold) {
      // NPC is stuck and triggers an action
      if (fear > 60 && ambition < 70) {
        firedAction = "seek_ally";
        description = `${npc.name} was seen seeking allies, perhaps feeling overwhelmed or cautious.`;
      } else if (ambition > 70) {
        firedAction = "drastic_move";
        description = `${npc.name} made a drastic and reckless move to advance their agenda.`;
      } else {
        firedAction = "spread_rumour";
        description = `${npc.name} has been spreading rumours and asking pointed questions around town.`;
      }

      state.last_action = firedAction;
      state.ticks_at_current_step = 0; // Reset stuck counter after taking action

      // Fire the world event
      const logRes = await client.query(
        `INSERT INTO public.event_log (campaign_id, type, actor_id, payload)
         VALUES ($1, 'npc_action', $2, $3)
         RETURNING id`,
        [
          campaignId,
          npc.id,
          JSON.stringify({
            action_type: "npc_action",
            actor_name: npc.name,
            npc_action: firedAction,
            description,
          }),
        ]
      );

      // We'll narrate this via a generic action later or add a specific enqueuer
      if (dmService.isEnabled() && logRes.rows[0].id) {
        const snapshot = await buildCampaignSnapshot(client, campaignId);
        // Using generic action enqueuer
        dmService.enqueueAction(client as Pool, logRes.rows[0].id, campaignId, {
          campaignId,
          party: snapshot.party,
          location: snapshot.location ?? { name: "unknown", description: "" },
          npcs: snapshot.npcs,
          quests: snapshot.quests,
          recentEvents: snapshot.recentEvents,
          actorName: npc.name,
          actionDescription: `Took an independent action: ${description}`,
          serverResult: "resolved by server"
        });
      }
    } else {
      // Not stuck yet, maybe they just passively wait
      state.last_action = "wait";
    }

    // Save updated state
    await client.query(
      `UPDATE public.npcs SET agenda_state = $1 WHERE id = $2`,
      [JSON.stringify(state), npc.id]
    );
  }
}

export async function updateNpcRelationship(
  client: Pool | PoolClient,
  npcId: string,
  characterId: string,
  delta: number
) {
  const { rows } = await client.query(
    `SELECT relationship_map FROM public.npcs WHERE id = $1`,
    [npcId]
  );
  if (!rows.length) return;

  const map = rows[0].relationship_map || {};
  const current = map[characterId] || 0;
  map[characterId] = Math.max(-100, Math.min(100, current + delta));

  await client.query(
    `UPDATE public.npcs SET relationship_map = $1 WHERE id = $2`,
    [JSON.stringify(map), npcId]
  );
}

export async function checkSecretRevealConditions(
  client: Pool | PoolClient,
  npcId: string,
  campaignId: string
): Promise<boolean> {
  const { rows: npcs } = await client.query(
    `SELECT name, secret, secret_revealed, relationship_map
     FROM public.npcs
     WHERE id = $1`,
    [npcId]
  );

  if (!npcs.length) return false;
  const npc = npcs[0];

  if (!npc.secret || npc.secret_revealed) {
    return false; // Already revealed or no secret
  }

  // Calculate average trust
  const map = npc.relationship_map || {};
  const values = Object.values(map) as number[];
  const avgTrust = values.length > 0
    ? values.reduce((sum, val) => sum + val, 0) / values.length
    : 0;

  // Reveal if average trust > 80
  if (avgTrust > 80) {
    await client.query(
      `UPDATE public.npcs SET secret_revealed = true WHERE id = $1`,
      [npcId]
    );

    const logRes = await client.query(
      `INSERT INTO public.event_log (campaign_id, type, actor_id, payload)
       VALUES ($1, 'npc_secret_reveal', $2, $3)
       RETURNING id`,
      [
        campaignId,
        npcId,
        JSON.stringify({
          action_type: "npc_secret_reveal",
          actor_name: npc.name,
          secret: npc.secret,
          trigger: "high_trust",
        }),
      ]
    );

    if (dmService.isEnabled() && logRes.rows[0].id) {
      const snapshot = await buildCampaignSnapshot(client, campaignId);
      dmService.enqueueAction(client as Pool, logRes.rows[0].id, campaignId, {
        campaignId,
        party: snapshot.party,
        location: snapshot.location ?? { name: "unknown", description: "" },
        npcs: snapshot.npcs,
        quests: snapshot.quests,
        recentEvents: snapshot.recentEvents,
        actorName: npc.name,
        actionDescription: `In a moment of deep trust, confided a secret: ${npc.secret}`,
        serverResult: "resolved by server"
      });
    }
    return true;
  }

  return false;
}
