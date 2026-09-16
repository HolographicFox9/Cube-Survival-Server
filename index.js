import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom } from "./WorldRoom.js";

const port = Number(process.env.PORT) || 2567;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");

const app = express();
app.disable("x-powered-by");

// Render health check. This also gives you a quick way to verify the server is awake.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, game: "Cube Survival", multiplayer: true, serverBuild: 408, gameBuild: 436, chat: true });
});

// Visiting the Render URL opens the game and tells the client to use this same server.
app.get("/", (_req, res) => {
  res.redirect("/index.html?server=self");
});
app.use(express.static(publicDir, { index: false, maxAge: "1h" }));

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define("world", WorldRoom);
await gameServer.listen(port);

console.log(`Cube Survival multiplayer listening on port ${port}`);
console.log(`Local game: http://localhost:${port}`);
console.log("On Render, open the service's HTTPS URL. The game auto-connects with WSS.");
