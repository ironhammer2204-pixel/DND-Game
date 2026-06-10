
// ============================================================
// SOLO MODE INTEGRATION (Add to apps/server/src/index.ts)
// ============================================================

// 1. IMPORTS (Add these to existing imports)
import soloRouter from "./routes/solo";
import { 
  initializeSoloCampaign, 
  processSoloAction,
  seedEncyclopediaForSolo 
} from "./game/soloEngine";

// 2. ROUTES (Add after existing routes, before server.listen)
app.use("/api/solo", soloRouter);

// 3. HEALTH CHECK UPDATE (Modify existing /health endpoint)
// Add to the health check response:
app.get("/health", async (_req, res) => {
  const dbStart = Date.now();
  let dbStatus = "ok";
  let dbLatency = 0;
  try {
    await pool.query("SELECT 1");
    dbLatency = Date.now() - dbStart;
  } catch (err) {
    dbStatus = "error";
  }

  const groqEnabled = dmService.isEnabled();
  const queueDepthValue = groqEnabled ? await dmService.queueDepth() : 0;
  const wsCount = RoomManager.getConnectionCount();
  const lastSuccess = dmService.getLastSuccess();

  // NEW: Check solo mode capability
  const soloModeReady = true; // Solo engine is always available (offline mode)
  const encyclopediaSeeded = dbStatus === "ok"; // Can seed if DB is up

  const isHealthy = dbStatus === "ok";

  res.status(isHealthy ? 200 : 500).json({
    status: isHealthy ? "healthy" : "unhealthy",
    checks: {
      database: { status: dbStatus, latency_ms: dbLatency },
      groq_api: { status: groqEnabled ? "ok" : "disabled", last_success: lastSuccess },
      queue: { depth: queueDepthValue, max_depth: 100 },
      ws_connections: wsCount,
      // NEW: Solo mode status
      solo_mode: { 
        available: soloModeReady, 
        ai_narration: groqEnabled ? "enabled" : "offline_fallback",
        encyclopedia: encyclopediaSeeded ? "seedable" : "db_required"
      }
    },
  });
});

// 4. STARTUP SEQUENCE (Add inside server.listen callback, after startBoss)
// Solo mode auto-initialization check
server.listen(port, async () => {
  console.log(`Server is running on port ${port}`);

  try {
    const dbCheck = await pool.query("SELECT NOW()");
    console.log(`Successfully connected to the database. Server time: ${dbCheck.rows[0].now}`);
  } catch (err) {
    console.error("Failed to connect to the database on startup:", err);
  }

  try {
    await startBoss();
  } catch (err) {
    console.error("Failed to start pg-boss on startup:", err);
  }

  // NEW: Log solo mode status
  console.log(`[Solo Mode] ${dmService.isEnabled() ? "AI DM available (Groq)" : "Offline DM mode active (no API key)"}`);
  console.log(`[Solo Mode] Encyclopedia will auto-seed on campaign creation`);
  console.log(`[Solo Mode] Single-player campaigns available at POST /api/solo/start`);

  // ... rest of existing timer setup ...
});
