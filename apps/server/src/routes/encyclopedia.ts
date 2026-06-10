import { Router } from "express";
import { pool } from "../db/client";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth";
import {
  createEntryFromSource,
  grantKnowledge,
  getFilteredEntry,
  searchEncyclopedia,
  resolveRumor,
  generateSessionSummary,
  getEncyclopediaForCharacter,
  getEncyclopediaTimeline,
  getCharacterRumors,
  recordArtifactProvenance,
} from "../game/encyclopediaEngine";
import { EncyclopediaCategory, KnowledgeLevel, KnowledgeDiscoverySource } from "@dnd/shared";

const router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Helper: check DM role
// ---------------------------------------------------------------------------
async function isDm(campaignId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    "SELECT role FROM public.campaign_members WHERE campaign_id = $1 AND user_id = $2",
    [campaignId, userId]
  );
  return res.rows[0]?.role === "dm";
}

// ---------------------------------------------------------------------------
// Helper: get character for the current user in this campaign
// ---------------------------------------------------------------------------
async function getCharacterId(campaignId: string, userId: string): Promise<string | null> {
  const res = await pool.query(
    "SELECT id FROM public.characters WHERE campaign_id = $1 AND user_id = $2 AND is_alive = true LIMIT 1",
    [campaignId, userId]
  );
  return res.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/encyclopedia
// All entries filtered by character knowledge level
// ---------------------------------------------------------------------------
router.get("/:id/encyclopedia", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    const dm = await isDm(campaignId, userId);
    const category = req.query.category as EncyclopediaCategory | undefined;

    if (dm) {
      const entries = await pool.query(
        `SELECT * FROM public.encyclopedia_entries
         WHERE campaign_id = $1 ${category ? "AND category = $2" : ""}
         ORDER BY pinned DESC, importance DESC`,
        category ? [campaignId, category] : [campaignId]
      );
      return res.json({ entries: entries.rows });
    }

    const characterId = await getCharacterId(campaignId, userId);

    const entries = characterId
      ? await getEncyclopediaForCharacter(pool, campaignId, characterId, category)
      : [];

    // Fallback: if no character knowledge entries found, show all public (non-secret) entries
    // This ensures new campaigns with seeded data don't appear empty to players
    if (entries.length === 0 && !dm) {
      const fallback = await pool.query(
        `SELECT * FROM public.encyclopedia_entries
         WHERE campaign_id = $1 AND is_secret = false ${category ? "AND category = $2" : ""}
         ORDER BY pinned DESC, importance DESC`,
        category ? [campaignId, category] : [campaignId]
      );
      return res.json({ entries: fallback.rows });
    }

    return res.json({ entries });
  } catch (err) {
    console.error("[encyclopedia] GET /encyclopedia:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/encyclopedia/search?q=
// Full-text search, knowledge-filtered
// ---------------------------------------------------------------------------
router.get("/:id/encyclopedia/search", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    const query = (req.query.q as string) || "";
    const dm = await isDm(campaignId, userId);
    const characterId = dm ? null : await getCharacterId(campaignId, userId);

    const results = await searchEncyclopedia(pool, campaignId, characterId, query, dm);
    return res.json({ results });
  } catch (err) {
    console.error("[encyclopedia] GET /encyclopedia/search:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/encyclopedia/timeline
// History events sorted by in-game year
// ---------------------------------------------------------------------------
router.get("/:id/encyclopedia/timeline", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    const dm = await isDm(campaignId, userId);
    const characterId = dm ? null : await getCharacterId(campaignId, userId);

    const events = await getEncyclopediaTimeline(pool, campaignId, characterId, dm);
    return res.json({ events });
  } catch (err) {
    console.error("[encyclopedia] GET /encyclopedia/timeline:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/encyclopedia/eras
// All historical eras
// ---------------------------------------------------------------------------
router.get("/:id/encyclopedia/eras", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const eras = await pool.query(
      "SELECT * FROM public.historical_eras WHERE campaign_id = $1 ORDER BY start_year ASC",
      [campaignId]
    );
    return res.json({ eras: eras.rows });
  } catch (err) {
    console.error("[encyclopedia] GET /encyclopedia/eras:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/encyclopedia/rumors
// Character's known rumors
// ---------------------------------------------------------------------------
router.get("/:id/encyclopedia/rumors", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    const dm = await isDm(campaignId, userId);

    if (dm) {
      const rumors = await pool.query(
        "SELECT * FROM public.rumors WHERE campaign_id = $1 ORDER BY created_at DESC",
        [campaignId]
      );
      return res.json({ rumors: rumors.rows });
    }

    const characterId = await getCharacterId(campaignId, userId);
    if (!characterId) return res.json({ rumors: [] });

    const rumors = await getCharacterRumors(pool, campaignId, characterId);
    return res.json({ rumors });
  } catch (err) {
    console.error("[encyclopedia] GET /encyclopedia/rumors:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/encyclopedia/:entryId
// Single entry (knowledge-filtered)
// ---------------------------------------------------------------------------
router.get("/:id/encyclopedia/:entryId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, entryId } = req.params;
    const userId = req.user!.sub;
    const dm = await isDm(campaignId, userId);
    const characterId = dm ? null : await getCharacterId(campaignId, userId);

    const entry = await getFilteredEntry(pool, characterId ?? "", entryId, campaignId, dm);
    if (!entry) return res.status(404).json({ error: "Entry not found or insufficient knowledge" });

    // Also fetch history events and provenance for items
    const historyRes = await pool.query(
      "SELECT * FROM public.encyclopedia_history WHERE entry_id = $1 ORDER BY year ASC",
      [entryId]
    );

    const provenanceRes = entry.category === "item" || entry.category === "artifact"
      ? await pool.query(
          "SELECT * FROM public.artifact_provenance WHERE item_entry_id = $1 ORDER BY created_at ASC",
          [entryId]
        )
      : { rows: [] };

    return res.json({
      entry,
      history: historyRes.rows,
      provenance: provenanceRes.rows,
    });
  } catch (err) {
    console.error("[encyclopedia] GET /encyclopedia/:entryId:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/encyclopedia
// DM creates manual entry
// ---------------------------------------------------------------------------
router.post("/:id/encyclopedia", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const {
      category, title, subtitle, summary, full_content = {}, tags = [], is_secret = false,
    } = req.body;

    if (!category || !title) {
      return res.status(400).json({ error: "category and title are required" });
    }

    const result = await pool.query(
      `INSERT INTO public.encyclopedia_entries
       (campaign_id, category, title, subtitle, summary, full_content, tags, is_secret)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [campaignId, category, title, subtitle ?? null, summary ?? null, JSON.stringify(full_content), tags, is_secret]
    );

    return res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    console.error("[encyclopedia] POST /encyclopedia:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/campaigns/:id/encyclopedia/:entryId
// DM edits/adds custom lore/pins
// ---------------------------------------------------------------------------
router.patch("/:id/encyclopedia/:entryId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, entryId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const { custom_lore, dm_notes, pinned, is_secret, full_content, title, subtitle, summary, tags } = req.body;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    const addField = (col: string, val: any) => {
      if (val !== undefined) {
        updates.push(`${col} = $${paramIdx++}`);
        values.push(val);
      }
    };

    addField("custom_lore", custom_lore);
    addField("dm_notes", dm_notes);
    addField("pinned", pinned);
    addField("is_secret", is_secret);
    addField("title", title);
    addField("subtitle", subtitle);
    addField("summary", summary);
    addField("tags", tags);
    if (full_content !== undefined) {
      updates.push(`full_content = full_content || $${paramIdx++}::jsonb`);
      values.push(JSON.stringify(full_content));
    }

    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

    values.push(entryId, campaignId);
    const result = await pool.query(
      `UPDATE public.encyclopedia_entries SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${paramIdx} AND campaign_id = $${paramIdx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Entry not found" });
    return res.json({ entry: result.rows[0] });
  } catch (err) {
    console.error("[encyclopedia] PATCH /encyclopedia/:entryId:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/encyclopedia/:entryId/knowledge
// DM grants knowledge to a character
// ---------------------------------------------------------------------------
router.post("/:id/encyclopedia/:entryId/knowledge", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, entryId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const { character_id, knowledge_level = 2, discovery_source = "dm_grant" } = req.body;
    if (!character_id) return res.status(400).json({ error: "character_id required" });

    const knowledge = await grantKnowledge(
      pool, character_id, entryId, campaignId,
      knowledge_level as KnowledgeLevel,
      discovery_source as KnowledgeDiscoverySource
    );

    return res.json({ knowledge });
  } catch (err) {
    console.error("[encyclopedia] POST /encyclopedia/:entryId/knowledge:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/rumors
// DM or system creates rumor
// ---------------------------------------------------------------------------
router.post("/:id/rumors", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const { entry_id, content, reliability = 50, source_type = "dm", source_id, contradicts_rumor_id } = req.body;
    if (!entry_id || !content) return res.status(400).json({ error: "entry_id and content required" });

    const result = await pool.query(
      `INSERT INTO public.rumors
       (campaign_id, entry_id, content, reliability, source_type, source_id, contradicts_rumor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [campaignId, entry_id, content, reliability, source_type, source_id ?? null, contradicts_rumor_id ?? null]
    );

    return res.status(201).json({ rumor: result.rows[0] });
  } catch (err) {
    console.error("[encyclopedia] POST /rumors:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/campaigns/:id/rumors/:rumorId/resolve
// DM resolves a rumor as true or false
// ---------------------------------------------------------------------------
router.patch("/:id/rumors/:rumorId/resolve", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, rumorId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const { is_true } = req.body;
    if (typeof is_true !== "boolean") return res.status(400).json({ error: "is_true (boolean) required" });

    await resolveRumor(pool, rumorId, campaignId, is_true);
    return res.json({ success: true });
  } catch (err) {
    console.error("[encyclopedia] PATCH /rumors/:rumorId/resolve:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/sessions
// All session records
// ---------------------------------------------------------------------------
router.get("/:id/sessions", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId } = req.params;
    const userId = req.user!.sub;
    const dm = await isDm(campaignId, userId);

    const sessions = await pool.query(
      `SELECT * FROM public.session_records
       WHERE campaign_id = $1 ${dm ? "" : "AND summary_approved = true"}
       ORDER BY session_number DESC`,
      [campaignId]
    );
    return res.json({ sessions: sessions.rows });
  } catch (err) {
    console.error("[encyclopedia] GET /sessions:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/campaigns/:id/sessions/:sessionId
// Single session + summary
// ---------------------------------------------------------------------------
router.get("/:id/sessions/:sessionId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, sessionId } = req.params;
    const userId = req.user!.sub;
    const dm = await isDm(campaignId, userId);

    const sessionRes = await pool.query(
      `SELECT * FROM public.session_records WHERE id = $1 AND campaign_id = $2 ${dm ? "" : "AND summary_approved = true"}`,
      [sessionId, campaignId]
    );
    if (sessionRes.rows.length === 0) return res.status(404).json({ error: "Session not found" });
    return res.json({ session: sessionRes.rows[0] });
  } catch (err) {
    console.error("[encyclopedia] GET /sessions/:sessionId:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/campaigns/:id/sessions/:sessionId/summarize
// Trigger Groq summary generation
// ---------------------------------------------------------------------------
router.post("/:id/sessions/:sessionId/summarize", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, sessionId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    // Fire-and-forget — runs asynchronously to not block
    generateSessionSummary(pool, sessionId, campaignId).catch((err) =>
      console.error("[encyclopedia] generateSessionSummary error:", err)
    );

    return res.json({ message: "Session summary generation started. Results will be broadcast via WebSocket." });
  } catch (err) {
    console.error("[encyclopedia] POST /sessions/:sessionId/summarize:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/campaigns/:id/sessions/:sessionId
// DM approves or edits session summary
// ---------------------------------------------------------------------------
router.patch("/:id/sessions/:sessionId", authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { id: campaignId, sessionId } = req.params;
    const userId = req.user!.sub;
    if (!(await isDm(campaignId, userId))) {
      return res.status(403).json({ error: "DM role required" });
    }

    const { ai_summary, dm_notes, summary_approved } = req.body;
    const result = await pool.query(
      `UPDATE public.session_records
       SET ai_summary = COALESCE($1, ai_summary),
           dm_notes = COALESCE($2, dm_notes),
           summary_approved = COALESCE($3, summary_approved)
       WHERE id = $4 AND campaign_id = $5
       RETURNING *`,
      [ai_summary ?? null, dm_notes ?? null, summary_approved ?? null, sessionId, campaignId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Session not found" });
    return res.json({ session: result.rows[0] });
  } catch (err) {
    console.error("[encyclopedia] PATCH /sessions/:sessionId:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
