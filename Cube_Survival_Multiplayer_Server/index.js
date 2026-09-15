import { defineServer, defineRoom } from "colyseus";
import { WorldRoom } from "./WorldRoom.js";

const port = Number(process.env.PORT) || 2567;

const server = defineServer({
  rooms: {
    world: defineRoom(WorldRoom),
  },
  express: (app) => {
    app.get("/", (_req, res) => {
      res.send("Cube Survival multiplayer server is running.");
    });
  },
});

server.listen(port);
console.log(`Cube Survival multiplayer server: http://localhost:${port}`);
console.log(`Game websocket address: ws://localhost:${port}`);
