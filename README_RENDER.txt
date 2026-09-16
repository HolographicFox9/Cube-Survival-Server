CUBE SURVIVAL — RENDER-READY MULTIPLAYER SERVER 386 / GAME 413

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


SERVER 340 / GAME 367 CHAT INPUT FIX:
- Fixed Enter inside the chat input.
- The input now handles Enter directly and sends the message.
- Escape closes chat directly from the input.
- This fixes the event-propagation bug that previously swallowed Enter before sendChatMessage() ran.


SERVER 341 / GAME 368 SAFER CHAT:
- Blocks social-platform names and common spaced/leetspeak variants in public chat.
- Blocks the word "username" and "user name" in chat while keeping player display names visible.
- Blocks @handles, emails, phone-number patterns, IP-style addresses, domains, invite links, and disguised "dot com" forms.
- Blocks common attempts to move a player into private/off-platform chat (for example asking for handles or private messages).
- Adds Unicode/invisible-character normalization, common lookalike-character folding, repeated-letter collapse, and compact matching.
- Adds the requested workaround terms: ahh, fuh, fah, greened, dih, puh.
- The same checks run on the authoritative Colyseus server so a modified browser client cannot bypass them.


SERVER 342 / GAME 369 EXPANDED CHAT SAFETY:
- Added a dedicated sexual/adult-content category, including pornographic-site names,
  sexual solicitation language, explicit-image requests, and adult-service references.
- Added grooming/sextortion risk phrases such as secrecy requests, camera/photo requests,
  private meet-up language, payment-for-images language, and message-deletion requests.
- Added fuzzy edit-distance matching for longer high-risk terms to catch common misspellings.
- Expanded leetspeak, inserted-separator, repeated-letter, Unicode-lookalike, and invisible-character handling.
- Added written-out email/domain and phone-number evasions, including number words.
- Expanded off-platform/social/app names while keeping player display names visible.
- The authoritative server applies the same filter as the browser client.


SERVER 343 / GAME 370 BRAINROT FILTER:
- Added a dedicated brainrot/meme-slang chat category.
- Blocks canonical terms such as skibidi, rizz, gyatt, sigma, Fanum Tax, Ohio, aura, mewing,
  looksmaxxing, 67/six-seven, huzz, chopped, tuff, unc, crash out, delulu, NPC, and touch grass.
- Also blocks common meme phrases/variants including rizzler, sigma boy, goofy ahh,
  Ohio final boss, aura farming, low taper fade, mogging, glazing, cooked, and related variants.
- Existing normalization and fuzzy matching apply to this category too.
- Player display names remain visible; this change applies to chat filtering.


SERVER 344 / GAME 371 BRAINROT FILTER REFINEMENT:
- Unblocked harmless/common terms including cooked, NPC, unc, tuff, mid, based, sus, cap, bet, slay, chad, alpha male, beta male, and similar general slang.
- Removed standalone "Ohio", "sigma", "aura", "mew", "speed", "glaze", "goon", and other normal/common words.
- Kept more specific meme phrases and distinctive brainrot terms blocked.
- All other profanity, sexual-content, grooming, link/contact, and off-platform protections remain unchanged.


SERVER 345 / GAME 372 BRAINROT FILTER ADJUSTMENT:
- Re-blocked: goon, sigma, beta male, alpha male.
- Other harmless/common terms previously unlocked remain allowed.
- All profanity, sexual-content, grooming, contact-sharing, links, social-site, and evasion protections remain unchanged.


SERVER 346 / GAME 373 MULTIPLAYER LEADERBOARD:
- Added a top-left player leaderboard showing every connected player's username.
- Ranking priority is kills first, then Gold as the tiebreaker.
- Added server-authoritative PlayerState kills and gold fields.
- Creature/enemy kills increment the owning player's shared kill count.
- Gold mined from world deposits and Gold awarded from kill drops updates the shared Gold count.
- Offline play shows the local player in the same panel.


SERVER 347 / GAME 374:
- Chat history now clears locally whenever that player starts a new run or presses Try Again.
- Imported the user's Animales.sprite3 vector costume pack.
- Dog, Cat, Bearded Dragon, Fox, Wolf, and Bear use the uploaded Baby, Adult, Boss,
  Super Boss, and Big Momma stage artwork.
- Sleeping variants are selected from costume names containing Sleep or the alternate
  numbered stage costumes (2/3) from the uploaded pack.
- SVG source art is rendered with high-quality smoothing and aspect-ratio preservation.
- Physical display size is controlled by the game's animal radius plus species-specific
  visual scaling, rather than trusting the source image canvas dimensions.
- Bearded Dragon Big Momma has no separate sleeping costume in the uploaded pack, so
  its awake Big Momma art is used as the clean fallback while sleeping.
- The uploaded Clouded Leopard costumes are intentionally not assigned to another animal:
  the current game has no Clouded Leopard species.


SERVER 348 / GAME 375:
- Added the dedicated Bearded Dragon Big Momma awake SVG supplied by the user.
- Added the dedicated Bearded Dragon Big Momma sleeping SVG supplied by the user.
- Big Momma Bearded Dragon now switches to the correct awake/sleep art.
- Existing smooth SVG rendering, aspect-ratio preservation, and in-game size scaling remain enabled.


SERVER 349 / GAME 376:
- Added animated head and tail motion to uploaded animal SVG skins while animals move.
- Tail animation speed is driven by the animal's actual movement speed: faster travel = faster tail movement.
- Head movement is smaller and calmer than tail movement, with a subtle speed-based bob.
- Sleeping animals keep their uploaded sleeping pose still.
- The torso remains visually anchored while the left tail region and right head region animate separately.
- SVG/high-quality smoothing remains enabled, so the animation does not pixelate the animal art.


SERVER 350 / GAME 377:
- Greatly increased the on-screen size of uploaded animal skins.
- Babies are now bigger than the player.
- Adults are much larger.
- Bosses are larger still.
- Super Bosses are very very large.
- Big Mommas are extremely large.
- Applied both stage-based and species-based visual scaling so the art fills the role better.


SERVER 351 / GAME 378:
- Reworked uploaded-animal animation into explicit visual layers.
- Tail is copied from the source SVG and rendered as a separate layer UNDER the torso.
- Torso renders over the tail base so the seam stays hidden.
- Head is copied from the same SVG and rendered as a separate layer ABOVE the torso.
- Head motion is noticeably stronger than before, with larger rotation and bob while moving.
- Tail speed still scales with the animal's actual movement speed.
- Sleeping animals remain still.


SERVER 352 / GAME 379:
- Rebalanced animal skin sizes so large stages remain imposing without extreme double scaling.
- Babies remain larger than the player; Adult, Boss, Super Boss, and Big Momma still increase strongly.
- Animal physical hitboxes now grow more aggressively by stage.
- Wild animal spawn clearance uses the actual type/stage footprint instead of a fixed small radius.
- Wild animals will skip a spawn rather than being forced inside a tree, rock, gold node, chest, or another animal.
- Client animal/resource collision now uses the animal's multi-circle physical body hitbox.
- Moved Character Design beside the username field and renamed it exactly "Character Design".


SERVER 353 / GAME 380:
- Baby uploaded-skin animals remain visually bigger than the player.
- Replaced crude stage-multiplier collision for uploaded pets with hitboxes derived from their actual rendered SVG dimensions.
- Dog, Cat, Bearded Dragon, Fox, Wolf, and Bear now have collision shapes tuned to their visible length and body thickness.
- Long Bearded Dragons get longer/narrower collision coverage; Bears get stockier/wider coverage.
- Body/head/tail circles scale automatically with each pet's visible stage size.
- Spawn clearance uses the same visible dimensions, keeping large pets out of trees/resources correctly.


SERVER 354 / GAME 381:
- Added the new Rabbit SVG skin set for Baby, Adult, Boss, Super Boss, and Big Momma.
- Rabbit now swaps between the uploaded awake/sleep art by stage.
- Added Rabbit to the uploaded-SVG visual sizing and proportional hitbox system.
- Rabbit balance tuned to the requested role: fast movement, weaker hits, faster attack speed than most species.


SERVER 355 / GAME 382:
- Fixed Rabbit awake/sleep mapping.
- Swapped the Rabbit awake and sleep art assignments for Baby, Adult, Boss, Super Boss, and Big Momma.


SERVER 356 / GAME 383:
- Increased front-facing animal hitbox coverage.
- Head collision now extends farther into the face and slightly past the eyes.
- Reduced the amount the player can clip into an animal's head before collision stops movement.
- Applied to both uploaded-SVG animals and the regular non-uploaded animals.


SERVER 357 / GAME 384:
- Reworked animal hitboxes to use a proportional fit model.
- Hitbox length, body width, and head coverage now scale by both stage and species.
- Larger stages get proportionately larger physical coverage instead of a one-size-fits-all front extension.
- Spawn footprint now uses the same proportional fit model so placement matches collision better.


SERVER 358 / GAME 385:
- Pulled Adult animal head/nose collision back so players can reach the visible nose.
- Added a real animal weight stat based on stage, species, and visible size.
- Big Momma/Super Boss/Boss animals resist player pushing strongly.
- Babies and lighter species such as Rabbit/Cat are easier to push.
- Player-to-animal collision movement now uses smoothed, bounded push velocity.
- Animal-to-animal separation distributes movement by inverse weight so heavier animals move less.


SERVER 359 / GAME 386:
- When a hostile cube rider or hostile pet owner dies from morning/daylight, its linked animal is no longer deleted.
- The former mount/guard is detached from the hostile cube and converted into normal wildlife.
- Morning-released animals lose forced hostility, aggro, combat state, and tame-failure aggression.
- Combat-caused hostile-cube deaths keep the existing retaliation behavior in offline play.


SERVER 360 / GAME 387:
- Added killer-follow death camera.
- On death, the camera follows the creature/player/enemy that killed you.
- If the watched killer is later killed, the camera transfers to that killer's killer.
- The chain can continue repeatedly until the player respawns/restarts.
- Multiplayer server broadcasts spectateKill transitions so dead clients can transfer camera targets.


SERVER 361 / GAME 388:
- Dead remote players are hidden instead of leaving a visible character sitting in the world.
- Remote multiplayer players now use the full rounded-cube character rendering with complete eyes and eye highlights.
- Remote players use synchronized moving/dead/max-health/tool/riding state for rendering.
- Remote pets and wildlife feed network movement speed into the animal visual animation system so movement/head/tail animation is no longer stiff online.
- Player arms now move up/down separately while walking, including remote multiplayer players.
- Two-hand weapon users get alternating shoulder movement while hands remain attached to the weapon.


SERVER 362 / GAME 389:
- Pet leveling XP is now shown in a clearer foreground XP bar.
- XP displays Level plus current XP / XP needed.
- XP bars render after trees/resources/creatures/effects so world objects cannot cover them.
- Removed the tiny duplicated Lv text from the normal pet world label.
- Big Momma pets do not show an XP bar because they do not level further.


SERVER 363 / GAME 390:
- Moved the owned-pet XP bar higher above the pet.
- XP text/bar no longer crowds the pet name and health-bar area.


SERVER 364 / GAME 391:
- Card Upgrade now opens a dedicated page for each pet species.
- Species cards can permanently upgrade Health, Defense, Attack, Weight, Regen, and Speed.
- Each stat has 10 levels with increasing card costs.
- Health raises maximum HP; Defense reduces damage taken; Attack raises pet melee damage.
- Weight makes pets harder to push; Regen increases passive recovery; Speed increases pet movement.
- Existing Starting Stage card upgrades remain available on each pet's page.
- Upgrades persist and are applied in both offline and multiplayer gameplay.


SERVER 365 / GAME 392:
- Renamed Owl to Horned Owl.
- Added the complete Horned Owl SVG set for Baby, Adult, Boss, Super Boss, and Big Momma.
- Filename rule is used exactly: files containing 'sleep' are sleeping variants; files without 'sleep' are awake variants.
- Horned Owl is included in uploaded-SVG sizing and proportional collision.


SERVER 366 / GAME 393:
- Increased Horned Owl visual size substantially.
- Fixed sleeping Horned Owl appearing larger than awake.
- Horned Owl now uses width-normalized rendering because awake and sleep SVG source heights differ heavily.
- Awake and sleeping Horned Owls keep the same overall width at each stage.
- Updated proportional Horned Owl collision/footprint to match the new larger visible size.


SERVER 367 / GAME 394:
- Fixed a major permanent-freeze failure mode: the next animation frame is scheduled before update/draw work, so a single runtime error cannot stop the game loop forever.
- Added frame-level recovery that clears disposable malformed effects instead of killing the game loop.
- Replaced offline all-vs-all animal collision separation with a nearby spatial-grid check.
- Added hard limits for particles, floaters, ability effects, projectiles, and pet blasts.
- Removes invalid NaN-position runtime objects before collision/drawing.
- Reduced unnecessary DOM HUD work from every frame to about 12 times per second.
- Reduced maximum simulation catch-up per frame after tab/device stalls.


SERVER 368 / GAME 395:
- Animals and pets now physically block each other using their real multi-circle body hitboxes.
- Creature collision uses weight: lighter animals move more, heavier animals resist displacement.
- Spatial buckets preserve the freeze/performance improvements while doing exact body collision.
- Post-collision creatures are resolved against world solids so separation does not shove them through trees/rocks.
- Death screen background is transparent so the world remains visible.
- The world keeps simulating after player death, so the killer-follow camera remains live behind Try Again/Home.


SERVER 369 / GAME 396:
- Replaced only the Horned Owl Big Momma sleeping SVG with the corrected uploaded file.
- Awake Big Momma and all other Horned Owl stage/pose skins are unchanged.


SERVER 370 / GAME 397:
- Renamed Snake to Viper in the game UI.
- Changed the snake/viper render to head + tail only (no separate torso body block).
- Added movement-only slither motion to the viper tail.
- Added matching movement-only head motion so the head moves with the slither.
- Other species are unchanged.


SERVER 371 / GAME 398:
- Added complete uploaded Viper skin set: Baby, Adult, Boss, Super Boss, and Big Momma.
- Files containing 'sleep' are used for sleeping poses; non-sleep files are awake poses.
- Awake Viper uses a continuous segmented SVG render with one broad traveling S-curve.
- Slither motion eases in/out from actual movement speed instead of snapping on/off.
- Reduced slither frequency and head amplitude so movement reads as a snake glide, not a worm wiggle.
- Sleeping Viper uses the uploaded curled sleep art and stays visually still.
- Updated Viper proportional dimensions and authoritative multiplayer hitboxes to match the uploaded art.


SERVER 372 / GAME 399:
- Greatly increased awake Viper slither amplitude so the S-curve is clearly visible.
- Kept the wave broad and smooth instead of adding more short worm-like bends.
- Split the front ~22% of the Viper artwork into a separate visual head section.
- Viper head now has its own independent side wobble, rotation, and slight bob while moving.
- Head wobble follows the neck smoothly but is not locked to the body's exact wave.
- Sleeping Vipers remain still.


SERVER 373 / GAME 400:
- Reduced Viper slither width so faster movement does not make the snake bend excessively wide.
- Viper movement speed now primarily controls slither frequency/travel speed.
- Slither keeps a controlled maximum amplitude at normal and high speeds.
- Reduced secondary body harmonic for a cleaner snake-like S-curve.
- Separate Viper head now visibly turns left/right with a stronger steering rotation.
- Head turn angle stays controlled; speed changes how fast it turns, not how far.


SERVER 374 / GAME 401:
- Moved the Viper head split farther forward in the source artwork.
- Body/tail layer now stops before the head so it no longer contains a piece of the head.
- Reduced source overlap/bleed at the head boundary for a cleaner separate-head animation.


SERVER 375 / GAME 402:
- Corrected the Viper head split direction.
- Moved the split BACK toward the tail so the head layer owns more of the front section.
- The body/tail layer no longer keeps the stray piece of head artwork.
- Increased head segment coverage and slightly adjusted the head join/pivot for a cleaner transition.


SERVER 376 / GAME 403:
- Viper head now locks directly to the current neck-wave position every frame.
- Removed most independent positional head wobble that made the head visually lag behind fast body movement.
- Head keeps its independent left/right steering rotation.
- Added neck-slope following so the head angle tracks the current slither direction.
- Increased body/head overlap at the split to prevent visible gaps during faster slither.


SERVER 377 / GAME 404:
- Added the uploaded separated Baby Deer artwork as three independent rendered parts.
- Tail, middle/body, and head/front remain separate source pieces.
- Normal pose reassembles them using exact measured offsets from the supplied assembled Deer baby.svg.
- Tail stays in place; body shifts left 15 source units; head/front shifts left 42 source units.
- Pixel reconstruction test matched the assembled reference essentially exactly.
- Only awake Baby Deer uses this test renderer; sleeping Baby Deer remains on the existing renderer until sleeping art is supplied.


SERVER 378 / GAME 405:
- Added the uploaded separated Baby Deer sleep artwork as three independent rendered parts.
- Sleeping Baby Deer is reassembled from tail, middle/body, and head/front pieces.
- Reconstruction uses the same connection logic as the awake baby deer.
- Measured sleep-piece reconstruction:
  tail stays in place; body shifts left 15 source units; head shifts left 42 source units.
- Awake Baby Deer three-part reconstruction remains enabled.


SERVER 379 / GAME 406:
- Added reassembled Deer skins for all remaining Deer stages beyond Baby.
- Adult, Boss, Super Boss, and Big Momma Deer now use uploaded split-part SVG art.
- Each Deer stage is rendered by reconnecting the separated parts back into a single body in-game.
- 3-part Deer skins use the same reconnection logic as Baby Deer:
  tail stays, middle/body shifts left 15 source units, head/front shifts left 42 source units.
- One uploaded Deer awake stage was already body-connected and only needed the front/head shifted left 42.
- Baby Deer awake/sleep three-part reconstruction remains enabled.


SERVER 380 / GAME 407:
- Fixed Deer layering so antlers/horns no longer act like the front overlap piece.
- Deer front section is now split into two draw layers:
  upper antlers/horns first, then torso/body, then the lower tan head/front on top.
- This makes the actual head connect onto the torso while the antlers stay behind it.


SERVER 381 / GAME 408:
- Switched Deer assembly workflow to use user-supplied finished full-body SVG references as the exact normal pose.
- Adult awake/sleep, Boss awake, Super Boss awake/sleep, and Big Momma awake/sleep now render from their finished reference SVGs.
- This guarantees the tan head, antlers, torso and tail match the supplied assembled artwork exactly.
- Split-part Deer sources remain embedded for future independent-part animation work.
- Boss sleep keeps the previous split-part reconstruction because no new finished Boss-sleep reference was supplied in this upload set.
- Baby awake/sleep remain on the existing successful three-part reconstruction workflow.


SERVER 382 / GAME 409:
- Added the uploaded Dog split-part SVG set and mapped it by stage/state:
  baby awake/sleep, adult awake/sleep, boss awake/sleep, superboss awake/sleep, bigmomma awake.
- Switched Dog rendering to use the already-approved in-game Dog artwork as the visible full-body reference.
- Awake and sleeping Dog forms now use the same physical size scale, so sleep art will not render bigger or smaller.
- The uploaded Dog split parts stay embedded for future independent-part assembly/animation work.
- Bigmomma sleep split source was not included in this upload set, so that stage keeps using the existing in-game full-body reference.


SERVER 383 / GAME 410:
- Added the uploaded Cat split-part SVG set and mapped it by stage/state.
- Added the uploaded Bearded Dragon split-part SVG set and mapped it by stage/state.
- Cat now uses the already-used in-game Cat artwork as the visible full-body reference result.
- Bearded Dragon now uses the already-used in-game Dragon artwork as the visible full-body reference result.
- Awake and sleep Cat/Dragon forms are kept on the same physical stage scale.
- The uploaded split-part sets stay embedded for future independent-part assembly work.
- No fifth Bearded Dragon split pair was included in this upload set, so Big Momma Dragon keeps using the existing in-game full-body art.


SERVER 384 / GAME 411:
- Added the uploaded Wolf split-part SVG set and mapped it by stage/state.
- Added the uploaded Fox split-part SVG set and mapped it by stage/state.
- Wolf now uses the already-used in-game Wolf artwork as the visible full-body reference result.
- Fox now uses the already-used in-game Fox artwork as the visible full-body reference result.
- Awake and sleep Wolf/Fox forms are kept on the same physical stage scale.
- The uploaded split-part sets stay embedded for future independent-part assembly work.


SERVER 386 / GAME 413:
- BUGFIX: rebuilt from stable Game 411 after Game 412 accidentally removed a large
  section of uploaded-animal/world rendering code during a function replacement.
- Verified UPLOADED_ANIMAL_SKIN_SOURCES, UPLOADED_ANIMAL_SKINS,
  drawUploadedViperSkin, and drawUploadedAnimalSkin are all still present.
- Re-applied cute head/tail motion with brace-safe function replacement only.
- Dog, Cat, Bearded Dragon, Fox, and Wolf get gentle head wobble + tail motion.
- Fixed inherited multiplayer death-camera lookup: net.remotePlayers -> net.remoteVisuals.


SERVER 387 / GAME 415:
- Adult animal hitboxes tightened across all species.
- Deer collision remains slimmer and better matched to the visible body.
- Baby deer awake/sleep now animate head and tail separately.
- Older deer stages have stronger visible head/tail movement.


SERVER 388 / GAME 416:
- Adult deer head split moved farther back so the antlers stay attached to the moving head.
- Adult deer antlers now rotate with the head instead of staying stuck on the body.


SERVER 389 / GAME 417:
- Any animal with horns or antlers now keeps those parts attached to the moving head.
- Deer non-baby stages split farther back so antlers move with the head.
- Horned owl head split also pulls the horn tufts into the moving head piece.


SERVER 390 / GAME 418:
- Deer non-baby stages now cut the moving head farther back so antlers/horns travel with the head.
- Deer tail, head, and antler motion stay linked through the same segmented deer rendering path.
- The lighter tan antlers are no longer left behind on the torso layer.


SERVER 391 / GAME 419:
- Deer now uses the separated source pieces as the main renderer for every non-baby stage.
- Already-assembled deer art is now reference only, not the primary visible renderer.
- Tail, head, and antlers/horns animate from the separated-piece deer path.


SERVER 392 / GAME 420:
- Deer separated-part head alignment pulled closer to the torso to better match the provided reference.
- Head pivot moved closer to the neck, reducing the detached look while keeping head/antler motion.


SERVER 393 / GAME 421:
- Rechecked all supplied assembled Deer references against the separated source pieces.
- Corrected deer stage mapping: previous split buckets were assigned to the wrong stages.
- Adult, Boss, Super Boss, and Big Momma now use their correct separated source artwork.
- Base tail/body/head positions are aligned from the supplied finished references.
- Finished references remain reference-only; visible deer are still built from separated pieces.
- Head + antlers and tail remain independently animated.
- Boss sleep has no supplied finished reference, so it inherits Boss awake connection geometry adapted to its sleep source.


SERVER 394 / GAME 422:
- Fixed random-looking world/map clones caused by canvas transforms surviving a recovered frame error.
- Every draw now starts at the identity transform.
- Frame-error recovery resets the drawing context before continuing.
- Added finite camera-position guards so invalid entity positions cannot corrupt the world view.


SERVER 395 / GAME 423:
- Fixed Game 422 canvas reset bug that restored identity transform instead of DPR scaling.
- Full-screen world rendering now clears/redraws correctly while keeping the anti-clone recovery logic.


SERVER 396 / GAME 424:
- Removed ctx.reset() from frame-error recovery so a caught error cannot blank the canvas.
- Added a last-good-frame physical-pixel backup and restore path.
- Separated deer draw failures are isolated and fall back visually for that frame instead of aborting the whole scene.


SERVER 397 / GAME 425:
- Added the uploaded separated Viper parts for every stage.
- Reconnected the split Viper body/head art and made it the main renderer.
- Kept the older whole-body Viper skins only as a fallback/reference path.


SERVER 398 / GAME 426:
- Wildlife can proactively fight nearby wildlife and hostile cubes.
- Added bite grace range so physical collision cannot stall animal-vs-animal combat.
- Multiplayer animal/enemy target refs now support wildlife-vs-wildlife and wildlife-vs-hostile-cube damage.
- Death overlay now simply says You died.
- Separated Viper tail wiggles opposite the head/neck direction.


SERVER 399 / GAME 427:
- Right-clicking a wild animal orders every owned pet to focus that animal.
- Automatic defend/retaliation fights now break off when pets or the threat get too far from the owner.
- Pets return to follow after dropping an auto-defense target.
- Multiplayer has server-authoritative manual pet focus targets.


SERVER 400 / GAME 428:
- Stability/performance audit pass.
- Last-good-frame backup throttled from every frame to ~6 fps.
- Wildlife fight targeting uses a short-lived spatial grid instead of full-world scans.
- Home preview only simulates animals near the camera.
- Viper segmented draw slices reduced while preserving smooth motion.
- Collision setup avoids repeated filter/concat allocations.


SERVER 401 / GAME 429:
- Multiplayer wildlife opponent search now uses the server spatial grid instead of scanning the full world.
- Disconnect cleanup removes pet focus/death timer and owner-threat entries to prevent stale map growth.


SERVER 403 / GAME 431:
- Day duration increased from 72s to 120s.
- Hostile cubes now spawn from random whole-map locations rather than around players.
- Follow/Defend/Set pets no longer proactively attack random wildlife or hostile cubes.
- Combat-mode pets still hunt automatically. Manual right-click focus and retaliation remain explicit exceptions.


SERVER 404 / GAME 432:
- Pet XP rewards now scale by defeated animal species and stage; Mentor Cape boosts kill XP.
- Pet roaming/follow distance now scales strongly with pet speed; Rabbits get an extra range bonus.
- Added run-only gold gear shop with Hats, Capes, and Armor.
- Shop gear resets on respawn/new run.
- Added species-specific taming percentages and locked taming while an attempt is resolving.
- Added run perks for gathering, regen, damage, tame chance, card drops, pet XP, and defense.


SERVER 405 / GAME 433:
- Hotbar now grows dynamically as usable items are acquired instead of always showing seven slots.
- Hotbar supports keys 1-9 and 0.
- Inventory now shows resources plus purchased run-shop gear only.
- Tools/buildables/saddle/berries live on the hotbar rather than duplicating into Inventory.
- Purchased hats/capes/armor can be equipped directly from Inventory.


SERVER 406 / GAME 434:
- Multiplayer patch rate increased from 10 Hz to 20 Hz to match server simulation.
- Pet/wildlife interpolation now estimates velocity from real patch timing instead of assuming 10 Hz.
- Remote pets use the same custom type/stage skin renderer and synced coat/spots/sleep/animation data as local pets.
- Remote players and hostile cubes now use prediction/interpolation instead of visible state stepping.
- Client dynamic world reads increased to 15 Hz while rendering remains frame-rate smooth.


SERVER 407 / GAME 435:
- Multiplayer pets now render from smoothed velocity every frame instead of chasing each network patch.
- Wildlife uses velocity-driven interpolation with gentle server correction.
- Pet/wildlife animation phase is continuous client-side; server tailPhase no longer causes phase jumps.
- Animation move speed is filtered so network jitter no longer makes heads/tails twitch or snap.


SERVER 408 / GAME 436:
- Fixed multiplayer non-Viper animation phase jumps caused by absoluteTime * changingFrequency.
- Dog/Cat/Dragon/Fox/Wolf/Deer/generic animal head-tail animation now uses continuous accumulated phase online.
- Animation movement ratio is more heavily filtered to prevent network jitter twitching.
- Recovery frame buffer is half-resolution and captured once per second to reduce random canvas-copy stalls.
- Full multiplayer world-copy sync reduced from 15 Hz to 10 Hz; render interpolation remains frame-rate smooth.
