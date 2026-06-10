import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { RACES } from "@dnd/shared";
import { pool } from "./db/client";
import authRouter from "./routes/auth";
import campaignRouter from "./routes/campaigns";
import characterRouter from "./routes/characters";
import nemesisRouter from "./routes/nemeses";
import factionRouter from "./routes/factions";
import encyclopediaRouter from "./routes/encyclopedia";
import balanceRouter from "./routes/balance";
import soloRouter from "./routes/solo";
import { authMiddleware, AuthenticatedRequest } from "./middleware/auth";
import { authenticateSocket, handleWSMessage } from "./websocket/eventHandlers";
import { RoomManager } from "./websocket/roomManager";
import { runBalancingCycle } from "./game/balancingEngine";
import { narrationEmitter } from "./ai/narrationEmitter";
import { startBoss, stopBoss, dmService } from "./ai/dmService";

const app = express();
const port = process.env.PORT || 3001;
let shuttingDown = false;

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);

      const isAllowed =
        origin.startsWith("http://localhost:") ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith(".onrender.com") ||
        /trycloudflare\.com|run\.pinggy-free\.link|ngrok/i.test(origin);

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Pinggy-No-Screen",
      "ngrok-skip-browser-warning",
      "bypass-tunnel-reminder",
    ],
  })
);
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignRouter);
app.use("/api/characters", characterRouter);
app.use("/api/campaigns", nemesisRouter);
app.use("/api/campaigns", factionRouter);
app.use("/api/campaigns", encyclopediaRouter);
app.use("/api/campaigns", balanceRouter);
app.use("/api/solo", soloRouter);

app.get("/api/auth/me", authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ message: "Access granted", user: req.user });
});

app.get("/api/me", authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

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

  const soloModeReady = true;
  const encyclopediaSeeded = dbStatus === "ok";
  const isHealthy = dbStatus === "ok";

  res.status(isHealthy ? 200 : 500).json({
    status: isHealthy ? "healthy" : "unhealthy",
    checks: {
      database: { status: dbStatus, latency_ms: dbLatency },
      groq_api: { status: groqEnabled ? "ok" : "disabled", last_success: lastSuccess },
      queue: { depth: queueDepthValue, max_depth: 100 },
      ws_connections: wsCount,
      solo_mode: {
        available: soloModeReady,
        ai_narration: groqEnabled ? "enabled" : "offline_fallback",
        encyclopedia: encyclopediaSeeded ? "seedable" : "db_required",
      },
      story_mode: {
        available: true,
        ai_narration: groqEnabled ? "enabled" : "offline_fallback",
        dice_engine: "canonical",
        world_expansion: true,
        random_events: true,
      },
    },
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    const dbCheck = await pool.query("SELECT NOW()");
    res.json({
      status: "ok",
      database: "connected",
      time: dbCheck.rows[0].now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({
      status: "error",
      database: "disconnected",
      error: message,
    });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Wire AI narration broadcast. saveNarration() in dmService emits this event
// after every Groq response. Without this listener, narrations save to DB but
// never reach connected clients. The try/catch prevents a send() error on a
// closed socket from bringing down the whole process.
narrationEmitter.on("narration", ({ campaignId, eventLogId, narration }) => {
  try {
    RoomManager.broadcastToRoom(campaignId, "AI_NARRATION", {
      event_id: eventLogId,
      text: narration,
      is_complete: true,
    });
  } catch (err) {
    console.error("[narration] broadcast failed for campaign", campaignId, err);
  }
});

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "", "http://localhost");
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(4001, "Unauthorized: Missing token query parameter");
    return;
  }

  const user = await authenticateSocket(token);
  if (!user) {
    ws.close(4001, "Unauthorized: Invalid or expired token");
    return;
  }

  console.log(`User ${user.username} (${user.userId}) connected via WebSocket`);

  ws.on("message", async (data) => {
    try {
      await handleWSMessage(ws, data.toString(), user);
    } catch (err) {
      console.error("Error handling WebSocket message:", err);
    }
  });

  ws.on("close", () => {
    const participant = RoomManager.removeConnection(ws);
    if (participant) {
      console.log(`User ${participant.username} disconnected from campaign ${participant.campaignId}`);
      RoomManager.broadcastToRoom(participant.campaignId, "PLAYER_LEFT", {
        user_id: participant.userId,
        username: participant.username,
      });
    }
  });
});

async function shutdown(signal: NodeJS.Signals, activeServer: Server, activeWsServer: WebSocketServer) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received. Closing server, WebSocket connections, and database pool.`);

  try {
    await stopBoss();
  } catch (err) {
    console.error("Error stopping pg-boss on shutdown:", err);
  }

  await new Promise<void>((resolve) => {
    activeServer.close(() => resolve());
  });

  await new Promise<void>((resolve) => {
    activeWsServer.close(() => resolve());
  });

  await pool.end();
  console.log("Graceful shutdown complete.");
}

process.on("SIGINT", () => {
  void shutdown("SIGINT", server, wss).finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM", server, wss).finally(() => process.exit(0));
});

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

  console.log(
    `[Solo Mode] ${dmService.isEnabled() ? "AI DM available (Groq)" : "Offline DM mode active (no API key)"}`,
  );
  console.log("[Solo Mode] Encyclopedia will auto-seed on campaign creation");
  console.log("[Solo Mode] Single-player campaigns available at POST /api/solo/start");
  console.log("[Engine] Dice engine: canonical (crypto-quality)");
  console.log(`[Engine] World expansion: ${dmService.isEnabled() ? "AI + fallback" : "fallback only"}`);
  console.log("[Engine] Random events: weather, time, encounters, mood shifts");

  // -------------------------------------------------------------------------
  // Phase I — Automated Balancing Cycle Timer (every 30 minutes)
  // Runs across all active campaigns that have the balancing engine enabled.
  // -------------------------------------------------------------------------
  const BALANCE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  const balancingTimer = setInterval(async () => {
    if (shuttingDown) return;
    try {
      const campaignsRes = await pool.query(
        `SELECT id FROM public.campaigns
         WHERE (world_state->>'balance_engine_paused')::boolean IS NOT TRUE
         AND created_at > now() - interval '30 days'`
      );
      for (const row of campaignsRes.rows) {
        runBalancingCycle(pool, row.id).catch((err) =>
          console.error(`[balancingTimer] cycle failed for campaign ${row.id}:`, err)
        );
      }
    } catch (err) {
      console.error("[balancingTimer] Failed to fetch campaigns:", err);
    }
  }, BALANCE_INTERVAL_MS);

  // Unref so timer doesn't prevent graceful shutdown
  balancingTimer.unref();
});
