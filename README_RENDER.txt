CUBE SURVIVAL — FULL RENDER PROJECT — SERVER 482 / GAME 554 / RULES 554

CURRENT GAME 554 FAMILY CHANGES
- Bred pets remain hidden from pet cards by default.
- A bred pet that becomes an older-sibling leader now gets a visible pet card while it is caring for younger family babies.
- Older-sibling cards have an "Older Sibling" label and can be controlled normally.
- Younger bred babies remain hidden from the pet-card list.
- When wild animals or owned pets successfully make a baby, a large bubbly red heart grows above the birth spot, pulses, pops, and bursts into pink/gold/white stardust.
- Nearby players hear a soft happy soothing birth chime when the heart effect happens.
- Multiplayer broadcasts the same birth celebration to all clients so everyone sees the shared effect.
- Existing orphan-family rules remain: if a lone orphan is the only pet left it becomes a normal card pet; otherwise older siblings care for younger babies and their ability/target copying still works.

FULL RENDER PROJECT CONTENTS
- public/index.html      Game 554
- WorldRoom.js          Server 482 authoritative multiplayer room
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
/healthz reports serverBuild 482, gameBuild 554, rulesVersion 554.
/status reports the live connected-player count used by the home screen.

NOTE
The active multiplayer world is stored in server memory. A Render restart/redeploy resets that active world. Browser/account progression remains governed by the game's existing save/account behavior.
