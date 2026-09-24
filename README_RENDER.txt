HOSTL — FULL RENDER PROJECT — SERVER 585 / GAME 657 / RULES 609

This package contains the browser game and authoritative multiplayer/account server for HOSTL.

BUILD CONTENTS
- public/index.html      Game 655 browser client
- WorldRoom.js          Server 583 Colyseus multiplayer room
- index.js              Express + account/economy/auth API + Colyseus launcher
- package.json          Node start/dependency configuration
- render.yaml           Free/test Render web-service configuration
- render-persistent-example.yaml  Optional paid persistent-disk Blueprint example
- PERSISTENT_ACCOUNT_STORAGE.txt
- REWARDED_AD_SETUP.txt

SERVER 570 / GAME 642 STARTER STAGE FIX
- Player Skill XP is now always visible directly above the hotbar instead of living in the crafting menu.
- The Skill bar fills left-to-right with a lighter fill and reacts immediately whenever validated XP is earned.
- Skill can grow from combat hits and kills, resource/chest hits, taming, successful breeding, chest completion,
  and other validated survival actions. Multiplayer XP is authoritative on the server.
- Skill has no five-level cap. At Skill 10, 20, 30, 40, and every 10 levels after that, choose one stackable
  run boost: +8% movement speed, +8% survivor melee/bow damage, or 8% less incoming damage.
- Existing crafting upgrades now unlock from the visible Skill level instead of using a second hidden crafting XP track.
- Multiplayer movement, damage, and defense validation use the same Skill boost ranks as the browser client.
- Trees, rocks, logs, bushes, gold, walls, towers, chests, the player, Hostls, the gameplay HUD, and gameplay menus
  now use stronger near-black ink outlines, flatter colors, and simple cel-shaded highlights to match the pet art language.

SERVER 568 / GAME 640 SECURITY + PRODUCTION FIX PASS
- Permanent account economy is no longer writable through the generic profile-save route.
- Gold Cubits, species cards, pet unlocks, permanent pet stages, pet stat upgrades, starter purchases,
  achievements, and rewarded-ad rewards now use server-validated mutations.
- Logged-in multiplayer ignores client-claimed permanent pet stat upgrades and pet starting stages.
  The server loads the verified account entitlements instead.
- Starter pets are verified server-side before spawning for logged-in players.
- Owned/account pet stages are capped at Super Boss. Old Big Momma account starter-stage data is
  normalized down to Super Boss; Big Momma remains a wild-animal stage.
- Online achievement rewards are recorded by the authoritative world server before permanent
  account currency/cards are granted. Offline signed-in play cannot mint permanent account rewards.
- Survive-the-night credit requires the player to actually be alive during Night or Midnight.
- Rewarded theme and daily-chest grants require a replay-protected server-signed ad completion proof.
  If the rewarded-ad integration is not configured, those reward buttons stay unavailable instead
  of handing out unverified rewards.
- Forest Chest display price and server price now both use 600 Gold Cubits.
- The account snapshot from the server replaces logged-in permanent progression in the browser;
  edited localStorage values are not merged upward into the account.
- Four named worlds remain available in the world selector and retain deterministic world seeds.
- Health/config endpoints report rewarded-ad and persistent-storage configuration status.

IMPORTANT EXTERNAL SETUP
Two production dependencies cannot be created by game code itself:
1. Durable Render storage: the included render.yaml stays on Render Free for testing. Render Free
   web services cannot attach persistent disks. For production, upgrade the web service and mount a
   persistent disk (see render-persistent-example.yaml), or use another durable database/storage service.
   Set HOSTL_DATA_DIR to the mounted directory. See PERSISTENT_ACCOUNT_STORAGE.txt.
2. Rewarded ads: connect an ad provider/backend and return a server-signed completion proof only after
   a completed ad. See REWARDED_AD_SETUP.txt. Until then, rewarded-ad grants intentionally stay locked.

RENDER DEPLOYMENT
1. Put the project files at the root of your GitHub repository.
2. Connect the repository to Render as a Web Service / Blueprint.
3. Build command: npm install
4. Start command: npm start
5. Health check path: /healthz
6. Keep HOSTL_SESSION_SECRET private and stable. render.yaml generates one for a Blueprint deployment.
7. For durable accounts, mount persistent storage and set HOSTL_DATA_DIR as described in
   PERSISTENT_ACCOUNT_STORAGE.txt.
8. Open the Render HTTPS service URL. The root redirects to /index.html?server=self and the game
   connects back to that service over secure WebSocket.

BUILD CHECK
/healthz should report:
- serverBuild: 575
- gameBuild: 645
- rulesVersion: 600
- rewardedAdsConfigured: true/false
- accountStoragePersistent: true/false

/status reports the live connected-player count used by the home screen.


STARTER PET STAGE FIX (570/642)
- The configured permanent starter stage is now authoritative on offline spawn, multiplayer join, and starter repair.
- Existing lower-stage starter pets are promoted to the configured stage instead of blocking repair.
- Legacy Viper progression stored under `viper` is migrated to the internal `snake` key.
- Authenticated multiplayer uses the verified account starter selection and effective stage.


SERVER 572 / GAME 644 — SHOP POPUP + HOME CLEANUP PASS
- Home screen now uses the same thick-ink, flat/cel-shaded UI language as the in-game pet/world art while preserving selectable theme palettes.
- Home/menu buttons use stable Theme-card-style hover/focus feedback.
- Rotating material stock uses much smaller tall cards so more items fit at once.
- Clicking a material selects it and opens a full detail/purchase panel instead of putting a large Buy button on every card.
- Purchased items use a short glowing-circle reward reveal with temporary placeholder item art.
- Material purchasing immediately shows a Purchasing state and avoids one redundant UI rebuild.
- Account JSON writes are compact rather than pretty-printed, reducing disk work on purchase/progression saves.


SERVER 575 / GAME 647 — ALL-BUTTON STABILITY + RELIABLE VECTOR PURCHASE ITEM REVEAL
- Shop controls use fixed hit geometry with no brightness-filter or press movement.
- Child art/text cannot steal pointer targeting from a shop control.
- Purchase reveal lasts 4 seconds.
- Reveal has no dark/fullscreen background, panel, labels, or text: glow circle + purchased item art only.
- Material description still closes for the reveal and returns after the four-second reveal finishes.

GAME 657 art packaging: Clouded Leopard awake/sleep stage SVGs are embedded directly in public/index.html as data URIs. No external animal image files are required by the browser build.

GAME 657 loading fix: initial world placement now updates/queries the spatial collision grid as resources are created, avoiding full-array placement scans during boot. The loading overlay also has an early recovery watchdog.
