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
import { authMiddleware, AuthenticatedRequest } from "./middleware/auth";
import { authenticateSocket, handleWSMessage } from "./websocket/eventHandlers";
import { RoomManager } from "./websocket/roomManager";

const app = express();
const port = process.env.PORT || 3001;
let shuttingDown = false;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignRouter);
app.use("/api/characters", characterRouter);
app.use("/api/campaigns", nemesisRouter);

app.get("/api/auth/me", authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ message: "Access granted", user: req.user });
});

app.get("/api/me", authMiddleware, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "dnd-game-server",
    racesCount: RACES.length,
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
});
