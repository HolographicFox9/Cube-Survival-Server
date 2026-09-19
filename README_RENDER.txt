CUBE SURVIVAL — RENDER-READY MULTIPLAYER SERVER 477 / GAME 543

CURRENT BUILD 543 CHANGES

- Home screen now lets the player name the selected starter pet before Play.
- Home screen now lets the player choose the starter pet gender: Male or Female.
- Offline and multiplayer both create the starter pet with that exact chosen name and gender.
- Client/server gameplay Rules version: 542.

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


SERVER 409 / GAME 437:
- Stability-first multiplayer pass.
- Network patch rate returned to 10 Hz to reduce browser patch-processing/GC spikes; interpolation remains frame-rate smooth.
- Disabled recovery canvas copying/restoring while multiplayer is active.
- Offscreen wildlife and hostile cubes no longer receive expensive per-frame interpolation/animation work.
- Fixed remaining absolute-time changing-frequency body/head bob terms for non-Viper animals.
- Multiplayer non-Viper animation intensity reduced slightly for calmer motion.
- Dynamic world visual copy reduced to 8 Hz.


SERVER 410 / GAME 438:
- Refined Viper split-body alignment from the latest user references.
- Tightened awake/sleep Viper neck overlap and head anchor placement by stage.
- Nudged deer separated-piece body/head offsets closer to the provided deer references.
- Slightly moved deer head rotation pivot closer to the neck join for cleaner connection while animating.


SERVER 411 / GAME 439:
- Pets now follow a stable formation position behind/around their owner instead of stop/sprint/stop thresholds.
- Follow speed scales continuously with distance error for smoother multiplayer motion.
- Faster pets retain wider follow spacing; Rabbits retain extra range.
- Offline follow uses the same formation logic.
- Added 'bum' to client and server chat block lists.


SERVER 412 / GAME 440:
- Keyboard gameplay shortcuts only work during an active run.
- Text-entry fields suppress gameplay shortcuts so chat/pet rename typing cannot trigger commands.
- Verified offline wildlife can still bite/damage other wildlife through wildAttackConnects + damageTargetFromWild.
- Verified multiplayer wildlife can still bite/damage kind=animal targets through animalBiteVictim + performAnimalBite + damageTarget.


SERVER 413 / GAME 441:
- Pet XP bars appear only after XP gain, hold briefly, then fade away.
- Local player health bar appears only while damaged and fades after full healing.
- Remote player health bars only render below full health.
- Multiplayer player names are larger, bolder, and outlined for visibility.
- Gold rewards include exact server-authoritative balance to prevent multiplayer gold desync/stuck-at-3 behavior.


SERVER 414 / GAME 442:
- Pet follow formation now follows player movement direction instead of aim/facing direction.
- Follow targets are pushed out of static hitboxes before pets steer toward them.
- Follow target positions are smoothed and pet collision is resolved on the same movement frame.
- Fixed offline pet-kill XP variable bug that could throw on a pet kill.
- Viper bite animation now lunges the head/neck instead of shifting the whole body.
- Pickaxe redrawn as a classic cross-head pickaxe and uses the same upright two-hand pose as the axe.
- Small hotbar transition polish.


SERVER 415 / GAME 443 MOBILE PASS:
- Mobile controls now use pointer capture for reliable multitouch joystick + buttons.
- Added pointercancel/visibility/blur cleanup to prevent stuck movement or attack.
- Joystick has a small deadzone to remove finger tremor and keeps full-speed range.
- Mobile movement now sets player facing, so melee/tools aim with the joystick direction.
- Mobile controls auto-enable on coarse/touch devices unless the player saved a preference.
- Safe-area and landscape layouts added for notches/home indicators.
- Mobile render DPR capped lower and canvas resize work is throttled.
- Expensive HUD blur disabled during mobile gameplay; HUD/full-world client refresh reduced slightly.
- Simulation speed and multiplayer input send rate remain unchanged.


SERVER 416 / GAME 444 TAIL SMOOTHING:
- Multiplayer animals and pets now use a separate locally continuous tail phase.
- Tail animation speed follows a slower filtered rate with an acceleration limit, removing high-speed twitch from network velocity corrections.
- Deer and generic animal tail renderers use the dedicated multiplayer tail phase.
- Snake/Viper wave motion no longer stacks absolute-time motion on top of multiplayer tail phase.
- Head/body animation remains responsive and separate from tail smoothing.


SERVER 418 / GAME 446:
- Added Account button and account modal.
- Guest mode remains playable; account UI is optional.
- Added local placeholder signup/login/session flow for UI testing only.
- Signup grants 500 Cubits once, plus the normal +10 daily Cubits on that day.
- Logged-in placeholder sessions persist across reloads.
- Added Shop tabs: Gear, Themes, Chests.
- Added 10 guest-accessible planned themes and account/ad-locked theme placeholders.
- Added Daily Chest UI at top of Chests tab; ad opening intentionally disabled for now.
- Added Cubit chest listings; purchases intentionally disabled until reward tables are defined.
- No ad SDK or ad code was added.
- Real authentication/cloud save still requires the future backend connection.


SERVER 419 / GAME 447:
- Account modal is now the highest UI layer.
- Account opens above HUD/mobile/death/shop overlays.
- Opening Account closes Shop; opening Shop closes Account.


SERVER 420 / GAME 448:
- Fixed Account and Shop popup buttons binding before popup HTML existed.
- Close buttons now bind after DOMContentLoaded.
- Escape closes Account/Shop popups.
- Clicking the dark popup backdrop also closes the popup.


SERVER 421 / GAME 449:
- Chests shop page is now functional in the local account test system.
- Daily Chest is free once per UTC day.
- After the free opening, Daily Chest can be reopened for 50 Cubits.
- Small 75, Explorer 200, Rare 500, and Legendary 1000 Cubit chests now work.
- Chests award Cubits and can permanently unlock planned locked themes.
- Chest purchases require a logged-in local test account and check Cubit balance.
- No ad SDK or rewarded-ad code has been added.


SERVER 422 / GAME 450:
- Sleeping animals now preserve the same physical stage scale as their awake form.
- Removed generic sleep-only 1.02 visual scaling.
- Sleeping Vipers now preserve stage/body thickness instead of using a separate smaller sleep scale.
- Deer separated renderers already shared awake/sleep stage scale and remain unchanged.
- Owl width-based sizing remains shared across awake/sleep states.


SERVER 423 / GAME 451:
- Fixed possible world-render dead zones caused by stale/missing static spatial buckets.
- Render queries now validate suspiciously empty areas against authoritative world arrays.
- Spatial grid automatically rebuilds when the render fallback finds missing scenery.
- Added finite camera recovery so invalid camera coordinates cannot blank visibility checks.
- Hardened inView against invalid object coordinates.


SERVER 427 / GAME 455:
- Removed spatial-bucket dependency from scenery rendering.
- Trees/resources now render from authoritative world arrays with camera filtering.
- Added renderInView safety check that keeps nearby world objects visible even if camera/culling data briefly disagrees.
- Wildlife, pets, enemies, gold, and chests use the same safer render visibility check.
- Increased render padding for large animal stages and tree canopies.
- Collision spatial grid remains enabled for performance; only rendering bypasses stale buckets.


SERVER 428 / GAME 456:
- Fixed movement-key freeze/backlog issue.
- WASD/arrow hold no longer processes keyboard auto-repeat work; arrow scrolling is prevented.
- Held keyboard state clears on blur/tab hide.
- Client and server pet-follow obstacle scans are cached/throttled while the owner moves.
- Removed duplicate same-frame pet static-collision resolution.


SERVER 430 / GAME 458:
- Movement-priority performance pass.
- Client no longer touches all ~2,600 static resources every frame; nearby visual state stays 60 Hz and distant bulk state syncs ~4 Hz.
- Static render dead-zone validation moved out of active movement frames into idle/stationary repair.
- Offline recovery canvas snapshots are skipped while movement/camera motion is active.
- Minimap rendering is throttled to ~12.5 Hz.
- Player/gold collision now queries nearby spatial buckets only.
- Multiplayer dynamic full-world resync drops from 8 Hz to 6 Hz while moving (5 Hz mobile) while interpolation remains per-frame.

SERVER 441 / GAME 504 PET FOLLOW + IDLE WANDER:
- public/index.html updated to the current Game 504 client.
- Removed the old server-side moving formation-point pet follow system.
- Online pets now use the same simple distance leash as offline play: close/idle, walk, run, sprint.
- Pets near their owner occasionally wander to nearby points instead of freezing in place.
- Some idle strolls intentionally move away from the owner; crossing the leash threshold cancels the stroll and makes the pet return.
- Close-range wandering is allowed even while the owner is moving, as long as the pet remains inside the leash.
- Added server-side hysteresis so pets do not rapidly toggle between idle and follow at one exact distance.
- Added a small stuck-only obstacle slide and an extreme-distance stuck rescue without restoring the old formation targeting.
- Combat, Defend/Combat/Set orders, riding, abilities, collisions, death/respawn, and pet progression remain server-authoritative.

SERVER 442 / GAME 505 NATURAL CONTINUOUS PET ROAMING:
- public/index.html updated to Game 505.
- Removed the close-range pet pause/linger cycle. Awake following pets now keep moving continuously.
- Removed point-to-point idle orbit behavior; pets steer along loose changing paths instead of completing obvious circles.
- Close pets can naturally move away, cross beside/behind the owner, bend back inward, and continue moving without a reset pause.
- Near the leash edge, roaming direction becomes more likely to arc inward; crossing the leash still activates walk/run/sprint catch-up.
- Returning to close range flows directly back into roaming on the same update instead of stopping first.
- Blocked roaming pets immediately change heading around obstacles instead of waiting in place.
- Explicit orders, combat, riding, sleeping wildlife, abilities, progression, collisions, death/respawn, and multiplayer authority remain unchanged.

SERVER 443 / GAME 506 WEIGHT → SPEED → ROAMING PHYSICS:
- public/index.html updated to Game 506.
- Animal mass now modifies actual movement speed; light animals preserve more speed while heavy animals are slower.
- Pet Weight card upgrades now have a tradeoff: more mass makes the pet harder to shove but modestly reduces movement speed.
- Speed upgrades increase both movement speed and the natural roaming range around the owner.
- Follow leash distance is calculated from the pet's current actual speed, so fast pets range farther and slow pets stay closer.
- Player/body pushing and creature-vs-creature separation continue to split displacement by real animal mass.
- Pet ability / projectile knockback against wildlife now scales by animal mass instead of using one flat shove distance.
- Server and client use matching speed, weight, leash, and knockback formulas.

SERVER 445 / GAME 508 MULTIPLAYER RIDER LAYERING:
- Remote pets render before remote players, so another player's sprite is always visible above their pets.
- This includes mounted players: the mount draws first and the rider draws after it.
- The local player keeps the same mount rule: ridden pet first, player second.
- Game 509 keeps the Fox Theme and speed-based head/tail animation from Game 507.


SERVER 447 / GAME 510 OFFLINE ↔ ONLINE GAMEPLAY PARITY:
- Game and server now share gameplay rules version 510; mismatched versions are rejected instead of silently running different balance.
- Multiplayer input accepts the same current client coordinates (clientX/clientY) and keeps x/y compatibility for older servers.
- Sabertooth physical/body hitboxes use the same smaller geometry online and offline.
- Animal weight, speed, knockback resistance, pet roaming range, attack cooldowns, and pet tail timing use matching formulas.
- Server pet combat uses the same head-contact bite rule and Combat chase speeds as offline.
- Combat-order pets use the same independent hunt/roam behavior instead of returning to the owner when no target is nearby.
- Player/animal pushing uses the same weight-split displacement and escape rule in both modes.
- Server static collision uses the same animal multi-circle bodies and the same special tree/log/gold/chest shapes used offline.
- Wildlife AI now matches offline ranges and movement: 170 bear / 190 normal natural aggro, 0.90 ambient hostile chase, 1.05 locked-target chase, 1.15 hit-flee, 1.24 baby flee, and the same friendly nearby roaming.
- Skittish wildlife remembers the actual attacker and uses the same flee-first / low-health-fight-back rule online.
- Wild Stone, Sound, Fire, Lightning, Ice, Water, and Plant abilities now run authoritatively online with the same cooldown multiplier, cast range, damage, and push distances as offline.
- Wild Dog stone walls can hurt players online just like offline; pet-owned stone walls still do not hurt players.
- Wildlife-vs-wildlife bite/ability damage follows the same raw-damage path used offline.

SERVER 457 / GAME 521 MOONMARK SPAWN + MINIMAP
- Moonmark bosses spawn at random clear points across the entire map.
- Spawn validation avoids resources, gold, chests, players, pets, animals, Hostls, walls, and towers.
- Moonmark minimap markers are large solid biome-colored dots; Forest uses deep green (#0b542f).


Game 539 / Server 475 update:
- Hostl Rider mounts use the Wolf physical collision profile.
- Player/animal contact uses smooth mutual push; the player can push animals and animals can push the player without sticky carry behavior.


GAME 541 / SERVER 476 — WILDLIFE FAMILIES
- Wild animals no longer proactively fight the same species; animal-vs-animal hunting is restricted to species prey relationships.
- Wild animals and pets have synchronized Male/Female genders.
- During Morning, a limited number of calm grown same-species Male/Female wild pairs seek each other; contact creates a baby.
- Pet menu has Breed: same species, opposite gender, Adult or older. Bred family babies do not consume one of the four normal pet/tame slots and award +1 species card.
- Bred babies follow their parents, fight/level normally, and copy either parent's ability cast without their own cooldown.
