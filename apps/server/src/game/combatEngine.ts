import { Pool, PoolClient } from "pg";
import { pool } from "../db/client";
import { MONSTERS, CombatParticipant, CombatEncounter } from "@dnd/shared";
import { rollDice, rollWithAdvantage, rollWithDisadvantage } from "./diceEngine";
import { RoomManager } from "../websocket/roomManager";

const turnTimers = new Map<string, NodeJS.Timeout>();

function parseDamageDice(damageDice: string, modifier: number): number {
  const match = damageDice.match(/^(\d+)d(\d+)$/);
  if (!match) return Math.max(1, 1 + modifier);
  const count = parseInt(match[1], 10);
  const size = parseInt(match[2], 10);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const roll = Math.floor(Math.random() * size) + 1;
    total += roll;
  }
  return Math.max(1, total + modifier);
}

export async function getActiveEncounter(client: PoolClient | Pool, campaignId: string): Promise<CombatEncounter | null> {
  const res = await client.query(
    "SELECT id, campaign_id, status, turn_order, current_turn_index, participants, round_number, started_at FROM public.combat_encounters WHERE campaign_id = $1 AND status = 'active' LIMIT 1",
    [campaignId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    status: row.status,
    turn_order: typeof row.turn_order === "string" ? JSON.parse(row.turn_order) : row.turn_order,
    current_turn_index: row.current_turn_index,
    participants: typeof row.participants === "string" ? JSON.parse(row.participants) : row.participants,
    round_number: row.round_number,
    started_at: row.started_at,
  };
}

export async function saveEncounter(client: PoolClient | Pool, encounter: CombatEncounter): Promise<void> {
  await client.query(
    "UPDATE public.combat_encounters SET turn_order = $1, current_turn_index = $2, participants = $3, round_number = $4 WHERE id = $5",
    [
      JSON.stringify(encounter.turn_order),
      encounter.current_turn_index,
      JSON.stringify(encounter.participants),
      encounter.round_number,
      encounter.id,
    ]
  );
}

export async function startCombat(campaignId: string, monstersInput: { id: string; count: number }[]): Promise<CombatEncounter> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Verify no active combat exists
    const existing = await getActiveEncounter(client, campaignId);
    if (existing) {
      throw new Error("An active combat encounter already exists for this campaign.");
    }

    // 2. Fetch all active party members
    const charsRes = await client.query(
      `SELECT c.id, c.name, c.attributes, c.hp_current, c.hp_max, c.class, c.user_id
       FROM public.characters c
       JOIN public.campaign_members cm ON cm.character_id = c.id
       WHERE cm.campaign_id = $1 AND c.is_alive = true`,
      [campaignId]
    );

    const participants: CombatParticipant[] = [];

    // Add Players
    for (const char of charsRes.rows) {
      const dex = char.attributes?.dex || 10;
      const str = char.attributes?.str || 10;
      const dexMod = Math.floor((dex - 10) / 2);
      const strMod = Math.floor((str - 10) / 2);

      const initRoll = rollDice("d20", dexMod);

      // Base stats map loosely to weapons/defenses
      const isSpellcaster = ["Wizard", "Sorcerer", "Cleric", "Druid", "Warlock", "Bard"].includes(char.class);
      const damageDice = isSpellcaster ? "1d6" : "1d8";
      const ac = 10 + dexMod + (isSpellcaster ? 0 : 2); // Wizard gets nothing, martial gets shield/leather

      participants.push({
        id: char.id,
        name: char.name,
        type: "player",
        hp_current: char.hp_current,
        hp_max: char.hp_max,
        initiative: initRoll.final,
        conditions: [],
        death_save_successes: 0,
        death_save_failures: 0,
        ac,
        attack_bonus: dexMod > strMod ? dexMod + 2 : strMod + 2, // Finesse or strength weapon
        damage_dice: damageDice,
        damage_modifier: dexMod > strMod ? dexMod : strMod,
      });
    }

    // Add Monsters
    let monsterInstanceCount = 0;
    for (const monsterReq of monstersInput) {
      const def = MONSTERS.find((m) => m.id === monsterReq.id);
      if (!def) continue;

      for (let i = 0; i < monsterReq.count; i++) {
        const dexMod = Math.floor((def.base_stats.dex - 10) / 2);
        const initRoll = rollDice("d20", dexMod);
        const nameSuffix = String.fromCharCode(65 + i);

        participants.push({
          id: `${def.id}-${monsterInstanceCount++}`,
          name: `${def.name} ${nameSuffix}`,
          type: "enemy",
          hp_current: def.hp_max,
          hp_max: def.hp_max,
          initiative: initRoll.final,
          conditions: [],
          ac: def.ac,
          attack_bonus: def.attack_bonus,
          damage_dice: def.damage_dice,
          damage_modifier: def.damage_modifier,
          xp_value: def.xp_value,
        });
      }
    }

    // 3. Sort turn order by initiative descending
    const turnOrder = [...participants].sort((a, b) => b.initiative - a.initiative);

    // 4. Create database entry
    const insertRes = await client.query(
      `INSERT INTO public.combat_encounters (campaign_id, status, turn_order, current_turn_index, participants, round_number)
       VALUES ($1, 'active', $2, 0, $3, 1)
       RETURNING id, started_at`,
      [campaignId, JSON.stringify(turnOrder), JSON.stringify(participants)]
    );

    const encounter: CombatEncounter = {
      id: insertRes.rows[0].id,
      campaign_id: campaignId,
      status: "active",
      turn_order: turnOrder,
      current_turn_index: 0,
      participants,
      round_number: 1,
      started_at: insertRes.rows[0].started_at,
    };

    // 5. Log start event
    const startPayload = {
      action_type: "combat_start",
      text: `Combat initiated! Round 1 begins. Initiative order: ${turnOrder.map((p) => `${p.name} (${p.initiative})`).join(", ")}`,
    };
    await client.query(
      "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'combat', $2)",
      [campaignId, JSON.stringify(startPayload)]
    );

    await client.query("COMMIT");

    // Start background processing for offline players or automated turns
    processActiveTurn(campaignId, encounter.id);

    return encounter;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processCombatAction(
  campaignId: string,
  userId: string,
  actionType: "attack" | "dodge" | "end_turn",
  targetId?: string
): Promise<CombatEncounter> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const encounter = await getActiveEncounter(client, campaignId);
    if (!encounter) {
      throw new Error("No active combat encounter found.");
    }

    const activeParticipant = encounter.turn_order[encounter.current_turn_index];
    if (!activeParticipant) {
      throw new Error("Invalid turn index.");
    }

    // Validate that the user owns the active character, or is the DM
    if (activeParticipant.type === "player") {
      const charRes = await client.query(
        "SELECT user_id FROM public.characters WHERE id = $1",
        [activeParticipant.id]
      );
      const isOwner = charRes.rows[0]?.user_id === userId;

      const dmCheck = await client.query(
        "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
        [campaignId, userId]
      );
      const isDM = dmCheck.rows[0]?.role === "dm";

      if (!isOwner && !isDM) {
        throw new Error("It is not your turn to act.");
      }
    } else {
      // Monsters can only be acted upon/ended by DM
      const dmCheck = await client.query(
        "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
        [campaignId, userId]
      );
      const isDM = dmCheck.rows[0]?.role === "dm";
      if (!isDM) {
        throw new Error("Only the DM can control monster actions.");
      }
    }

    if (actionType === "attack") {
      if (!targetId) throw new Error("Attack action requires a target.");
      await performAttackAction(client, campaignId, activeParticipant, targetId, encounter);
    } else if (actionType === "dodge") {
      if (!activeParticipant.conditions.includes("dodging")) {
        activeParticipant.conditions.push("dodging");
      }
      const dodgePayload = {
        action_type: "dodge",
        text: `${activeParticipant.name} takes a defensive stance (Dodging).`,
      };
      await client.query(
        "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'combat', $2, $3)",
        [campaignId, activeParticipant.type === "player" ? activeParticipant.id : null, JSON.stringify(dodgePayload)]
      );
    }

    // Update active participant in list
    const pIdx = encounter.participants.findIndex((p) => p.id === activeParticipant.id);
    if (pIdx !== -1) {
      encounter.participants[pIdx] = activeParticipant;
    }

    // Save and advance turn
    await advanceTurn(client, encounter);

    await client.query("COMMIT");

    RoomManager.broadcastToRoom(campaignId, "COMBAT_UPDATE", { encounter });
    processActiveTurn(campaignId, encounter.id);

    return encounter;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rollDeathSave(campaignId: string, userId: string): Promise<CombatEncounter> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const encounter = await getActiveEncounter(client, campaignId);
    if (!encounter) {
      throw new Error("No active combat encounter found.");
    }

    const activeParticipant = encounter.turn_order[encounter.current_turn_index];
    if (!activeParticipant || activeParticipant.type !== "player") {
      throw new Error("It is not a player's turn to roll a death save.");
    }

    // Verify character ownership
    const charRes = await client.query(
      "SELECT user_id FROM public.characters WHERE id = $1",
      [activeParticipant.id]
    );
    if (charRes.rows[0]?.user_id !== userId) {
      throw new Error("You do not own this character.");
    }

    if (activeParticipant.hp_current > 0 || activeParticipant.conditions.includes("stable")) {
      throw new Error("Character is not unstable/downed.");
    }

    const roll = rollDice("d20", 0);
    let success = roll.raw >= 10;
    let text = `${activeParticipant.name} rolls a Death Save: ${roll.raw}`;

    if (roll.raw === 20) {
      activeParticipant.hp_current = 1;
      activeParticipant.death_save_successes = 0;
      activeParticipant.death_save_failures = 0;
      text += "! Critical Success! They regain 1 HP and stand back up.";
    } else if (roll.raw === 1) {
      activeParticipant.death_save_failures = (activeParticipant.death_save_failures || 0) + 2;
      text += "! Critical Failure! (2 failures).";
    } else if (success) {
      activeParticipant.death_save_successes = (activeParticipant.death_save_successes || 0) + 1;
      text += ` (Success ${activeParticipant.death_save_successes}/3).`;
    } else {
      activeParticipant.death_save_failures = (activeParticipant.death_save_failures || 0) + 1;
      text += ` (Failure ${activeParticipant.death_save_failures}/3).`;
    }

    // Check resolve conditions
    let characterDead = false;
    if ((activeParticipant.death_save_successes || 0) >= 3) {
      activeParticipant.conditions.push("stable");
      text += ` ${activeParticipant.name} is now STABLE.`;
      activeParticipant.death_save_successes = 0;
      activeParticipant.death_save_failures = 0;
    } else if ((activeParticipant.death_save_failures || 0) >= 3) {
      characterDead = true;
      text += ` ${activeParticipant.name} has DECEASED.`;
      activeParticipant.hp_current = 0;
      activeParticipant.death_save_successes = 0;
      activeParticipant.death_save_failures = 0;
    }

    // Update public.characters table
    if (characterDead) {
      await client.query(
        "UPDATE public.characters SET hp_current = 0, is_alive = false WHERE id = $1",
        [activeParticipant.id]
      );
    } else {
      await client.query(
        "UPDATE public.characters SET hp_current = $1 WHERE id = $2",
        [activeParticipant.hp_current, activeParticipant.id]
      );
    }

    // Update in encounter lists
    const pIdx = encounter.participants.findIndex((p) => p.id === activeParticipant.id);
    if (pIdx !== -1) {
      encounter.participants[pIdx] = activeParticipant;
    }
    const tIdx = encounter.turn_order.findIndex((p) => p.id === activeParticipant.id);
    if (tIdx !== -1) {
      encounter.turn_order[tIdx] = activeParticipant;
    }

    // Log the event
    const logPayload = {
      action_type: "death_save",
      text,
      raw_roll: roll.raw,
      successes: activeParticipant.death_save_successes,
      failures: activeParticipant.death_save_failures,
    };
    await client.query(
      "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'combat', $2, $3)",
      [campaignId, activeParticipant.id, JSON.stringify(logPayload)]
    );

    // Advance turn
    await advanceTurn(client, encounter);

    await client.query("COMMIT");

    RoomManager.broadcastToRoom(campaignId, "COMBAT_UPDATE", { encounter });
    processActiveTurn(campaignId, encounter.id);

    return encounter;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function performAttackAction(
  client: PoolClient,
  campaignId: string,
  attacker: CombatParticipant,
  targetId: string,
  encounter: CombatEncounter
): Promise<void> {
  const targetIdx = encounter.turn_order.findIndex((p) => p.id === targetId);
  if (targetIdx === -1 || encounter.turn_order[targetIdx].hp_current <= 0) {
    throw new Error("Invalid or dead target.");
  }

  const target = encounter.turn_order[targetIdx];

  // Determine advantage/disadvantage
  let rollMode: string = "normal";
  if (target.conditions.includes("dodging")) {
    rollMode = "disadvantage";
  }

  // Roll attack
  let rollResult;
  if (rollMode === "disadvantage") {
    rollResult = rollWithDisadvantage("d20", attacker.attack_bonus);
  } else if (rollMode === "advantage") {
    rollResult = rollWithAdvantage("d20", attacker.attack_bonus);
  } else {
    rollResult = rollDice("d20", attacker.attack_bonus);
  }

  const isCrit = rollResult.raw === 20;
  const isMiss = rollResult.raw === 1;
  const hit = isCrit || (!isMiss && rollResult.final >= target.ac);

  let text = `${attacker.name} attacks ${target.name}: `;
  let damage = 0;

  if (hit) {
    const diceMultiplier = isCrit ? 2 : 1;
    // Roll damage
    for (let i = 0; i < diceMultiplier; i++) {
      damage += parseDamageDice(attacker.damage_dice, i === 0 ? attacker.damage_modifier : 0);
    }
    damage = Math.max(1, damage);

    target.hp_current = Math.max(0, target.hp_current - damage);
    text += `${isCrit ? "**Critical Hit!**" : "Hit!"} Deals ${damage} damage. (${target.hp_current}/${target.hp_max} HP left).`;

    // Apply HP change in DB for players
    if (target.type === "player") {
      await client.query(
        "UPDATE public.characters SET hp_current = $1 WHERE id = $2",
        [target.hp_current, target.id]
      );
    }

    if (target.hp_current <= 0) {
      if (target.type === "player") {
        text += ` **${target.name} has been knocked unconscious!**`;
        target.death_save_successes = 0;
        target.death_save_failures = 0;
      } else {
        text += ` **${target.name} has been defeated!**`;
      }
    }
  } else {
    text += `${isMiss ? "**Critical Miss!**" : "Miss!"} (Roll: ${rollResult.final} vs AC ${target.ac}).`;
  }

  // Update target in encounter lists
  const pIdx = encounter.participants.findIndex((p) => p.id === target.id);
  if (pIdx !== -1) {
    encounter.participants[pIdx] = target;
  }
  encounter.turn_order[targetIdx] = target;

  // Insert event log
  const attackPayload = {
    action_type: "attack",
    text,
    attacker_name: attacker.name,
    target_name: target.name,
    roll: rollResult.final,
    raw_roll: rollResult.raw,
    rolls: rollResult.rolls,
    hit,
    damage,
  };
  await client.query(
    "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'combat', $2, $3)",
    [campaignId, attacker.type === "player" ? attacker.id : null, JSON.stringify(attackPayload)]
  );
}

async function advanceTurn(client: PoolClient, encounter: CombatEncounter): Promise<void> {
  // 1. Check if combat is resolved (all players dead/downed, or all enemies dead)
  const alivePlayers = encounter.participants.filter((p) => p.type === "player" && p.hp_current > 0);
  const unstablePlayers = encounter.participants.filter(
    (p) => p.type === "player" && p.hp_current === 0 && !p.conditions.includes("stable")
  );
  const aliveEnemies = encounter.participants.filter((p) => p.type === "enemy" && p.hp_current > 0);

  // Victory: no enemies remain
  if (aliveEnemies.length === 0) {
    await resolveCombatWithVictory(client, encounter);
    return;
  }

  // Defeat: no active player, and no unstable player left to save themselves
  if (alivePlayers.length === 0 && unstablePlayers.length === 0) {
    await resolveCombatWithDefeat(client, encounter);
    return;
  }

  // 2. Advance current turn index
  let loops = 0;
  do {
    encounter.current_turn_index = (encounter.current_turn_index + 1) % encounter.turn_order.length;
    if (encounter.current_turn_index === 0) {
      encounter.round_number += 1;
    }
    loops++;
  } while (
    encounter.turn_order[encounter.current_turn_index].hp_current <= 0 &&
    // Downed players still get their turn for death saves
    !(
      encounter.turn_order[encounter.current_turn_index].type === "player" &&
      !encounter.turn_order[encounter.current_turn_index].conditions.includes("stable")
    ) &&
    loops < encounter.turn_order.length
  );

  // Clear dodging condition when player starts their turn
  const activeParticipant = encounter.turn_order[encounter.current_turn_index];
  if (activeParticipant) {
    activeParticipant.conditions = activeParticipant.conditions.filter((c) => c !== "dodging");
    const tIdx = encounter.turn_order.findIndex((p) => p.id === activeParticipant.id);
    if (tIdx !== -1) {
      encounter.turn_order[tIdx] = activeParticipant;
    }
    const pIdx = encounter.participants.findIndex((p) => p.id === activeParticipant.id);
    if (pIdx !== -1) {
      encounter.participants[pIdx] = activeParticipant;
    }
  }

  await saveEncounter(client, encounter);
}

async function resolveCombatWithVictory(client: PoolClient, encounter: CombatEncounter): Promise<void> {
  encounter.status = "resolved";
  await client.query("UPDATE public.combat_encounters SET status = 'resolved' WHERE id = $1", [encounter.id]);

  // Calculate total XP
  const enemies = encounter.participants.filter((p) => p.type === "enemy");
  const totalXp = enemies.reduce((sum, e) => sum + (e.xp_value || 0), 0);

  const players = encounter.participants.filter((p) => p.type === "player");
  const xpPerPlayer = players.length > 0 ? Math.floor(totalXp / players.length) : 0;

  let text = `Combat Resolved! Victory for the party! Defeated enemies: ${enemies.map((e) => e.name).join(", ")}. Each adventurer gains ${xpPerPlayer} XP.`;

  // Distribute XP and check level ups
  for (const player of players) {
    const charRes = await client.query("SELECT xp, level, name FROM public.characters WHERE id = $1", [player.id]);
    if (charRes.rows.length > 0) {
      const currentXp = charRes.rows[0].xp;
      const currentLevel = charRes.rows[0].level;
      const nextXp = currentXp + xpPerPlayer;

      // 5e standard starter thresholds: lvl1=0, lvl2=300, lvl3=900, lvl4=2700, lvl5=6500
      let nextLevel = currentLevel;
      const thresholds = [0, 300, 900, 2700, 6500, 14000];
      while (nextLevel < thresholds.length && nextXp >= thresholds[nextLevel]) {
        nextLevel++;
      }

      let lvlText = "";
      if (nextLevel > currentLevel) {
        lvlText = ` **Level Up!** ${player.name} reached Level ${nextLevel}!`;
        // Level up increases max HP (+1d8 or fixed +5 per class level)
        await client.query(
          "UPDATE public.characters SET xp = $1, level = $2, hp_max = hp_max + 8, hp_current = hp_max + 8 WHERE id = $3",
          [nextXp, nextLevel, player.id]
        );
      } else {
        await client.query("UPDATE public.characters SET xp = $1 WHERE id = $2", [nextXp, player.id]);
      }
      text += lvlText;
    }
  }

  const logPayload = { action_type: "combat_victory", text, xp_gained: xpPerPlayer };
  await client.query(
    "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'combat', $2)",
    [encounter.campaign_id, JSON.stringify(logPayload)]
  );
}

async function resolveCombatWithDefeat(client: PoolClient, encounter: CombatEncounter): Promise<void> {
  encounter.status = "resolved";
  await client.query("UPDATE public.combat_encounters SET status = 'resolved' WHERE id = $1", [encounter.id]);

  const text = `Combat Resolved... Total Defeat. The party has fallen.`;
  const logPayload = { action_type: "combat_defeat", text };
  await client.query(
    "INSERT INTO public.event_log (campaign_id, type, payload) VALUES ($1, 'combat', $2)",
    [encounter.campaign_id, JSON.stringify(logPayload)]
  );
}

export function processActiveTurn(campaignId: string, encounterId: string) {
  // Cancel existing turn timer
  const oldTimer = turnTimers.get(encounterId);
  if (oldTimer) {
    clearTimeout(oldTimer);
    turnTimers.delete(encounterId);
  }

  // Set timeout to handle offline/enemy turns asynchronously
  const timer = setTimeout(async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const encounter = await getActiveEncounter(client, campaignId);
      if (!encounter || encounter.status === "resolved") {
        await client.query("COMMIT");
        return;
      }

      const activeParticipant = encounter.turn_order[encounter.current_turn_index];
      if (!activeParticipant) {
        await client.query("COMMIT");
        return;
      }

      // 1. If it's an enemy, execute Automated enemy AI
      if (activeParticipant.type === "enemy") {
        if (activeParticipant.hp_current > 0) {
          // Select target: random alive player
          const alivePlayers = encounter.turn_order.filter((p) => p.type === "player" && p.hp_current > 0);
          if (alivePlayers.length > 0) {
            const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
            await performAttackAction(client, campaignId, activeParticipant, target.id, encounter);
          }
        }

        await advanceTurn(client, encounter);
        await client.query("COMMIT");

        RoomManager.broadcastToRoom(campaignId, "COMBAT_UPDATE", { encounter });
        // Trigger next turn check recursively
        processActiveTurn(campaignId, encounter.id);
        return;
      }

      // 2. If it's a player, check if player is disconnected/offline
      if (activeParticipant.type === "player") {
        // If they are stable/saved, they just pass
        if (activeParticipant.hp_current === 0 && activeParticipant.conditions.includes("stable")) {
          await advanceTurn(client, encounter);
          await client.query("COMMIT");
          RoomManager.broadcastToRoom(campaignId, "COMBAT_UPDATE", { encounter });
          processActiveTurn(campaignId, encounter.id);
          return;
        }

        // Check if player is offline
        const participants = RoomManager.getParticipantsInRoom(campaignId);
        const playerOnline = participants.some((p) => p.characterId === activeParticipant.id);

        if (!playerOnline) {
          // Player is offline: auto-dodge and advance turn
          if (!activeParticipant.conditions.includes("dodging")) {
            activeParticipant.conditions.push("dodging");
          }

          const autoDodgePayload = {
            action_type: "auto_dodge",
            text: `${activeParticipant.name} is offline. Auto-dodging and ending turn.`,
          };
          await client.query(
            "INSERT INTO public.event_log (campaign_id, type, actor_id, payload) VALUES ($1, 'combat', $2, $3)",
            [campaignId, activeParticipant.id, JSON.stringify(autoDodgePayload)]
          );

          // Update participant
          const pIdx = encounter.participants.findIndex((p) => p.id === activeParticipant.id);
          if (pIdx !== -1) {
            encounter.participants[pIdx] = activeParticipant;
          }

          await advanceTurn(client, encounter);
          await client.query("COMMIT");

          RoomManager.broadcastToRoom(campaignId, "COMBAT_UPDATE", { encounter });
          processActiveTurn(campaignId, encounter.id);
          return;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error in automated combat step:", err);
    } finally {
      client.release();
    }
  }, 1500); // 1.5-second artificial delay for monster turns or disconnect skips

  turnTimers.set(encounterId, timer);
}
