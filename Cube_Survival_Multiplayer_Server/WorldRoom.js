// WorldRoom.js
// Starter Colyseus room for Cube Survival.
// This first pass synchronizes players while the existing browser still simulates
// animals/resources. Move those systems server-side later for a fully authoritative world.

import { Room } from "colyseus";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

const WORLD_W = 14400;
const WORLD_H = 14400;

class PlayerState extends Schema {
  constructor() {
    super();
    this.id = "";
    this.username = "Cube";
    this.x = WORLD_W / 2;
    this.y = WORLD_H / 2;
    this.angle = 0;
    this.health = 100;
    this.color = "#3fa7ff";
    this.tool = "Fist";
  }
}

defineTypes(PlayerState, {
  id: "string",
  username: "string",
  x: "number",
  y: "number",
  angle: "number",
  health: "number",
  color: "string",
  tool: "string",
});

class WorldState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.dayPhase = 0;
    this.timeOfDay = 0;
  }
}

defineTypes(WorldState, {
  players: { map: PlayerState },
  dayPhase: "number",
  timeOfDay: "number",
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function safeSpawn() {
  // Basic starter spawn. Replace this with the same obstacle-aware safe-spawn
  // rules from the game once resources/animals are authoritative on the server.
  return {
    x: 300 + Math.random() * (WORLD_W - 600),
    y: 300 + Math.random() * (WORLD_H - 600),
  };
}

export class WorldRoom extends Room {
  maxClients = 12;

  onCreate(options) {
    this.setState(new WorldState());
    this.inputs = new Map();

    this.setSimulationInterval(
      (deltaTime) => this.update(deltaTime),
      1000 / 20
    ); // 20 TPS

    this.onMessage("input", (client, input = {}) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Keep movement input so the server can become fully authoritative later.
      this.inputs.set(client.sessionId, {
        moveX: clamp(Number(input.moveX) || 0, -1, 1),
        moveY: clamp(Number(input.moveY) || 0, -1, 1),
        attacking: !!input.attacking,
      });

      // STARTER SYNC:
      // The current Cube Survival browser owns collisions/resources, so for now the
      // server mirrors the client's resolved position. When world simulation moves
      // server-side, remove x/y from client input and calculate movement here instead.
      if (Number.isFinite(Number(input.x))) {
        player.x = clamp(Number(input.x), 18, WORLD_W - 18);
      }
      if (Number.isFinite(Number(input.y))) {
        player.y = clamp(Number(input.y), 18, WORLD_H - 18);
      }
      if (Number.isFinite(Number(input.angle))) {
        player.angle = Number(input.angle);
      }
      if (Number.isFinite(Number(input.health))) {
        player.health = clamp(Number(input.health), 0, 100);
      }
      if (typeof input.color === "string" && input.color.length <= 32) {
        player.color = input.color;
      }
      if (typeof input.tool === "string" && input.tool.length <= 24) {
        player.tool = input.tool;
      }
    });
  }

  onJoin(client, options = {}) {
    const spawn = safeSpawn();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.username = String(options.username || "Cube").slice(0, 14);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = 0;
    player.health = 100;
    player.color = typeof options.color === "string" ? options.color : "#3fa7ff";
    player.tool = "Fist";
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    this.inputs.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  update(deltaTime) {
    // World clock starter. Animals/resources/enemies can be moved here next.
    const dt = deltaTime / 1000;
    this.state.timeOfDay = (this.state.timeOfDay + dt) % 200;

    const t = this.state.timeOfDay;
    if (t < 72) this.state.dayPhase = 0;       // Day
    else if (t < 90) this.state.dayPhase = 1;  // Dawn
    else if (t < 146) this.state.dayPhase = 2; // Night
    else if (t < 182) this.state.dayPhase = 3; // Midnight
    else this.state.dayPhase = 4;              // Morning
  }
}
