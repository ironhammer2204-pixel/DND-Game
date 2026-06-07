import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { RACES } from "@dnd/shared";

const app = express();
const port = process.env.PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", racesCount: RACES.length });
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");
  ws.on("message", (message) => {
    console.log(`Received message => ${message}`);
  });
  ws.send(JSON.stringify({ type: "SYSTEM", payload: { message: "Welcome to D&D Game Server" } }));
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
