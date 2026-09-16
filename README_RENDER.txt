CUBE SURVIVAL — RENDER-READY MULTIPLAYER SERVER 339 / GAME 366

WHAT THIS PACKAGE DOES
- Runs the full Colyseus Cube Survival multiplayer world.
- Hosts the game HTML on the SAME Render service.
- Players only need one normal HTTPS link.
- The game automatically converts that host into its WSS multiplayer address.
- No player has to type the server address.
- The server still works locally with npm install / npm start.

EASIEST RENDER SETUP
1. Make a new GitHub repository.
2. Upload the CONTENTS of this folder to the repository root:
   index.js
   WorldRoom.js
   package.json
   render.yaml
   public/index.html
3. In Render, create a Blueprint from that GitHub repository.
   render.yaml already specifies Node, npm install, npm start, one instance,
   the Free plan, and /healthz for health checks.
4. Wait for the deploy to finish.
5. Render gives you an HTTPS address such as:
   https://your-service-name.onrender.com
6. Open that HTTPS address. It redirects to the included game and the game
   automatically connects back to the same Render service using WSS.
7. Send THAT SAME HTTPS LINK to your friends. They can open it on different
   computers and choose Online.

MANUAL WEB SERVICE SETTINGS (if you do not use render.yaml)
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /healthz
Instances: 1

LOCAL TESTING
1. npm install
2. npm start
3. Open http://localhost:2567 in your browser.
4. Choose Online. The included page automatically uses ws://localhost:2567.

STANDALONE HTML
Cube_Survival359_render_autoconnect.html also remembers any server you type.
You can additionally open it with a server query, for example:
?server=https://your-service-name.onrender.com
The game converts HTTPS to WSS and saves it for later.

IMPORTANT ABOUT THE FREE RENDER PLAN
The current multiplayer world lives in server memory. If the Render instance
restarts, redeploys, or spins down, the active world resets. Player permanent
home/meta progress is still stored by the browser as before. A persistent
server-world save can be added later if you want it.

RENDER / WEBSOCKET NOTE
Public Render WebSockets should use WSS. The included game handles this
automatically when it is opened from the Render-hosted page.


SERVER 333 MULTIPLAYER STABILITY:
- 10 Hz network patches with 20 TPS combat/physics
- far-away idle wildlife sleeps server-side to reduce bandwidth
- starter pet self-repair if initial spawn is missed
- safe player spawn clearance from wildlife, bosses, enemies, pets, players and walls

BUILD 335 / GAME 362 CHANGES
- Bow fires from normal left-click/attack input and online arrows animate between network patches.
- Some hostile cubes spawn with guard pets; those cubes are weaker and their pets defend them.
- Night enemies are distributed across the world as well as near players.
- Hit notifications and combat FX are batched to reduce multiplayer lag in group fights.


Server 337 / Build 364:
- death restarts choose a new safe spawn far from the death location
- multiplayer owned pets relocate with the player on Try Again
- respawn keeps boss/enemy/wall/player clearance checks

SERVER 338 / BUILD 365:
- Sabertooth babies now have the highest baby HP while keeping strong bite damage.
- Owned pets automatically defend their player against the exact wild animal/enemy that hurt them.
- Pet following starts sooner, catches up faster, and client interpolation predicts a tiny amount ahead for smoother online follow.
- Shared multiplayer trees/rocks/logs/bushes remain server-authoritative: one player's harvesting changes the same world node for everyone.
- Trees now take about 8 Axe hits instead of 3; Axes yield more wood per successful hit and remain clearly better than other tools.
- Pickaxe art was rebuilt with a heavier handle, forged steel head, socket and highlights.
- Fast arrows/projectiles use swept collision so animals/resources cannot be skipped between ticks; animal hits deal damage and world solids stop the shot.
- Guard pets maintain separation from hostile cubes instead of sitting inside them.
- Some hostile cubes now ride their guard pet. Rider cubes are much weaker and the mount handles movement/combat.


SERVER 339 / GAME 366:
- public/index.html is now the current Game 366 build.
- Added multiplayer chat support.
- Chat messages are filtered on BOTH the browser and server.
- Profanity is blocked instead of broadcast.
- Links, email addresses, Discord invites, IP-style links, common domains, and simple disguised domains are blocked.
- Server enforces a 120-character message limit and a short anti-spam cooldown.
- Chat uses the player's server-known username rather than trusting a username sent by the browser.
- Chat broadcasts to the other connected players; the sender renders its own message immediately.
