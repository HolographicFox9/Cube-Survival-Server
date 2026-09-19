CUBE SURVIVAL — FULL RENDER PROJECT — SERVER 483 / GAME 555 / RULES 555

CURRENT GAME 555 PERFORMANCE / RIDING / COLLISION PASS

Gameplay fixes:
- Ridden pets keep their normal movement animation, tail/body motion, and attack/head animation.
- Mounted movement steers toward the pressed arrow/joystick direction while actual travel stays along the animal's current facing direction during the turn.
- While mounted, incoming damage is absorbed by the mount first. The same hit does not spill into the rider if the mount is defeated.
- Eating a berry while mounted heals the ridden pet instead of the rider.
- Pet cards now show Species + Stage + Gender, while world labels keep stage/gender for pets and wildlife.
- Wildlife uses species abilities more deliberately while fighting. Wild babies never cast powers; tamed baby pets remain allowed to use pet powers.
- Animals that become physically stuck on trees/rocks/logs/bushes remember the blocker, bite it with real head attack animation, and continue until it breaks or stops blocking their path.

Collision / bug fixes:
- Riding uses one consistent animal body instead of resolving both mount collision and a second player-circle collision.
- Mounted animal hitboxes use the real multi-circle body with a small 8% movement-only forgiveness trim to reduce snagging.
- Mounted creature contact is a smooth two-way slide rather than treating the mount as an immovable anchor.
- Client and server mounted separation math now match to reduce multiplayer correction jitter.
- Fixed log collision normals so a head/shoulder contact pushes from the exact contacting body circle instead of snapping from the animal center.
- Hostl-vs-animal collision now uses tuned physical movement geometry rather than full combat/snout geometry.
- Existing tight Boar, Wolf, Bear, Dog, Viper, Deer, and Sabertooth collision tuning remains intact; bite/damage reach was not enlarged.

Performance cleanup:
- Removed several per-tick concat/filter/Array.from allocations in hot collision, rendering, wildlife cleanup, projectile, wall, pet-death, and resource-respawn paths.
- Added a cheap broad-phase distance test before Hostls do exact multi-circle animal collision checks.
- Idle mounts no longer rescan every creature at 60 Hz; the world separation pass handles creatures moving into a stationary mount.
- Distant wildlife throttling and spatial collision buckets remain active.

FILES
- public/index.html      Game 555
- WorldRoom.js          Server 483 authoritative multiplayer room
- index.js              Express + Colyseus launcher and /healthz + /status
- package.json          Node dependencies/start command
- render.yaml           Render service configuration
- .gitignore            Git ignore rules
- README_RENDER.txt     This file

RENDER DEPLOYMENT
1. Put every file/folder from this project at the root of your GitHub repository.
2. Connect that repository to Render as a Web Service.
3. Render can use render.yaml, or set Build Command to: npm install
4. Start Command: npm start
5. Health check path: /healthz
6. Open the Render HTTPS service URL after deployment. It redirects to /index.html?server=self so the included game connects to the same server over WSS.

BUILD CHECK
/healthz reports serverBuild 483, gameBuild 555, rulesVersion 555.
/status reports the live connected-player count used by the home screen.
