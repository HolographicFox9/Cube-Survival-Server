CUBE SURVIVAL — FULL RENDER PROJECT — SERVER 483 / GAME 555 / RULES 555

GAME 555 RIDING + COLLISION CLEANUP
- Mounted pets keep their normal walking/body/head/tail animation while moving.
- Mounted pet attack animation now visibly lunges/moves the head instead of looking frozen.
- Riding steering is forward-facing: WASD/arrow input chooses the target heading, while the mount continues moving in its current facing direction as it turns toward that heading.
- While riding, the mounted pet absorbs incoming damage before the rider can be hurt. The hit that defeats the mount is absorbed by the mount; later hits can damage the rider.
- Eating a berry while mounted still heals the rider and now also heals the ridden pet by the same amount.
- Mounted static collision now uses only the pet's physical body hitboxes. The duplicate human collision pass was removed because it could fight the mount correction and snag on trees, rocks, walls, gold, and chests.
- Multiplayer mounted animal collision no longer adds a second human-circle push on top of the mount's own animal collision.
- A hot movement-collision path no longer allocates animals.concat(player.pets) every sub-step, reducing unnecessary garbage-collector work.
- Offline owned-pet attack animation timers now decay correctly instead of being able to stick at a constant attack pose.
- Existing species/stage hitbox tuning remains in place, including the reduced Boar, Wolf, Bear, Dog, Deer, Snake, and Sabertooth profiles from prior builds.

FULL RENDER PROJECT CONTENTS
- public/index.html      Game 555
- WorldRoom.js          Server 483 authoritative multiplayer room
- index.js              Express + Colyseus launcher and /healthz + /status
- package.json          Node dependencies/start command
- render.yaml           Render Blueprint configuration
- .gitignore
- README_RENDER.txt

RENDER DEPLOYMENT
1. Extract this ZIP.
2. Upload the CONTENTS of the extracted folder to the root of your GitHub repository.
3. In Render, create/update the Blueprint or Web Service from that repository.
4. Build command: npm install
5. Start command: npm start
6. Health check path: /healthz
7. Keep one server instance for one shared in-memory world.
8. Open the Render HTTPS URL; it redirects to /index.html?server=self and the game connects back with WebSockets.

BUILD CHECK
/healthz reports serverBuild 483, gameBuild 555, rulesVersion 555.
/status reports the live connected-player count used by the home screen.

NOTE
The active multiplayer world is stored in server memory. A Render restart/redeploy resets that active world. Browser/account progression remains governed by the game's existing save/account behavior.
