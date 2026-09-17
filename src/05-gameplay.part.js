// ---------- world state ----------
let resources = [];
let enemies = [];
let projectiles = [];
let petBlasts = [];
let walls = [];
let towers = [];
let particles = [];
let floaters = [];
let animals = [];
let goldChunks = [];
let chests = [];
let abilityFx = [];

// Performance: static world collision objects are stored in spatial buckets.
// Before this, every animal/enemy checked all ~2,600 resources every frame.
const STATIC_GRID_CELL = 256;
let staticCollisionGrid = new Map();
function staticGridKey(cx, cy) { return cx + "," + cy; }
function getStaticBucket(cx, cy, create = false) {
  const key = staticGridKey(cx, cy);
  let bucket = staticCollisionGrid.get(key);
  if (!bucket && create) {
    bucket = { resources: [], gold: [], chests: [] };
    staticCollisionGrid.set(key, bucket);
  }
  return bucket;
}
function addStaticCollider(kind, obj) {
  const cx = Math.floor(obj.x / STATIC_GRID_CELL);
  const cy = Math.floor(obj.y / STATIC_GRID_CELL);
  getStaticBucket(cx, cy, true)[kind].push(obj);
}
function rebuildStaticCollisionGrid() {
  staticCollisionGrid = new Map();
  for (const r of resources) addStaticCollider("resources", r);
  for (const g of goldChunks) addStaticCollider("gold", g);
  for (const c of chests) addStaticCollider("chests", c);
}
function queryStaticNearby(kind, x, y, range = 320) {
  const out = [];
  const minCX = Math.floor((x - range) / STATIC_GRID_CELL);
  const maxCX = Math.floor((x + range) / STATIC_GRID_CELL);
  const minCY = Math.floor((y - range) / STATIC_GRID_CELL);
  const maxCY = Math.floor((y + range) / STATIC_GRID_CELL);
  for (let cy = minCY; cy <= maxCY; cy++) {
    for (let cx = minCX; cx <= maxCX; cx++) {
      const bucket = getStaticBucket(cx, cy, false);
      if (!bucket) continue;
      const list = bucket[kind];
      for (let i = 0; i < list.length; i++) out.push(list[i]);
    }
  }
  return out;
}

const RUN_SHOP_ITEMS = [
  {id:"minerHat",cat:"hat",icon:"⛏️",name:"Miner Hat",cost:25,desc:"Gather 25% more wood, stone, berries, and mined gold."},
  {id:"healerHood",cat:"hat",icon:"💚",name:"Healer Hood",cost:35,desc:"Regenerate 0.7 HP per second while alive."},
  {id:"warriorHelm",cat:"hat",icon:"⚔️",name:"Warrior Helm",cost:45,desc:"Deal 18% more player damage."},
  {id:"tamerCape",cat:"cape",icon:"🟩",name:"Tamer Cape",cost:40,desc:"Adds +10 percentage points to tame chance."},
  {id:"cardCape",cat:"cape",icon:"🃏",name:"Cardseeker Cape",cost:45,desc:"75% higher chance to get pet cards from kills."},
  {id:"mentorCape",cat:"cape",icon:"⭐",name:"Mentor Cape",cost:50,desc:"Pets earn 50% more XP from kills."},
  {id:"leatherArmor",cat:"armor",icon:"🟤",name:"Leather Armor",cost:30,desc:"Take 12% less damage."},
  {id:"ironArmor",cat:"armor",icon:"🛡️",name:"Iron Armor",cost:55,desc:"Take 22% less damage."},
  {id:"guardianArmor",cat:"armor",icon:"🔰",name:"Guardian Armor",cost:90,desc:"Take 34% less damage."}
];
const RUN_SHOP_BY_ID = Object.fromEntries(RUN_SHOP_ITEMS.map(i=>[i.id,i]));
function freshRunShopState(){return {purchased:new Set(),hat:"",cape:"",armor:""};}
let runShop = freshRunShopState();
function equippedRunItem(cat){return RUN_SHOP_BY_ID[runShop[cat]]||null;}
function runGatherMul(){return runShop.hat==="minerHat"?1.25:1;}
function runRegenPerSec(){return runShop.hat==="healerHood"?0.7:0;}
function runDamageMul(){return runShop.hat==="warriorHelm"?1.18:1;}
function runTameBonus(){return runShop.cape==="tamerCape"?0.10:0;}
function runCardChanceMul(){return runShop.cape==="cardCape"?1.75:1;}
function runPetXpMul(){return runShop.cape==="mentorCape"?1.50:1;}
function runDefenseMul(){return runShop.armor==="guardianArmor"?.66:runShop.armor==="ironArmor"?.78:runShop.armor==="leatherArmor"?.88:1;}

const TAME_BASE_CHANCE = {
  dog:.50, cat:.50, rabbit:.50,
  fox:.42, wolf:.42, deer:.42, dragon:.42,
  bear:.34, boar:.34,
  snake:.28, owl:.28,
  saber:.18
};
function tameChanceFor(type){return clamp((TAME_BASE_CHANCE[type] ?? .38)+runTameBonus(),.08,.80);}

const PET_KILL_STAGE_XP = {baby:6,adult:14,boss:32,superboss:68,bigmomma:120};
const PET_KILL_SPECIES_XP = {rabbit:.85,dog:1,cat:1,fox:1.05,deer:1.08,dragon:1.12,wolf:1.15,bear:1.22,boar:1.22,snake:1.28,owl:1.30,saber:1.48};
function petKillXpForAnimal(a){
  if(!a)return 0;
  const base=PET_KILL_STAGE_XP[a.stage] ?? 14;
  const species=PET_KILL_SPECIES_XP[a.type] ?? 1;
  return Math.max(2,Math.round(base*species));
}
function petKillXpForEnemy(en){return en?.strong?26:14;}
function petFollowRangeFor(p){
  const speed=Math.max(35,Number(p?.speed)||60);
  const speedT=clamp((speed-45)/145,0,1);
  let start=78+speedT*175;
  if(p?.type==="rabbit")start+=42;
  if(p?.type==="bear")start-=18;
  if(p?.type==="dragon")start-=10;
  start=clamp(start,68,305);
  const stop=clamp(start*.46,44,112);
  return {start,stop,wanderMax:clamp(start*.82,64,300)};
}

const player = {
  x: WORLD_W / 2 + 145, y: WORLD_H / 2, angle: 0,
  health: 100, maxHealth: 100,
  wood: 0, stone: 0, gold: 0, berries: 0,
  tool: "Fist", heldSpecial: null, owned: { Fist: true, Axe: false, Pickaxe: false, Sword: false, Bow: false },
  attackCd: 0, shootCd: 0, punchTimer: 0, punchSide: 1, swingWeapon: "Fist",
  hurtFlash: 0, dead: false, splitT: 0,
  color: COLORS[0], username: "Cube",
  inventory: [], // {id, qty}
  hasSaddle: false,
  pets: [], // max 4
  riding: null,
};

let game = {
  time: 0, survivalTime: 0, kills: 0, wave: 0, waveTimer: 0, over: false,
  camX: 0, camY: 0, shake: 0,
  deathCamTarget: null, deathCamTargetKind: "", deathCamTargetId: "",
  phaseIdx: 0, phaseTimer: 0, dayCount: 1,
  started: false,
  startPet: null,
  earnedServs: 0,
  homeCamReady: false, homeTargetX: 0, homeTargetY: 0,
  tamePending: false,
};

// ---------- world gen ----------
function farEnoughFromCenter(x, y, min) {
  return dist(x, y, WORLD_W / 2, WORLD_H / 2) > min;
}

function resourceSolidCenter(r) {
  if (r.type === "tree") {
    // Top-down tree: keep the solid center near the middle of the canopy.
    return { x: r.x, y: r.y + 4 * (r.scale || 1) };
  }
  return { x: r.x, y: r.y };
}
function resourceDrawY(r) {
  return resourceSolidCenter(r).y;
}
function logSolidHitboxes(r) {
  if (!r || r.type !== "log") return [];
  const sc = r.scale || 1;
  const ang = r.rot || 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // The visible log is long and narrow, so use a row of overlapping circles.
  // This follows rotation and feels like a capsule instead of a round rock.
  const halfLen = 27 * sc;
  const radius = 8.8 * sc;
  return [-0.82, -0.41, 0, 0.41, 0.82].map(t => ({
    x: r.x + ca * (halfLen * t),
    y: r.y + sa * (halfLen * t),
    r: radius
  }));
}
function resourceTouchingCircle(r, x, y, radius=0) {
  if (r.type === "log") {
    for (const h of logSolidHitboxes(r)) {
      if (dist(x, y, h.x, h.y) < radius + h.r) return h;
    }
    return null;
  }
  const c = resourceSolidCenter(r);
  return dist(x, y, c.x, c.y) < radius + r.solidR ? { x:c.x, y:c.y, r:r.solidR } : null;
}
function deepestResourceOverlap(r, x, y, radius=0) {
  let best = null, bestOverlap = 0;
  const parts = r.type === "log" ? logSolidHitboxes(r) : [{...resourceSolidCenter(r), r:r.solidR}];
  for (const h of parts) {
    const d = dist(x, y, h.x, h.y);
    const overlap = radius + h.r - d;
    if (overlap > bestOverlap) { bestOverlap = overlap; best = { h, d, overlap }; }
  }
  return best;
}
function drawWholeTree(r) {
  drawResource(r);
  drawTreeCanopy(r);
}
function goldSolidHitbox(g) {
  // Bigger and fuller so you don't clip too far into the gold before stopping.
  const yOff = g.pure ? g.r * 0.06 : g.size === "huge" ? g.r * 0.04 : g.r * 0.03;
  const rr = g.r * (g.pure ? 0.78 : g.size === "huge" ? 0.75 : 0.72);
  return { x: g.x, y: g.y + yOff, r: rr };
}
function animalBodyHitboxes(a) {
  if (!a) return [];

  const ang = a.angle || 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const fit = animalHitboxFit(a.type, a.stage);
  const dims = uploadedAnimalVisibleDimensions(a.type, a.stage);

  if (dims) {
    // Collision follows the actual SVG size on screen and scales proportionately
    // with the animal's visible length/height.
    const cfg = {
      dog:    [[-0.34,0.17],[-0.17,0.26],[0.05,0.31],[0.27,0.28],[0.43,0.23],[0.54,0.17]],
      cat:    [[-0.35,0.16],[-0.18,0.24],[0.04,0.29],[0.26,0.25],[0.43,0.21],[0.54,0.16]],
      dragon: [[-0.39,0.14],[-0.22,0.21],[0.02,0.26],[0.28,0.22],[0.46,0.18],[0.60,0.13]],
      rabbit: [[-0.28,0.16],[-0.10,0.22],[0.08,0.27],[0.26,0.24],[0.41,0.20],[0.51,0.15]],
      owl:    [[-0.24,0.19],[-0.08,0.27],[0.10,0.31],[0.27,0.28],[0.40,0.23],[0.50,0.18]],
      snake:  [[-0.44,0.22],[-0.32,0.27],[-0.19,0.30],[-0.05,0.31],[0.10,0.31],[0.24,0.30],[0.37,0.27],[0.47,0.23]],
      fox:    [[-0.37,0.17],[-0.19,0.25],[0.04,0.30],[0.27,0.26],[0.44,0.21],[0.56,0.16]],
      wolf:   [[-0.36,0.18],[-0.18,0.27],[0.05,0.32],[0.28,0.28],[0.45,0.23],[0.57,0.17]],
      bear:   [[-0.30,0.21],[-0.14,0.32],[0.07,0.38],[0.28,0.34],[0.43,0.27],[0.54,0.20]],
      deer:   [[-0.28,0.13],[-0.09,0.20],[0.12,0.24],[0.33,0.21],[0.49,0.16],[0.61,0.11]]
    }[a.type];

    return cfg.map(([xFrac, rFrac], i) => {
      const headish = i >= cfg.length - 2;
      const noseTip = i === cfg.length - 1;
      const forward = dims.w * xFrac * (headish ? fit.head : fit.len);
      const rr = Math.max(8, dims.h * rFrac * (headish ? fit.head : fit.body));
      const headDrop = noseTip ? dims.h * 0.05 * fit.head :
                       headish ? dims.h * 0.03 * fit.head : 0;
      return {
        x: a.x + ca * forward - sa * headDrop,
        y: a.y + sa * forward + ca * headDrop,
        r: rr
      };
    });
  }

  // Non-uploaded animals: scale offset/radius proportionately to their stage/type fit.
  const r = a.r || 18;
  let parts;

  if (a.type === "snake") {
    parts = [[-1.00,0,0.31],[-0.76,0,0.41],[-0.24,0,0.49],[0.32,0,0.47],[0.80,0,0.41],[1.16,0,0.33],[1.42,0,0.24]];
  } else if (a.type === "boar" || a.type === "saber") {
    parts = [[-0.74,0,0.53],[-0.48,0,0.73],[0.08,0,0.83],[0.68,0,0.68],[1.08,0,0.50],[1.42,0,0.39],[1.66,0,0.28]];
  } else if (a.type === "deer") {
    parts = [[-0.68,0,0.38],[-0.40,0,0.54],[0.06,0,0.61],[0.54,0,0.46],[0.90,0,0.34],[1.18,0,0.25],[1.38,0,0.18]];
  } else if (a.type === "rabbit") {
    parts = [[-0.52,0,0.43],[-0.28,0,0.62],[0.25,0,0.67],[0.74,0,0.51],[1.10,0,0.40],[1.36,0,0.31],[1.55,0,0.23]];
  } else if (a.type === "owl") {
    parts = [[-0.42,0,0.47],[-0.18,0,0.69],[0.28,0,0.71],[0.68,0,0.55],[0.98,0,0.42],[1.24,0,0.32],[1.42,0,0.23]];
  } else {
    parts = [[-0.64,0,0.47],[-0.39,0,0.69],[0.10,0,0.77],[0.65,0,0.61],[1.02,0,0.45],[1.34,0,0.35],[1.56,0,0.25]];
  }

  return parts.map(([forward, side, rad], i) => {
    const fromEnd = parts.length - 1 - i;
    const headish = fromEnd <= 2;
    const noseTip = fromEnd === 0;
    const headDrop = noseTip ? 0.14 : fromEnd === 1 ? 0.10 : fromEnd === 2 ? 0.06 : 0;
    const lenMul = headish ? fit.head : fit.len;
    const bodyMul = headish ? fit.head : fit.body;
    const localSide = (side + headDrop) * bodyMul;
    return {
      x: a.x + ca * (forward * r * lenMul) - sa * (localSide * r),
      y: a.y + sa * (forward * r * lenMul) + ca * (localSide * r),
      r: Math.max(8, r * rad * bodyMul)
    };
  });
}
function animalBodyHitbox(a) {
  // Legacy broad hitbox for code that only needs one center/radius.
  const hs = animalBodyHitboxes(a);
  if (!hs.length) return { x: 0, y: 0, r: 0 };
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for (const h of hs) {
    minX=Math.min(minX,h.x-h.r); maxX=Math.max(maxX,h.x+h.r);
    minY=Math.min(minY,h.y-h.r); maxY=Math.max(maxY,h.y+h.r);
  }
  const x=(minX+maxX)/2, y=(minY+maxY)/2;
  return { x, y, r: Math.max(maxX-minX,maxY-minY)/2 };
}
function animalTouchingCircle(a, x, y, radius=0) {
  for (const h of animalBodyHitboxes(a)) {
    if (dist(x,y,h.x,h.y) < radius + h.r) return h;
  }
  return null;
}
function deepestAnimalCircleOverlap(a, x, y, radius=0) {
  let best=null, bestOverlap=0;
  for (const h of animalBodyHitboxes(a)) {
    const d=dist(x,y,h.x,h.y);
    const overlap=radius+h.r-d;
    if (overlap>bestOverlap) { bestOverlap=overlap; best={h,d,overlap}; }
  }
  return best;
}

function animalPhysicalHitboxes(a) {
  // Combat/melee still uses the full head + snout geometry.
  // Physical movement uses the body + neck, but leaves the final two face/snout
  // circles non-solid so the player can still get right up to the snout.
  const hits = animalBodyHitboxes(a);
  return hits.length > 2 ? hits.slice(0, hits.length - 2) : hits;
}

function deepestAnimalPhysicalOverlap(a, x, y, radius=0) {
  let best=null, bestOverlap=0;
  for (const h of animalPhysicalHitboxes(a)) {
    const d=dist(x,y,h.x,h.y);
    const overlap=radius+h.r-d;
    if (overlap>bestOverlap) { bestOverlap=overlap; best={h,d,overlap}; }
  }
  return best;
}

function resolveAnimalPhysicalPair(a, b) {
  if (!a || !b || a === b || a.dead || b.dead) return false;

  let moved = false;

  // A couple of small solver passes are enough to prevent tunneling/stacking
  // without causing a large CPU spike.
  for (let pass = 0; pass < 2; pass++) {
    const ah = animalPhysicalHitboxes(a);
    const bh = animalPhysicalHitboxes(b);
    let best = null;
    let bestOverlap = 0;

    for (const ca of ah) {
      for (const cb of bh) {
        const dx = cb.x - ca.x, dy = cb.y - ca.y;
        const rr = ca.r + cb.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;

        const d = Math.sqrt(Math.max(0.0001, d2));
        const overlap = rr - d;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = { dx, dy, d, ca, cb };
        }
      }
    }

    if (!best || bestOverlap <= 0.01) break;

    let nx = best.dx / best.d, ny = best.dy / best.d;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      nx = dx / d; ny = dy / d;
    }

    const wa = animalWeight(a), wb = animalWeight(b);
    const invA = 1 / Math.max(0.2, wa);
    const invB = 1 / Math.max(0.2, wb);
    const sum = invA + invB || 1;

    // Slightly over-resolve so moving animals don't immediately re-enter
    // each other's body on the next movement step.
    const correction = Math.min(bestOverlap + 0.35, 16);
    const moveA = correction * (invA / sum);
    const moveB = correction * (invB / sum);

    a.x -= nx * moveA;
    a.y -= ny * moveA;
    b.x += nx * moveB;
    b.y += ny * moveB;
    moved = true;
  }

  return moved;
}

function solidOverlaps(x, y, solid) {
  for (const r of resources) {
    if (!r.alive && r.respawnAt) continue;
    if (r.type === "log") {
      if (resourceTouchingCircle(r, x, y, solid + 4)) return true;
    } else {
      const c = resourceSolidCenter(r);
      if (dist(x, y, c.x, c.y) < solid + r.solidR + 4) return true;
    }
  }
  for (const g of goldChunks) {
    const gh = goldSolidHitbox(g);
    if (dist(x, y, gh.x, gh.y) < solid + gh.r + 4) return true;
  }
  for (const c of chests) {
    if (c.opened) continue;
    const ch = chestSolidHitbox(c);
    if (dist(x, y, ch.x, ch.y) < solid + ch.r + 6) return true;
  }
  return false;
}
function chestSolidHitbox(c) {
  return { x: c.x, y: c.y + 8, r: c.r || 18 };
}
function placeChests() {
  chests = [];
  for (let i = 0; i < 72; i++) {
    let x, y, tries = 0;
    do {
      x = rand(130, WORLD_W - 130);
      y = rand(130, WORLD_H - 130);
      tries++;
    } while ((dist(x, y, WORLD_W / 2, WORLD_H / 2) < 280 || solidOverlaps(x, y, 20)) && tries < 80);
    if (tries >= 80) continue;
    const reward = makeChestReward();
    chests.push({ x, y, r: 18, opened: false, pulse: 0, shine: rand(0, TAU), hp: 4, maxHp: 4, reward, chipSide: Math.random() < 0.5 ? "wood" : "stone" });
  }
}

function scatter(type, count, hp, minDistFromCenter, rSolid) {
  for (let i = 0; i < count; i++) {
    let x, y, tries = 0, solid = rSolid, canopy = 0, scale = 1;
    if (type === "tree") {
      // Larger, better-shaped trees with tighter trunk hitboxes.
      scale = rand(1.2, 2.3);
      solid = 8.8 * scale;
      canopy = 46 * scale;
    } else if (type === "rock") {
      scale = rand(1.0, 2.1);
      // Rocks are visually broad, so give them a fuller collision footprint.
      // This keeps the cube/animals from clipping deep into the stone art.
      solid = 26.5 * scale;
    } else if (type === "log") {
      scale = rand(1.0, 1.6);
      solid = 17.5 * scale;
    } else if (type === "bush") {
      scale = rand(1.08, 1.7);
      solid = 10.8 * scale;
      canopy = 24 * scale;
    }
    do {
      x = rand(120, WORLD_W - 120); y = rand(120, WORLD_H - 120); tries++;
    } while ((dist(x, y, WORLD_W / 2, WORLD_H / 2) < minDistFromCenter || solidOverlaps(x, y, solid)) && tries < 80);
    if (tries >= 80) continue; // skip if couldn't place without overlap
    resources.push({
      type, x, y, hp, maxHp: hp, alive: true, respawnAt: 0, pulse: 0,
      solidR: solid, canopyR: canopy, scale, rot: type === "log" ? rand(0, TAU) : 0,
    });
  }
}

function placeGoldChunks() {
  goldChunks = [];
  // Permanent giant pure-gold monument at the exact center of the world.
  // It never breaks and pays gold on every hit.
  goldChunks.push({
    x: WORLD_W / 2, y: WORLD_H / 2,
    size: "pure", r: 176, goldLeft: Infinity,
    infinite: true, pure: true, pulse: 0,
  });
  for (let i = 0; i < 14; i++) {
    let x, y, tries = 0;
    do {
      x = rand(400, WORLD_W - 400);
      y = rand(400, WORLD_H - 400);
      tries++;
    } while ((dist(x, y, WORLD_W / 2, WORLD_H / 2) < 500 || solidOverlaps(x, y, 48)) && tries < 60);
    goldChunks.push({ x, y, size: "huge", r: 48, goldLeft: 40, pulse: 0 });
  }
  for (let i = 0; i < 120; i++) {
    let x, y, tries = 0;
    do {
      x = rand(120, WORLD_W - 120);
      y = rand(120, WORLD_H - 120);
      tries++;
    } while (solidOverlaps(x, y, 16) && tries < 50);
    if (tries >= 50) continue;
    goldChunks.push({ x, y, size: "small", r: 16, goldLeft: 6, pulse: 0 });
  }
}

const WILD_SPECIES = ["fox","wolf","bear","cat","dog","rabbit","owl","snake","deer","boar","saber"];
const WILD_TYPE_TARGETS = { fox: 1.28, wolf: 1.06, bear: 0.92, cat: 1.0, dog: 1.0, rabbit: 1.08, owl: 0.9, snake: 0.9, deer: 1.02, boar: 0.9, saber: 0.82 };
function chooseWildType() {
  const counts = Object.fromEntries(WILD_SPECIES.map(t => [t, 0]));
  for (const a of animals) {
    if (!a.dead && !a.owned && counts[a.type] != null) counts[a.type]++;
  }
  let best = [];
  let bestScore = Infinity;
  for (const type of WILD_SPECIES) {
    const target = WILD_TYPE_TARGETS[type] || 1;
    const score = counts[type] / target + Math.random() * 0.08;
    if (score < bestScore - 1e-6) {
      best = [type];
      bestScore = score;
    } else if (score <= bestScore + 0.04) {
      best.push(type);
    }
  }
  return best[randi(0, best.length - 1)];
}
function animalSpawnCrowded(x, y, spawnR, extraGap = 34) {
  for (const a of animals) {
    if (a.dead || a.owned) continue;
    const otherR = animalSpawnFootprint(a.type, a.stage);
    if (dist(x, y, a.x, a.y) < spawnR + otherR + extraGap) return true;
  }
  return false;
}

function spawnWildAnimal(nearPlayer, forcedStage = null) {
  const type = chooseWildType();

  let stage = forcedStage;
  if (!stage) {
    const sr = Math.random();
    if (sr < 0.46) stage = "baby";
    else if (sr < 0.84) stage = "adult";
    else if (sr < 0.95) stage = "boss";
    else stage = "superboss";
  }

  const r = animalRadius(type, stage);
  const spawnR = animalSpawnFootprint(type, stage);

  let x, y, tries = 0;
  do {
    if (nearPlayer) {
      const a = rand(0, TAU);
      const d = rand(Math.max(180, spawnR + 90), Math.max(520, spawnR + 300));
      x = clamp(player.x + Math.cos(a) * d, spawnR + 24, WORLD_W - spawnR - 24);
      y = clamp(player.y + Math.sin(a) * d, spawnR + 24, WORLD_H - spawnR - 24);
    } else {
      const roll = Math.random();
      if (roll < 0.55) {
        x = rand(spawnR + 80, WORLD_W - spawnR - 80);
        y = rand(spawnR + 80, WORLD_H - spawnR - 80);
      } else if (roll < 0.8) {
        const a = rand(0, TAU);
        const d = rand(900, Math.min(WORLD_W, WORLD_H) * 0.38);
        x = clamp(WORLD_W / 2 + Math.cos(a) * d, spawnR + 40, WORLD_W - spawnR - 40);
        y = clamp(WORLD_H / 2 + Math.sin(a) * d, spawnR + 40, WORLD_H - spawnR - 40);
      } else {
        x = rand(spawnR + 40, WORLD_W - spawnR - 40);
        y = rand(spawnR + 40, WORLD_H - spawnR - 40);
      }
    }
    tries++;
  } while (
    (
      solidOverlaps(x, y, spawnR) ||
      animalSpawnCrowded(x, y, spawnR, nearPlayer ? 26 : 40)
    ) &&
    tries < 70
  );

  // If an unusually crowded area still failed, do not force-spawn inside a solid.
  if (solidOverlaps(x, y, spawnR) || animalSpawnCrowded(x, y, spawnR, 18)) return;

  const sleeping = stage === "bigmomma" ? Math.random() < 0.96 :
                   stage === "superboss" ? Math.random() < 0.88 :
                   stage === "boss" ? Math.random() < 0.75 :
                   stage === "baby" ? Math.random() < 0.65 : false;
  const hp = typeHp(type, stage);
  const coats = PET_TYPES[type].coats || [PET_TYPES[type].color];
  const coat = coats[randi(0, coats.length - 1)];
  const hasSpots = (type === "dog" && Math.random() < 0.55) || (type === "cat" && Math.random() < 0.35) || (type === "rabbit" && Math.random() < 0.25);
  const spotCol = shadeColor(coat, Math.random() < 0.5 ? -35 : 30);
  const spots = hasSpots ? Array.from({ length: randi(3, 7) }, () => ({
    x: rand(-0.5, 0.5), y: rand(-0.4, 0.4), s: rand(0.12, 0.22)
  })) : [];
  animals.push({
    type, stage, x, y, angle: rand(0, TAU),
    r, hp, maxHp: hp, coat, spots, spotCol,
    speed: animalSpeed(type, stage, false),
    sleeping, tameProgress: 0, owned: false, follow: false,
    abilityCd: rand(3, infoAbilityCd(type)), targetX: null, targetY: null,
    wanderT: rand(1, 3), wanderA: rand(0, TAU),
    flash: 0, dead: false, tailPhase: rand(0, TAU),
    atkCd: 0, combat: 0, exp: 0, level: 1,
    recentHit: 0, attackAnim: 0,
    fleeUntil: 0, enraged: false, tameFailedAggro: false, desperateAggro: false,
  });
}
function infoAbilityCd(type) {
  return (PET_TYPES[type] && PET_TYPES[type].abilityCd) || 12;
}
function markCreatureHit(creature, recent = 3.6) {
  if (!creature) return;
  creature.recentHit = Math.max(creature.recentHit || 0, recent);
}
function updateCreatureRecovery(creature, dt, regenRate) {
  if (!creature || creature.dead) return;
  creature.recentHit = Math.max(0, (creature.recentHit || 0) - dt);
  creature.attackAnim = Math.max(0, (creature.attackAnim || 0) - dt);
  if (creature.recentHit <= 0 && creature.hp < creature.maxHp) {
    creature.hp = Math.min(creature.maxHp, creature.hp + regenRate * dt);
  }
}

function initWorld() {
  resources = [];
  // The giant world should feel full instead of sparse: many more, larger resources.
  scatter("tree", 980, 9, 240, 12);
  scatter("rock", 680, 4, 240, 20);
  scatter("log", 420, 2.4, 180, 16); // easy fallen wood: a few punches, wood every hit
  scatter("bush", 560, 8, 180, 13); // bushes take several hits; drop berries
  placeGoldChunks();
  placeChests();
  walls = []; towers = []; projectiles = []; petBlasts = []; particles = []; floaters = []; enemies = []; animals = [];
  abilityFx = [];
  // Much more wildlife spread throughout the larger map.
  for (let i = 0; i < 330; i++) spawnWildAnimal(false);
  // Keep rare encounters present without flooding the world with them.
  for (let i = 0; i < 14; i++) spawnWildAnimal(false, "superboss");
  for (let i = 0; i < 5; i++) spawnWildAnimal(false, "bigmomma");
  rebuildStaticCollisionGrid();
}

function chooseRandomPlayerSpawn(avoidX = null, avoidY = null, minDistance = 0) {
  const margin = 650;
  const hasAvoid = Number.isFinite(avoidX) && Number.isFinite(avoidY) && minDistance > 0;
  for (let tries = 0; tries < 320; tries++) {
    const x = rand(margin, WORLD_W - margin);
    const y = rand(margin, WORLD_H - margin);
    // A death restart must feel like a genuinely new location, not a tiny shuffle.
    if (hasAvoid && dist(x, y, avoidX, avoidY) < minDistance) continue;
    // Keep the starting point away from the permanent center monument and solid scenery.
    if (dist(x, y, WORLD_W / 2, WORLD_H / 2) < 700) continue;
    if (solidOverlaps(x, y, PLAYER_R + 52)) continue;
    let unsafe = false;
    for (const a of animals) {
      if (a.dead || a.owned) continue;
      const danger = a.stage === "bigmomma" ? 700 :
                     a.stage === "superboss" ? 600 :
                     a.stage === "boss" ? 470 : 230;
      if (dist(x, y, a.x, a.y) < danger) { unsafe = true; break; }
    }
    if (!unsafe) return { x, y };
  }
  // The world is huge, so this normally never runs. Even the fallback tries to
  // preserve the "somewhere different" rule after death.
  for (let tries = 0; tries < 120; tries++) {
    const x = rand(margin, WORLD_W - margin);
    const y = rand(margin, WORLD_H - margin);
    if (hasAvoid && dist(x, y, avoidX, avoidY) < minDistance * 0.7) continue;
    if (!solidOverlaps(x, y, PLAYER_R + 20)) return { x, y };
  }
  return { x: margin + 40, y: margin + 40 };
}

function pickHomeCameraTarget(forceStart = false) {
  const maxX = Math.max(0, WORLD_W - W);
  const maxY = Math.max(0, WORLD_H - H);
  if (forceStart || !game.homeCamReady) {
    game.camX = rand(0, maxX);
    game.camY = rand(0, maxY);
    game.homeCamReady = true;
  }
  // Pick a destination a good distance away so the menu feels like a roaming world tour.
  const ang = rand(0, TAU);
  const travel = rand(1200, 3200);
  game.homeTargetX = clamp(game.camX + Math.cos(ang) * travel, 0, maxX);
  game.homeTargetY = clamp(game.camY + Math.sin(ang) * travel, 0, maxY);
}

function updateHomeCamera(dt) {
  if (!game.homeCamReady) pickHomeCameraTarget(true);
  const dx = game.homeTargetX - game.camX;
  const dy = game.homeTargetY - game.camY;
  const d = Math.hypot(dx, dy);
  if (d < 18) {
    pickHomeCameraTarget(false);
    return;
  }
  const speed = 165;
  const step = Math.min(d, speed * dt);
  game.camX += dx / d * step;
  game.camY += dy / d * step;
}

function updateHomeAnimals(dt) {
  // Home is a live preview of the generated world.
  // Wildlife keeps roaming, but combat/player-targeting is paused until a run starts.
  const previewAnimals = [];
  for (const a of animals) {
    if (!a.dead && !a.owned) previewAnimals.push(a);
  }
  for (const p of player.pets || []) {
    if (p && !p.dead && !previewAnimals.includes(p)) previewAnimals.push(p);
  }

  const homeCx = game.camX + W * 0.5, homeCy = game.camY + H * 0.5;
  const homeActiveRange = Math.hypot(W, H) * 0.75 + 420;
  for (const a of previewAnimals) {
    if (dist(a.x, a.y, homeCx, homeCy) > homeActiveRange) continue;
    a.tailPhase = (a.tailPhase || 0) + dt * (2.0 + (a.speed || 50) * 0.018);
    a.attackAnim = Math.max(0, (a.attackAnim || 0) - dt);
    a.flash = Math.max(0, (a.flash || 0) - dt);

    if (a.sleeping) {
      a.homeSleepT = (a.homeSleepT == null) ? rand(5, 18) : a.homeSleepT - dt;
      if (a.homeSleepT <= 0) {
        // Big Mommas stay sleepy much longer; other stages occasionally wake and wander.
        const wakeChance = a.stage === "bigmomma" ? 0.12 :
                           a.stage === "superboss" ? 0.28 :
                           a.stage === "boss" ? 0.42 : 0.72;
        if (Math.random() < wakeChance) {
          a.sleeping = false;
          a.wanderT = rand(1.2, 3.5);
          a.wanderA = rand(0, TAU);
        }
        a.homeSleepT = rand(7, 18);
      }
      resolveAnimalWorld(a);
      continue;
    }

    a.wanderT = (a.wanderT || 0) - dt;
    if (a.wanderT <= 0) {
      a.wanderA = rand(0, TAU);
      a.wanderT = rand(1.5, 4.5);

      // A few animals can settle down during the preview, so the world still feels alive.
      const napChance = a.stage === "baby" ? 0.07 :
                        a.stage === "bigmomma" ? 0.12 :
                        a.stage === "superboss" ? 0.045 :
                        a.stage === "boss" ? 0.03 : 0.008;
      if (Math.random() < napChance) {
        a.sleeping = true;
        a.homeSleepT = rand(6, 18);
        resolveAnimalWorld(a);
        continue;
      }
    }

    smoothTurn(a, a.wanderA || 0, dt, 3.2);
    const previewSpeed = (a.speed || animalSpeed(a.type, a.stage, !!a.owned)) *
      (a.stage === "bigmomma" ? 0.55 : 0.48);
    moveFacing(a, previewSpeed, dt);
    a.x = clamp(a.x, 20, WORLD_W - 20);
    a.y = clamp(a.y, 20, WORLD_H - 20);
    resolveAnimalWorld(a);
  }
}


// ---------- particles ----------
function spark(x, y, color, n = 6, speed = 120) {
  if (particles.length > 700) n = Math.min(n, 2);
  for (let i = 0; i < n && particles.length < 900; i++) {
    const a = rand(0, TAU);
    particles.push({
      x, y, vx: Math.cos(a) * rand(20, speed), vy: Math.sin(a) * rand(20, speed),
      life: rand(0.25, 0.55), maxLife: 0.55, color, size: rand(2, 4.5),
    });
  }
}
function floatText(x, y, text, color) {
  if (floaters.length >= 120) floaters.shift();
  floaters.push({ x, y, text, color, life: 0.85, maxLife: 0.85 });
}

// ---------- player helpers ----------
function canAfford(cost) {
  if (!cost) return true;
  return Object.entries(cost).every(([k, v]) => player[k] >= v);
}
function pay(cost) {
  if (!cost) return;
  for (const [k, v] of Object.entries(cost)) player[k] -= v;
}
function costText(cost) {
  if (!cost) return "free";
  return Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(", ");
}

function toggleRide() {
  if (!player.hasSaddle) { banner("You need a saddle first", true); return; }
  if (player.riding) {
    player.riding = null;
    banner("Dismounted");
    return;
  }
  let near = null, nd = 50;
  for (const p of player.pets) {
    if (p.dead || p.stage === "baby") continue;
    const d = dist(player.x, player.y, p.x, p.y);
    if (d < nd) { nd = d; near = p; }
  }
  if (near) {
    player.riding = near;
    banner(`Riding ${petDisplayName ? petDisplayName(near) : PET_TYPES[near.type].name}`);
  } else {
    banner("No rideable adult/boss pet nearby", true);
  }
}

function handleHotkey(key) {
  if (game.over || !game.started) return;
  const items = getHotbarItems();
  const item = items.find(h => h.key === key);
  if (!item || item.empty) return;
  if (item.tool) {
    if (player.owned[item.tool]) {
      player.tool = item.tool;
      player.heldSpecial = null;
    }
  } else if (item.special === "Berry" || item.label === "Berry") {
    selectBerry();
  } else if (item.special === "Saddle" || item.label === "Saddle") {
    toggleRide();
  } else if (item.label === "Wall") {
    placeWall();
  } else if (item.label === "Tower" || item.special === "Tower") {
    const cost = { wood: 12, stone: 6 };
    if (!canAfford(cost)) { banner(`Need ${costText(cost)} for tower`, true); return; }
    pay(cost);
    const a = player.angle;
    if (net.room) { try { net.room.send("build", { kind:"tower", angle:a }); } catch (_) {} }
    else towers.push({ x: player.x + Math.cos(a) * 55, y: player.y + Math.sin(a) * 55, cd: 0.5 });
    sfx.craft(); banner("Watch Tower placed!");
  }
  syncHotbar();
}

function placeWall() {
  if (!canAfford(WALL_COST)) { banner(`Need ${costText(WALL_COST)} for wall`, true); return; }
  pay(WALL_COST);
  const a = player.angle;
  if (net.room) { try { net.room.send("build", { kind:"wall", angle:a }); } catch (_) {} }
  else walls.push({ x: player.x + Math.cos(a) * 48, y: player.y + Math.sin(a) * 48, ttl: -1, r: 20, hp:72, maxHp:72, kind:"wood", spiked:false, ownerId:"local" });
  sfx.craft();
}

let bannerTimer = 0;
let lootPopupTimer = 0;
function banner(text, warn) {
  const el = document.getElementById("banner");
  el.textContent = text;
  el.style.color = warn ? "#f2836a" : "#efe6d2";
  el.classList.add("show");
  bannerTimer = 1.8;
}
function hideLootPopup() {
  if (lootPopupTimer) {
    clearTimeout(lootPopupTimer);
    lootPopupTimer = 0;
  }
  const popup = document.getElementById("lootPopup");
  if (popup) popup.classList.remove("show");
}
function lootRewardIconHTML(reward, big = false) {
  if (!reward) return '<span class="emoji">🎁</span>';
  if (reward.kind === "cubits") return big ? '<span class="loot-token-big"></span>' : '<span class="cubit-token"></span>';
  if (reward.kind === "cards") return `<span class="emoji">${PET_TYPES[reward.species].emoji}</span>`;
  const map = { wood: "🪵", stone: "🪨", gold: "🟡", berries: "🍓" };
  return `<span class="emoji">${map[reward.resource] || "📦"}</span>`;
}
function rewardName(reward) {
  if (reward.kind === "cubits") return "Gold Cubits";
  if (reward.kind === "cards") return PET_TYPES[reward.species].name + " Cards";
  if (reward.resource === "wood") return "Wood";
  if (reward.resource === "stone") return "Stone";
  if (reward.resource === "gold") return "Gold";
  if (reward.resource === "berries") return "Berries";
  return "Reward";
}
function showLootPopup(rewards) {
  if (!rewards || !rewards.length) return;
  hideLootPopup();
  const main = rewards.find(r => r.kind === "cards") || rewards.find(r => r.kind === "cubits") || rewards[0];
  document.getElementById("lootIcon").innerHTML = lootRewardIconHTML(main, true);
  document.getElementById("lootTitle").textContent = main.kind === "cards" ? `${PET_TYPES[main.species].name} Cards!` : main.kind === "cubits" ? "Gold Cubits!" : rewardName(main) + "!";
  document.getElementById("lootSub").textContent = rewards.length > 1 ? "Treasure found inside the chest" : "This chest dropped one main reward";
  document.getElementById("lootLines").innerHTML = rewards.map(r => `<div class="loot-line"><div class="left"><div class="ico">${lootRewardIconHTML(r, false)}</div><div class="nm">${rewardName(r)}</div></div><div class="amt">+${r.amount}</div></div>`).join("");
  document.getElementById("lootPopup").classList.add("show");
  lootPopupTimer = setTimeout(hideLootPopup, 2800);
}
function randomChestCardSpecies() {
  return pickWeighted([
    { v: "dog", w: 2.2 }, { v: "cat", w: 2.2 }, { v: "fox", w: 1.8 }, { v: "rabbit", w: 1.8 },
    { v: "wolf", w: 1.25 }, { v: "bear", w: 1.05 }, { v: "owl", w: 1.1 }, { v: "snake", w: 1.15 },
    { v: "deer", w: 1.1 }, { v: "boar", w: 1.0 }, { v: "saber", w: 0.8 }, { v: "dragon", w: 0.55 }
  ]);
}
function makeChestReward() {
  const roll = Math.random();
  if (roll < 0.34) {
    return { kind: "cubits", amount: Math.random() < 0.1 ? randi(12, 18) : randi(5, 10) };
  }
  if (roll < 0.52) {
    return { kind: "cards", species: randomChestCardSpecies(), amount: Math.random() < 0.14 ? 25 : 10 };
  }
  const resource = pickWeighted([
    { v: "wood", w: 2.8 },
    { v: "stone", w: 2.3 },
    { v: "berries", w: 1.8 },
    { v: "gold", w: 1.1 },
  ]);
  let amount = 0;
  if (resource === "wood") amount = randi(16, 28);
  else if (resource === "stone") amount = randi(12, 22);
  else if (resource === "berries") amount = randi(6, 12);
  else if (resource === "gold") amount = randi(3, 6);
  return { kind: "resource", resource, amount };
}
function awardChestReward(reward) {
  if (!reward) return;
  if (reward.kind === "cubits") meta.servs += reward.amount;
  else if (reward.kind === "cards") {
    if (!meta.speciesCards) meta.speciesCards = {};
    meta.speciesCards[reward.species] = (meta.speciesCards[reward.species] || 0) + reward.amount;
  } else if (reward.kind === "resource") {
    player[reward.resource] = (player[reward.resource] || 0) + reward.amount;
  }
}
function breakChest(chest) {
  if (!chest || chest.opened) return false;
  chest.opened = true;
  chest.hp = 0;
  chest.pulse = 1;
  const reward = chest.reward || makeChestReward();
  awardChestReward(reward);
  saveMeta();
  syncHud();
  syncHotbar();
  buildCardInventory();
  showLootPopup([reward]);
  banner("Chest broken!");
  spark(chest.x, chest.y - 6, "#ffd85f", 18, 130);
  spark(chest.x, chest.y - 10, "#fff2a8", 10, 160);
  spark(chest.x, chest.y, "#9c6a38", 10, 100);
  sfx.chestOpen();
  return true;
}
function hitChest(chest) {
  if (!chest || chest.opened) return false;
  chest.hp -= 1;
  chest.pulse = 1;
  if (chest.hp <= 0) {
    return breakChest(chest);
  }
  const first = chest.chipSide || "wood";
  const second = first === "wood" ? "stone" : "wood";
  const bonus = Math.random() < 0.45;
  player[first] = (player[first] || 0) + 1;
  if (bonus) player[second] = (player[second] || 0) + 1;
  chest.chipSide = second;
  syncHud();
  syncHotbar();
  floatText(chest.x, chest.y - 24, bonus ? `+1 ${first} +1 ${second}` : `+1 ${first}`, first === "wood" ? "#c99a5b" : "#a9b3bd");
  spark(chest.x, chest.y, "#9c6a38", 5, 55);
  sfx.chestHit();
  return true;
}
// ---------- facing check ----------
function isFacing(tx, ty, maxAngle = 0.85) {
  const a = angTo(player.x, player.y, tx, ty);
  return Math.abs(angDiff(player.angle, a)) < maxAngle;
}

// ---------- attacking ----------
function meleeAttack() {
  if (player.heldSpecial === "Berry") {
    if (player.attackCd > 0) return;
    eatBerry();
    return;
  }
  const t = TOOLS[player.tool];
  if (player.attackCd > 0) return;
  // Fists animate quickly, but the opposite hand waits longer before it can punch.
  player.attackCd = t.cadence || t.swing;
  player.punchSide *= -1;
  player.punchTimer = t.swing;
  player.swingWeapon = player.tool;

  let hitSomething = false;
  let materialHit = false;
  if (net.room) {
    // Include the locally aimed animal id. The server still validates range/facing,
    // but this removes ambiguity and makes sleeping animals just as punchable as awake ones.
    let aimedAnimalId = "";
    for (const a of animals) {
      if (a.dead || !a.netId) continue;
      const ah = animalBodyHitboxes(a).find(h =>
        dist(player.x, player.y, h.x, h.y) < t.range + h.r + 8 && isFacing(h.x, h.y, 1.15)
      );
      if (ah) { aimedAnimalId = a.netId; break; }
    }
    try { net.room.send("attack", { tool: player.tool || "Fist", angle: player.angle, animalId: aimedAnimalId }); } catch (_) {}
  }
  if (!net.room) {
  for (const en of enemies) {
    if (en.dead) continue;
    const d = dist(player.x, player.y, en.x, en.y);
    if (d < t.range + en.r && isFacing(en.x, en.y)) {
      let dmg = t.dmg * runDamageMul();
      const crit = Math.random() < 0.15;
      if (crit) dmg *= 2;
      damageEnemy(en, dmg, crit);
      hitSomething = true;
    }
  }
  for (const a of animals) {
    if (a.dead || (a.owned && !a.releasedWild)) continue;
    const info = PET_TYPES[a.type];
    const ah = animalBodyHitboxes(a).find(h => dist(player.x, player.y, h.x, h.y) < t.range + h.r && isFacing(h.x, h.y));
    if (ah) {
      let dmg = t.dmg * runDamageMul();
      const crit = Math.random() < 0.12;
      if (crit) dmg *= 2;
      dmg = animalDamageTaken(a.type, a.stage, dmg);
      a.hp -= dmg;
      a.flash = 0.12;
      markCreatureHit(a, 4.2);
      a.sleeping = false;
      a.enraged = true;
      a.combat = 8;
      const shouldFleeFirst = !!(a.stage === "baby" || info.flee);
      const lowHealthFight = shouldFleeFirst && a.hp > 0 && a.hp / a.maxHp <= 0.32;
      if (lowHealthFight) {
        // Skittish animals stop running once badly hurt and fight back against whoever hurt them.
        a.desperateAggro = true;
        a.fleeUntil = 0;
        a.fleeFrom = null;
        a.hostileTarget = player;
      } else if (shouldFleeFirst && !a.tameFailedAggro) {
        a.hostileTarget = null;
        a.fleeFrom = player;
        a.fleeUntil = game.time + 4;
        a.wanderA = angTo(player.x, player.y, a.x, a.y);
      } else {
        a.fleeUntil = 0;
        a.fleeFrom = null;
        a.hostileTarget = player;
      }
      for (const pet of player.pets) {
        if (!pet.dead) pet.combat = 7;
      }
      spark(a.x, a.y, crit ? "#ffe08a" : "#e0563f", 6, 90);
      floatText(a.x, a.y - a.r - 8, (crit ? "CRIT " : "") + Math.round(dmg), crit ? "#ffe08a" : "#f2836a");
      hitSomething = true;
      if (a.hp <= 0) {
        a.hp = 0;
        a.dead = true;
        if (a.releasedWild) {
          a.hostileTarget = null;
          a.combat = 0;
          floatText(a.x, a.y - a.r - 24, "DEFEATED", "#efe6d2");
        }
        game.kills++;
        const drop = pickWeighted([{ v: "wood", w: 2 }, { v: "stone", w: 2 }, { v: "gold", w: 1 }]);
        player[drop] += drop === "gold" ? 1 : 2;
        floatText(a.x, a.y - 20, "+" + (drop === "gold" ? 1 : 2) + " " + drop, "#efe6d2");
        spark(a.x, a.y, info.color, 12, 120);
        if (Math.random() < Math.min(.35, .08 * runCardChanceMul())) {
          if (!meta.speciesCards) meta.speciesCards = {};
          meta.speciesCards[a.type] = (meta.speciesCards[a.type] || 0) + 1;
          saveMeta();
          floatText(a.x, a.y - 38, `+1 ${PET_TYPES[a.type].name} Card!`, "#c77dff");
        }
        for (const pet of player.pets) {
          if (!pet.dead && dist(pet.x, pet.y, a.x, a.y) < 160) givePetExp(pet, petKillXpForAnimal(a));
        }
      }
    }
  }
  let bestChest = null, bestChestD = Infinity;
  for (const chest of chests) {
    if (chest.opened) continue;
    const ch = chestSolidHitbox(chest);
    const d = dist(player.x, player.y, ch.x, ch.y);
    if (d < t.range + ch.r + 8 && isFacing(ch.x, ch.y, 1.15) && d < bestChestD) {
      bestChest = chest;
      bestChestD = d;
    }
  }
  if (bestChest) {
    hitChest(bestChest);
    hitSomething = true;
    materialHit = true;
  }
  }
  if (!net.room && !hitSomething) {
    let bestWall = null, bestWallD = Infinity;
    for (const w of walls) {
      if ((w.hp ?? 1) <= 0) continue;
      const d = dist(player.x, player.y, w.x, w.y);
      if (d < t.range + w.r + 4 && isFacing(w.x, w.y, 1.12) && d < bestWallD) {
        bestWall = w; bestWallD = d;
      }
    }
    if (bestWall) {
      const wallDmg = wallDamageForTool(player.tool || "Fist", bestWall);
      bestWall.hp = Math.max(0, (bestWall.hp ?? bestWall.maxHp ?? 72) - wallDmg);
      bestWall.flash = 0.12;
      spark(bestWall.x, bestWall.y, bestWall.kind === "stoneSpike" ? "#d9e0e6" : "#c99a5b", 5, 65);
      floatText(bestWall.x, bestWall.y - bestWall.r - 8, `-${Math.round(wallDmg)}`, "#efe6d2");
      if (bestWall.hp <= 0) spark(bestWall.x, bestWall.y, bestWall.kind === "stoneSpike" ? "#a9b3bd" : "#a9744f", 12, 110);
      hitSomething = true;
    }
  }
  for (const r of resources) {
    if (!r.alive) continue;
    let resourceHit = false;
    if (r.type === "log") {
      resourceHit = logSolidHitboxes(r).some(h =>
        dist(player.x, player.y, h.x, h.y) < t.range + h.r + 5 &&
        isFacing(h.x, h.y, 1.1)
      );
    } else {
      const c = resourceSolidCenter(r);
      const d = dist(player.x, player.y, c.x, c.y);
      const hitR = r.type === "tree" ? r.solidR + 8 : r.solidR + 6;
      resourceHit = d < t.range + hitR && isFacing(c.x, c.y, 1.1);
    }
    if (resourceHit) {
      if (r.type === "bush") { eatBush(r); hitSomething = true; materialHit = true; continue; }
      gatherResource(r, t); hitSomething = true; materialHit = true;
    }
  }
  for (const g of queryStaticNearby("gold", player.x, player.y, 260)) {
    if (!g.infinite && g.goldLeft <= 0) continue;
    const gh = goldSolidHitbox(g);
    const d = dist(player.x, player.y, gh.x, gh.y);
    if (d < t.range + gh.r && isFacing(gh.x, gh.y, 1.0)) {
      if (net.room && g.netId) {
        try { net.room.send("goldHit", { id: g.netId, tool: player.tool || "Fist" }); } catch (e) {}
        g.pulse = 1;
        spark(g.x, g.y, g.pure ? "#fff19a" : "#ffd23f", 3, 45);
        sfx.goldHit();
        hitSomething = true;
        materialHit = true;
        continue;
      }
      let take = 0;
      if ((player.tool || "Fist") === "Fist") {
        // Bare hands only chip tiny flakes off gold. About 9 punches per gold.
        g.handGatherCredit = (g.handGatherCredit || 0) + 0.12;
        if (g.handGatherCredit >= 1) {
          take = 1;
          g.handGatherCredit -= 1;
          if (!g.infinite) take = Math.min(take, g.goldLeft);
        }
      } else {
        const amt = g.pure ? 3 : g.size === "huge" ? randi(2, 4) : 1;
        take = g.infinite ? amt : Math.min(amt, g.goldLeft);
      }
      if (take > 0) {
        if (!g.infinite) g.goldLeft -= take;
        player.gold += Math.max(1, Math.round(take * runGatherMul()));
        floatText(g.x, g.y - g.r - 8, "+" + take + (g.pure ? " PURE GOLD" : " gold"), "#f2c94c");
      } else if ((player.tool || "Fist") === "Fist") {
        floatText(g.x, g.y - g.r - 8, "tiny chip", "#d8bd65");
      }
      g.pulse = 1;
      spark(g.x, g.y, g.pure ? "#fff19a" : "#ffd23f", take > 0 ? (g.pure ? 12 : 6) : 3, take > 0 ? (g.pure ? 135 : 90) : 45);
      sfx.goldHit();
      hitSomething = true;
      materialHit = true;
    }
  }
  // The little fist beep is for punches in the air or against creatures.
  // Material hits use only their own wood/stone/gold/chest sound.
  if (player.tool === "Fist") {
    if (!materialHit) sfx.hit();
  } else {
    if (hitSomething && !materialHit) sfx.hit();
    else if (!hitSomething) sfx.chop();
  }
}

function gatherResource(r, t) {
  const toolName = player.tool || "Fist";
  const isWood = r.type === "tree" || r.type === "log";

  if (net.room && r.netId) {
    r.pulse = 1;
    try { net.room.send("resourceHit", { id: r.netId, tool: toolName }); } catch (e) {}
    const col = isWood ? "#c99a5b" : "#a9b3bd";
    spark(r.x, r.y, col, 4, 55);
    if (r.type === "tree") sfx.treeHit();
    else if (r.type === "log") sfx.logHit();
    else sfx.stoneHit();
    return;
  }
  const correctAxe = toolName === "Axe" && isWood;
  const correctPick = toolName === "Pickaxe" && r.type === "rock";

  // Breaking speed is separate from combat damage. Correct tools chew through
  // their matching resource; swords barely scratch resources.
  let resourceDmg = t.resourcePower == null ? 1 : t.resourcePower;
  if (r.type === "log") resourceDmg *= 1.35; // fallen logs are easier to break than standing trees
  if (toolName === "Fist") resourceDmg *= (r.type === "log" ? 1.25 : 0.82);
  if (toolName === "Axe" && !correctAxe) resourceDmg *= 0.32;
  if (toolName === "Pickaxe" && !correctPick) resourceDmg *= 0.32;
  r.hp -= resourceDmg;
  r.pulse = 1;

  const resKey = isWood ? "wood" : "stone";
  let yieldAmount = 1;
  if (r.type === "log") {
    // Logs are the beginner-friendly wood source: useful wood on every hit.
    if (toolName === "Fist") yieldAmount = 2;
    else if (correctAxe) yieldAmount = 6;
    else if (toolName === "Sword") yieldAmount = 1;
    else yieldAmount = 2;
  } else if (correctAxe) yieldAmount = t.gather;          // much more wood than punching
  else if (correctPick) yieldAmount = t.gather;   // much more stone with pickaxe
  else if (toolName === "Fist") yieldAmount = t.gather; // tiny hand-harvest yield
  else if (toolName === "Sword") yieldAmount = 0.12; // intentionally awful harvesting
  else if (toolName === "Bow") yieldAmount = 0.35;
  else if (toolName === "Axe" || toolName === "Pickaxe") yieldAmount = 0.45;

  // Fractional poor-tool yields accumulate on the resource and only pay out whole materials.
  yieldAmount *= runGatherMul();
  r.gatherCredit = (r.gatherCredit || 0) + yieldAmount;
  const wholeYield = Math.floor(r.gatherCredit + 1e-6);
  if (wholeYield > 0) {
    r.gatherCredit -= wholeYield;
    player[resKey] += wholeYield;
    const col = resKey === "wood" ? "#c99a5b" : "#a9b3bd";
    floatText(r.x, r.y - 20, "+" + wholeYield, col);
  } else if (toolName === "Sword") {
    floatText(r.x, r.y - 20, "tiny chip", "#b7aa98");
  }

  const col = resKey === "wood" ? "#c99a5b" : "#a9b3bd";
  spark(r.x, r.y, col, correctAxe || correctPick ? 7 : 4, correctAxe || correctPick ? 95 : 55);
  if (r.type === "tree") sfx.treeHit();
  else if (r.type === "log") sfx.logHit();
  else if (resKey === "wood") sfx.logHit();
  else sfx.stoneHit();
  if (r.hp <= 0) {
    r.alive = false;
    r.gatherCredit = 0;
    r.respawnAt = game.time + rand(12, 22);
  }
}

function eatBush(r) {
  if (!r.alive) return;
  if (net.room && r.netId) {
    r.pulse = 1;
    try { net.room.send("resourceHit", { id: r.netId, tool: player.tool || "Fist" }); } catch (e) {}
    spark(r.x, r.y, "#d1315c", 5, 65);
    sfx.bushHit();
    return;
  }
  // Every hit shakes berries loose, while the bush itself still takes damage and can break.
  const t = TOOLS[player.tool] || TOOLS.Fist;
  r.hp -= Math.max(0.5, t.gather * 0.9);
  r.pulse = 1;

  const berries = randi(1, 2);
  player.berries = (player.berries || 0) + berries;
  spark(r.x, r.y, "#d1315c", 5, 65);
  floatText(r.x, r.y - 20, "+" + berries + " berries", "#f283a6");
  sfx.bushHit();

  if (r.hp <= 0) {
    r.alive = false;
    r.respawnAt = game.time + rand(14, 22);
    spark(r.x, r.y, "#7be08a", 7, 80);
  }
  syncHud();
  syncHotbar();
}
function selectBerry() {
  if ((player.berries || 0) < 1) { banner("No berries to hold!", true); return; }
  player.heldSpecial = "Berry";
  player.tool = "Fist";
  banner("Berry equipped — click to eat");
  syncHotbar();
}
function eatBerry() {
  if ((player.berries || 0) < 1) {
    player.heldSpecial = null;
    banner("No berries!", true);
    syncHotbar();
    return;
  }
  player.berries--;
  player.health = clamp(player.health + 22, 0, player.maxHealth);
  if (net.room) { try { net.room.send("heal", { amount: 22 }); } catch (_) {} }
  player.attackCd = Math.max(player.attackCd, 0.3);
  player.punchTimer = 0.22;
  player.swingWeapon = "Fist";
  floatText(player.x, player.y - 28, "+22", "#7be08a");
  sfx.eat();
  if (player.berries <= 0) {
    player.heldSpecial = null;
    banner("Last berry eaten");
  }
  syncHud();
  syncHotbar();
}

function fireBow() {
  if (game.over || !game.started || player.tool !== "Bow" || player.shootCd > 0 || player.wood < 1) return;
  player.wood -= 1; player.shootCd = 0.45;
  player.punchTimer = 0.18; player.swingWeapon = "Bow";
  const a = player.angle;
  if (net.room) {
    try { net.room.send("shoot", { angle: a }); } catch (_) {}
  } else {
    projectiles.push({
      x: player.x + Math.cos(a) * 26, y: player.y + Math.sin(a) * 26,
      vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, life: 1.15, r: 5,
    });
  }
  sfx.shoot();
}

function damageEnemy(en, dmg, crit, attacker = player) {
  en.hp -= dmg; en.flash = 0.12;
  en.revengeTarget = (attacker && combatTargetAlive(attacker)) ? attacker : player;
  const knock = 7;
  const a = angTo(player.x, player.y, en.x, en.y);
  en.x += Math.cos(a) * knock; en.y += Math.sin(a) * knock;
  spark(en.x, en.y, crit ? "#ffe08a" : "#e0563f", crit ? 10 : 5, 100);
  floatText(en.x, en.y - en.r - 8, (crit ? "CRIT " : "") + Math.round(dmg), crit ? "#ffe08a" : "#f2836a");
  if (en.hp <= 0 && !en.dead) {
    setKilledBy(en, source || player);
    en.dead = true;
    game.kills++;
    const drop = pickWeighted([{ v: "wood", w: 3 }, { v: "stone", w: 2 }, { v: "gold", w: 1 }]);
    player[drop] += drop === "gold" ? 1 : 2;
    spark(en.x, en.y, en.armed ? "#8f2e6b" : "#e0563f", 14, 160);
    floatText(en.x, en.y - 20, "+" + (drop === "gold" ? 1 : 2) + " " + drop, "#efe6d2");
    // chance for a species-specific pet card
    if (Math.random() < Math.min(.45, 0.1 * runCardChanceMul())) {
      const species = pickWeighted([
        { v: "dog", w: 2 }, { v: "cat", w: 2 }, { v: "rabbit", w: 2 },
        { v: "fox", w: 2 }, { v: "dragon", w: 1 }, { v: "wolf", w: 1 }, { v: "bear", w: 1 },
      ]);
      if (!meta.speciesCards) meta.speciesCards = {};
      meta.speciesCards[species] = (meta.speciesCards[species] || 0) + 1;
      saveMeta();
      const nm = PET_TYPES[species].name;
      floatText(en.x, en.y - 36, `+1 ${nm} Card!`, "#c77dff");
      const need = cardsNeeded(species);
      banner(`Found a ${nm} Card! (${meta.speciesCards[species]}/${need})`);
    }
    // pets that helped (nearby) gain exp
    for (const pet of player.pets) {
      if (pet.dead) continue;
      if (dist(pet.x, pet.y, en.x, en.y) < 160) {
        givePetExp(pet, petKillXpForEnemy(en));
      }
    }
  }
}

// ---------- enemies ----------
function spawnOfflineEnemyGuard(en, strong, rider=false) {
  const riderTypes = strong ? ["wolf","boar","bear","saber"] : ["wolf","boar","dog","saber"];
  const guardTypes = strong ? ["wolf","dog","boar","fox","bear"] : ["dog","fox","wolf","cat","boar"];
  const list = rider ? riderTypes : guardTypes;
  const type = list[randi(0, list.length - 1)];
  const stage = rider ? ((strong && Math.random() < 0.30) ? "boss" : "adult") : ((strong && Math.random() < 0.24) ? "boss" : "adult");
  const r = animalRadius(type, stage);
  const hp = typeHp(type, stage);
  const coats = PET_TYPES[type].coats || [PET_TYPES[type].color];
  const coat = coats[randi(0, coats.length - 1)];
  const ang = rand(0, TAU);
  const stand = en.r + r * 0.75 + 20;
  const guard = {
    type, stage,
    x: rider ? en.x : en.x + Math.cos(ang) * stand,
    y: rider ? en.y : en.y + Math.sin(ang) * stand,
    angle: en.angle || 0, r, hp, maxHp: hp, coat, spots: [], spotCol: shadeColor(coat,-30),
    speed: animalSpeed(type, stage, false), sleeping:false, tameProgress:0, owned:false, follow:false,
    abilityCd:rand(3,infoAbilityCd(type)), targetX:null,targetY:null,wanderT:rand(.7,2),wanderA:rand(0,TAU),
    flash:0,dead:false,tailPhase:rand(0,TAU),atkCd:0,combat:9999,exp:0,level:1,recentHit:0,attackAnim:0,
    fleeUntil:0,enraged:true,tameFailedAggro:true,desperateAggro:false,
    enemyOwner: en, enemyRider: rider,
  };
  animals.push(guard);
  en.guardPet = guard;
  if (rider) en.ridingPet = guard;
  return guard;
}

function spawnEnemy(strong) {
  // Raiders spawn from random locations across the whole world instead of
  // orbiting the player's current position. Prefer points that are not right
  // on top of the player so a random world spawn never feels like a pop-in.
  let x = rand(60, WORLD_W - 60);
  let y = rand(60, WORLD_H - 60);
  for (let tries = 0; tries < 24; tries++) {
    const tx = rand(60, WORLD_W - 60);
    const ty = rand(60, WORLD_H - 60);
    x = tx; y = ty;
    if (dist(tx, ty, player.x, player.y) >= 560) break;
  }

  const roll = Math.random();
  let weapon = "Fist";
  if (strong) {
    if (roll < 0.38) weapon = "Bow";
    else if (roll < 0.68) weapon = "Staff";
    else weapon = "Sword";
  } else {
    if (roll < 0.18) weapon = "Bow";
    else if (roll < 0.28) weapon = "Staff";
    else if (roll < 0.57) weapon = "Sword";
  }
  let ranged = weapon === "Bow" || weapon === "Staff";
  let armed = weapon !== "Fist";
  let speed = (strong ? rand(54,96) : rand(48,92)) * (weapon === "Staff" ? .94 : weapon === "Bow" ? .98 : weapon === "Sword" ? 1.03 : 1);
  let dmg = weapon === "Bow" ? (strong ? rand(11,16) : rand(8,12)) :
            weapon === "Staff" ? (strong ? rand(13,18) : rand(9,13)) :
            weapon === "Sword" ? (strong ? rand(14,20) : rand(9,14)) : (strong ? rand(8,12) : rand(4,8));
  const hpBase = weapon === "Bow" ? (strong ? 40 : 24) : weapon === "Staff" ? (strong ? 48 : 28) : weapon === "Sword" ? (strong ? 44 : 28) : (strong ? 34 : 18);
  let hp = hpBase + game.wave * (strong ? 3.9 : 3.2);
  let hue = strong ? (weapon === "Bow" ? "#4b5dcf" : weapon === "Staff" ? "#6b1a8f" : "#6b1a4a") : (weapon === "Bow" ? "#3f76b5" : weapon === "Staff" ? "#7c47a8" : weapon === "Sword" ? "#8f2e6b" : "#e0563f");
  const hasGuard = Math.random() < (strong ? .26 : .30);
  const rider = hasGuard && Math.random() < (strong ? .36 : .28);
  if (hasGuard) { hp *= .64; dmg *= .72; hue = strong ? "#5d596d" : "#786060"; }
  if (rider) { hp *= .58; dmg *= .48; weapon = "Fist"; ranged = false; armed = false; speed *= .82; hue = strong ? "#434858" : "#595451"; }
  const en = {
    x,y,angle:0,r:strong?20:17,speed,armed,ranged,strong,weapon,dmg,hp,maxHp:hp,
    atkCd:rand(.15,.9),flash:0,dead:false,wanderA:rand(0,TAU),wanderT:rand(.6,2),hue,
    attackAnim:0,strafeDir:Math.random()<.5?-1:1,strafeT:rand(.6,1.5),hasGuard,guardPet:null,ridingPet:null,
  };
  enemies.push(en);
  if (hasGuard) spawnOfflineEnemyGuard(en,strong,rider);
}

function resolveEnemyWorld(en) {
  for (const r of queryStaticNearby("resources", en.x, en.y, 180)) {
    if (!r.alive) continue;
    if (r.type === "log") {
      const hit = deepestResourceOverlap(r, en.x, en.y, en.r * 0.9);
      if (hit && hit.d > 0.1) {
        const ang = angTo(hit.h.x, hit.h.y, en.x, en.y);
        en.x += Math.cos(ang) * hit.overlap;
        en.y += Math.sin(ang) * hit.overlap;
      }
    } else {
      const solid = r.solidR * 0.85;
      const c = resourceSolidCenter(r);
      const d = dist(en.x, en.y, c.x, c.y);
      if (d < solid + en.r && d > 0.1) {
        const ang = angTo(c.x, c.y, en.x, en.y);
        en.x = c.x + Math.cos(ang) * (solid + en.r);
        en.y = c.y + Math.sin(ang) * (solid + en.r);
      }
    }
  }
  for (const w of walls) {
    const wd = dist(en.x, en.y, w.x, w.y);
    if (wd < w.r + en.r && wd > 0.1) {
      const pushA = angTo(w.x, w.y, en.x, en.y);
      en.x = w.x + Math.cos(pushA) * (w.r + en.r);
      en.y = w.y + Math.sin(pushA) * (w.r + en.r);
    }
  }
  for (const c of queryStaticNearby("chests", en.x, en.y, 100)) {
    if (c.opened) continue;
    const ch = chestSolidHitbox(c);
    const d = dist(en.x, en.y, ch.x, ch.y);
    if (d < ch.r + en.r * 0.92 && d > 0.1) {
      const pushA = angTo(ch.x, ch.y, en.x, en.y);
      en.x = ch.x + Math.cos(pushA) * (ch.r + en.r * 0.92);
      en.y = ch.y + Math.sin(pushA) * (ch.r + en.r * 0.92);
    }
  }

  // Hostile cubes cannot pass through wild animals or owned pets.
  // Use each creature's body hitbox so the collision matches its visible body.
  for (const a of animals.concat(player.pets)) {
    if (!a || a.dead) continue;
    const hit = deepestAnimalCircleOverlap(a, en.x, en.y, en.r * 0.9);
    if (hit) {
      const {h,d,overlap} = hit;
      let pushA = d > 0.1 ? angTo(h.x, h.y, en.x, en.y) : (en.angle || 0) + Math.PI;
      en.x += Math.cos(pushA) * overlap;
      en.y += Math.sin(pushA) * overlap;
    }
  }

  // push away from other enemies a little
  for (const o of enemies) {
    if (o === en || o.dead) continue;
    const d = dist(en.x, en.y, o.x, o.y);
    if (d < en.r + o.r && d > 0.1) {
      const ang = angTo(o.x, o.y, en.x, en.y);
      en.x += Math.cos(ang) * 1.5;
      en.y += Math.sin(ang) * 1.5;
    }
  }
}

function smoothTurn(obj, targetAngle, dt, turnSpeed = 9) {
  let diff = targetAngle - obj.angle;
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  const maxStep = turnSpeed * dt;
  obj.angle += clamp(diff, -maxStep, maxStep);
  while (obj.angle > Math.PI) obj.angle -= TAU;
  while (obj.angle < -Math.PI) obj.angle += TAU;
}
function moveFacing(obj, speed, dt) {
  // Creatures actually travel in the direction they are looking instead of sliding sideways.
  obj.x += Math.cos(obj.angle || 0) * speed * dt;
  obj.y += Math.sin(obj.angle || 0) * speed * dt;

  // Visual animation uses the animal's ACTUAL current travel speed.
  // The timestamp lets the motion fade to idle immediately when movement stops.
  obj._visualMoveSpeed = Math.max(0, Number(speed) || 0);
  obj._visualMoveAt = performance.now();
}


function combatTargetAlive(t) {
  if (!t) return false;
  if (t === player) return !player.dead && !game.over;
  return !t.dead && (t.hp == null || t.hp > 0);
}
function retargetAfterOwnedPetFalls(killer, fallenPet = null) {
  if (!killer || killer.dead) return;
  let retarget = null;
  for (const pet of player.pets) {
    if (pet.dead || pet === fallenPet) continue;
    if (pet.forcedTarget === killer) { retarget = pet; break; }
    if (pet.huntTarget && pet.huntTarget.obj === killer) { retarget = pet; break; }
  }
  if (!retarget && !player.dead) retarget = player;
  if (!retarget) return;
  if (killer.revengeTarget !== undefined) killer.revengeTarget = retarget;
  if (killer.hostileTarget !== undefined) {
    killer.hostileTarget = retarget;
    killer.fleeUntil = 0;
    killer.fleeFrom = null;
    killer.enraged = true;
    killer.sleeping = false;
  }
}
function setPetAttackerTarget(pet, attacker) {
  if (!pet || pet.dead || !attacker || attacker === pet) return;
  pet.forcedTarget = attacker;
  pet.forcedTargetAutoDefense = true;
  pet.combat = Math.max(pet.combat || 0, 9999);
  pet.followReturning = false;
}
function wildlifeHitByPet(target, pet) {
  if (!target || target.dead || target.owned || !pet || pet.dead) return;
  const info = PET_TYPES[target.type];
  target.sleeping = false;
  target.enraged = true;
  target.combat = Math.max(target.combat || 0, 8);
  markCreatureHit(target, 3.8);

  const shouldFleeFirst = !!(target.stage === "baby" || (info && info.flee));
  const lowHealthFight = shouldFleeFirst && target.hp > 0 && target.hp / target.maxHp <= 0.32;
  if (lowHealthFight) {
    // A skittish animal that gets badly hurt turns on the PET that hurt it.
    target.desperateAggro = true;
    target.fleeUntil = 0;
    target.fleeFrom = null;
    target.hostileTarget = pet;
  } else if (shouldFleeFirst && !target.tameFailedAggro && !target.desperateAggro) {
    // Skittish wildlife runs from the actual pet attacker, not from the player.
    target.hostileTarget = null;
    target.fleeFrom = pet;
    target.fleeUntil = game.time + 4;
  } else {
    // Wildlife that fights back locks onto the pet that actually attacked it.
    target.fleeUntil = 0;
    target.fleeFrom = null;
    target.hostileTarget = pet;
  }
}
function damageCreatureFromEnemy(creature, enemy, dmg) {
  if (!creature || creature.dead || !enemy || enemy.dead) return;
  dmg = animalDamageTaken(creature.type, creature.stage, dmg);
  creature.hp -= dmg;
  creature.flash = 0.16;
  markCreatureHit(creature, 4.2);
  spark(creature.x, creature.y, "#e0563f", 6, 75);
  if (creature.owned) {
    setPetAttackerTarget(creature, enemy);
    if (creature.hp <= 0) defeatOwnedPet(creature, enemy);
  } else {
    creature.sleeping = false;
    creature.enraged = true;
    creature.fleeUntil = 0;
    creature.hostileTarget = enemy;
    creature.combat = Math.max(creature.combat || 0, 8);
    if (creature.hp <= 0) creature.dead = true;
  }
  enemy.revengeTarget = creature.dead ? null : creature;
}
function wildCombatTarget(a) {
  if (a && a.hostileTarget && combatTargetAlive(a.hostileTarget)) return a.hostileTarget;
  return (!player.dead && !game.over) ? player : null;
}

function wildAttackConnects(attacker, target) {
  // Works for player, hostile-cube, pet, AND wild-animal targets.
  if (!attacker || !target || !combatTargetAlive(target)) return false;
  if (animalHeadTouchesTarget(attacker, target)) return true;

  // Physical animal-vs-animal resolution can keep two creatures a few pixels
  // apart even while they are clearly face-to-face. Give bites a small,
  // shape-aware grace range so combat doesn't stall forever.
  const tr = target === player ? PLAYER_R : Math.max(10, Number(target.r) || 16);
  const reach = Math.max(18, (attacker.r || 18) * 0.78 + tr * 0.72 + 10);
  const d = dist(attacker.x, attacker.y, target.x, target.y);
  if (d > reach) return false;
  const face = angTo(attacker.x, attacker.y, target.x, target.y);
  let diff = face - (attacker.angle || 0);
  while (diff > Math.PI) diff -= TAU;
  while (diff < -Math.PI) diff += TAU;
  return Math.abs(diff) < 0.78;
}

const WILD_FIGHT_GRID_SIZE = 260;
let wildFightGridFrame = -1;
let wildFightAnimalGrid = new Map();
let wildFightEnemyGrid = new Map();
function wildFightGridKey(x, y) {
  return `${Math.floor(x / WILD_FIGHT_GRID_SIZE)},${Math.floor(y / WILD_FIGHT_GRID_SIZE)}`;
}
function rebuildWildFightGrid() {
  const frameId = Math.floor(performance.now() / 120);
  if (wildFightGridFrame === frameId) return;
  wildFightGridFrame = frameId;
  wildFightAnimalGrid = new Map();
  wildFightEnemyGrid = new Map();
  for (const other of animals) {
    if (!other || other.dead || other.owned || other.enemyOwner || other.stage === "baby") continue;
    const k = wildFightGridKey(other.x, other.y);
    let bucket = wildFightAnimalGrid.get(k);
    if (!bucket) wildFightAnimalGrid.set(k, bucket = []);
    bucket.push(other);
  }
  for (const en of enemies) {
    if (!en || en.dead) continue;
    const k = wildFightGridKey(en.x, en.y);
    let bucket = wildFightEnemyGrid.get(k);
    if (!bucket) wildFightEnemyGrid.set(k, bucket = []);
    bucket.push(en);
  }
}
function nearbyWildFightCandidates(grid, x, y) {
  const cx = Math.floor(x / WILD_FIGHT_GRID_SIZE), cy = Math.floor(y / WILD_FIGHT_GRID_SIZE);
  const out = [];
  for (let gx = cx - 1; gx <= cx + 1; gx++) {
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const bucket = grid.get(`${gx},${gy}`);
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

function chooseWildlifeFightTarget(a) {
  if (!a || a.dead || a.owned || a.stage === "baby") return null;
  const info = PET_TYPES[a.type] || {};
  const naturallyAggressive = !info.friendly && a.type !== "fox";
  if (!naturallyAggressive && !a.enraged && !a.desperateAggro && !a.tameFailedAggro) return null;

  rebuildWildFightGrid();
  let best = null;
  let bestD = 230;

  // Hostile cubes are always valid wildlife opponents.
  for (const en of nearbyWildFightCandidates(wildFightEnemyGrid, a.x, a.y)) {
    if (!en || en.dead) continue;
    const d = dist(a.x, a.y, en.x, en.y);
    if (d < bestD) {
      bestD = d;
      best = en;
    }
  }

  // Nearby wild animals can fight each other too. Avoid babies and animals
  // owned by hostile cubes so we don't accidentally make guard ownership weird.
  for (const other of nearbyWildFightCandidates(wildFightAnimalGrid, a.x, a.y)) {
    if (!other || other === a || other.dead || other.owned || other.enemyOwner || other.stage === "baby") continue;
    const d = dist(a.x, a.y, other.x, other.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}
function damageTargetFromWild(attacker, target, dmg) {
  if (!attacker || attacker.dead || !target || !combatTargetAlive(target)) return false;
  if (target === player) {
    hitPlayer(dmg, attacker);
    return true;
  }
  if (target.owned) dmg = animalDamageTaken(target.type, target.stage, dmg);
  target.hp -= dmg;
  target.flash = 0.12;
  if (target.owned) {
    markCreatureHit(target, 4.0);
    setPetAttackerTarget(target, attacker);
    if (target.hp <= 0) defeatOwnedPet(target, attacker);
  } else if (enemies.includes(target)) {
    target.revengeTarget = attacker;
    if (target.hp <= 0 && !target.dead) damageEnemy(target, 0, false, attacker);
  } else {
    target.sleeping = false;
    target.enraged = true;
    target.fleeUntil = 0;
    target.hostileTarget = attacker;
    target.combat = Math.max(target.combat || 0, 8);
    if (target.hp <= 0) { setKilledBy(target, attacker); target.dead = true; }
  }
  return true;
}
function petLockedCombat(p, target, dt) {
  if (!combatTargetAlive(target)) {
    p.forcedTarget = null;
    p.forcedTargetAutoDefense = false;
    p.combat = 0;
    p.follow = true;
    p.followReturning = true;
    return false;
  }

  // Automatic retaliation must never drag pets across the world.
  // If the fight gets too far from the owner, drop it and return immediately.
  if (p.forcedTargetAutoDefense) {
    const ownerDist = dist(p.x, p.y, player.x, player.y);
    const targetOwnerDist = dist(target.x, target.y, player.x, player.y);
    const breakRange = 430;
    if (ownerDist > breakRange || targetOwnerDist > breakRange + 70) {
      p.forcedTarget = null;
      p.forcedTargetAutoDefense = false;
      p.combat = 0;
      p.follow = true;
      p.followReturning = true;
      p.targetX = null;
      p.targetY = null;
      return false;
    }
  }

  const targetIsAnimal = target !== player && target.type && !enemies.includes(target);
  const a = angTo(p.x, p.y, target.x, target.y);
  smoothTurn(p, a, dt, 5.2);
  const headOnTarget = animalHeadTouchesTarget(p, target);
  if (!headOnTarget) {
    moveFacing(p, p.speed * 1.28, dt);
  } else if (p.atkCd <= 0) {
    const rawDmg = petAtkDmg(p);
    const dmg = targetIsAnimal ? animalDamageTaken(target.type, target.stage, rawDmg) : rawDmg;
    target.hp -= dmg;
    target.flash = 0.12;
    p.atkCd = animalAttackCooldown(p.type, p.stage, true);
    p.attackAnim = 0.18;
    spark(target.x, target.y, "#7be08a", 5, 80);
    floatText(target.x, target.y - target.r - 6, Math.round(dmg), "#7be08a");
    if (targetIsAnimal) {
      wildlifeHitByPet(target, p);
    } else {
      target.revengeTarget = p;
    }
    if (target.hp <= 0 && !target.dead) {
      if (targetIsAnimal) {
        setKilledBy(target, p);
        target.dead = true;
        game.kills++;
        givePetExp(p, petKillXpForAnimal(targetEn));
        spark(target.x, target.y, PET_TYPES[target.type].color, 10, 100);
      } else {
        damageEnemy(target, 0, false, p);
        givePetExp(p, petKillXpForEnemy(targetEn));
      }
      p.forcedTarget = null;
      p.forcedTargetAutoDefense = false;
      p.combat = 0;
      p.follow = true;
      p.followReturning = true;
    }
  }
  return true;
}

function updateEnemies(dt) {
  const phase = TIME_PHASES[game.phaseIdx];
  for (const en of enemies) {
    if (en.dead) continue;
    if (en.flash > 0) en.flash -= dt;
    if (en.atkCd > 0) en.atkCd -= dt;
    en.attackAnim = Math.max(0, (en.attackAnim || 0) - dt);

    if (en.ridingPet && en.ridingPet.dead) en.ridingPet = null;
    // SUN KILL — daytime burns hostile cubes that didn't escape.
    if (phase.safe) {
      en.sunDmg = (en.sunDmg || 0) + dt;
      const cx = WORLD_W / 2, cy = WORLD_H / 2;
      const toEdge = angTo(cx, cy, en.x, en.y);
      en.wanderA = toEdge;
      if (en.ridingPet) {
        const m=en.ridingPet;smoothTurn(m,toEdge,dt,12);moveFacing(m,m.speed*1.35,dt);resolveAnimalWorld(m);en.x=m.x;en.y=m.y;en.angle=m.angle;
      } else {
        smoothTurn(en, toEdge, dt, 12);
        en.x += Math.cos(toEdge) * en.speed * 1.35 * dt;
        en.y += Math.sin(toEdge) * en.speed * 1.35 * dt;
      }
      if (en.sunDmg > 1.2) {
        en.hp -= 18 * dt;
        en.flash = 0.08;
        if (Math.random() < 0.08) spark(en.x, en.y, "#ffe66d", 3, 40);
      }
      if (en.hp <= 0) {
        en.dead = true;
        en.diedFromMorning = true;
        floatText(en.x, en.y - 20, "☀", "#ffe66d");
        spark(en.x, en.y, "#ffe66d", 8, 80);
      }
      if (en.x < 5 || en.x > WORLD_W - 5 || en.y < 5 || en.y > WORLD_H - 5) {
        en.dead = true;
        en.diedFromMorning = true;
      }
      resolveEnemyWorld(en);
      continue;
    }

    if (en.ridingPet && !en.ridingPet.dead) {
      en.x=en.ridingPet.x;en.y=en.ridingPet.y;en.angle=en.ridingPet.angle;
      continue;
    }

    if (en.revengeTarget && !combatTargetAlive(en.revengeTarget)) en.revengeTarget = null;
    const lockedTarget = en.revengeTarget || null;
    const playerDist = dist(en.x, en.y, player.x, player.y);
    const seesPlayer = playerDist < (en.ranged ? (en.weapon === "Bow" ? 430 : 390) : 280) && !player.dead;
    const target = lockedTarget || (seesPlayer ? player : null);

    if (target) {
      const targetR = target === player ? PLAYER_R : (target.r || 16);
      const d = dist(en.x, en.y, target.x, target.y);
      const moveA = angTo(en.x, en.y, target.x, target.y);
      smoothTurn(en, moveA, dt, 10);

      if (en.ranged) {
        const desired = en.weapon === "Bow" ? 235 : 205;
        en.strafeT -= dt;
        if (en.strafeT <= 0) {
          en.strafeDir *= -1;
          en.strafeT = rand(0.7, 1.7);
        }
        if (d > desired + 42) {
          en.x += Math.cos(moveA) * en.speed * 0.92 * dt;
          en.y += Math.sin(moveA) * en.speed * 0.92 * dt;
        } else if (d < desired - 34) {
          en.x -= Math.cos(moveA) * en.speed * 0.82 * dt;
          en.y -= Math.sin(moveA) * en.speed * 0.82 * dt;
        } else {
          const strafeA = moveA + en.strafeDir * Math.PI / 2;
          en.x += Math.cos(strafeA) * en.speed * 0.62 * dt;
          en.y += Math.sin(strafeA) * en.speed * 0.62 * dt;
        }
        if (en.atkCd <= 0) {
          const shotA = angTo(en.x, en.y, target.x, target.y);
          const isBow = en.weapon === "Bow";
          projectiles.push({
            x: en.x + Math.cos(shotA) * (en.r + 10),
            y: en.y + Math.sin(shotA) * (en.r + 10),
            vx: Math.cos(shotA) * (isBow ? 560 : 470),
            vy: Math.sin(shotA) * (isBow ? 560 : 470),
            life: isBow ? 1.15 : 1.3,
            r: isBow ? 4.5 : 6,
            hostile: true,
            source: en,
            dmg: en.dmg,
            kind: isBow ? "enemyArrow" : "arcaneBolt",
            color: isBow ? "#8fd4ff" : "#c77dff",
          });
          en.atkCd = isBow ? rand(1.25, 1.55) : rand(1.6, 1.95);
          en.attackAnim = 0.28;
        }
      } else {
        if (d > en.r + targetR - 3) {
          en.x += Math.cos(moveA) * en.speed * dt;
          en.y += Math.sin(moveA) * en.speed * dt;
        } else if (en.atkCd <= 0) {
          if (target === player) hitPlayer(en.dmg, en);
          else damageCreatureFromEnemy(target, en, en.dmg);
          en.atkCd = en.weapon === "Sword" ? 0.72 : 0.85;
          en.attackAnim = 0.22;
        }
      }
    } else {
      // roam deeper into the map — bias toward center / random mid points
      en.wanderT -= dt;
      if (en.wanderT <= 0) {
        if (Math.random() < 0.55) {
          const tx = WORLD_W * 0.5 + rand(-WORLD_W * 0.3, WORLD_W * 0.3);
          const ty = WORLD_H * 0.5 + rand(-WORLD_H * 0.3, WORLD_H * 0.3);
          en.wanderA = angTo(en.x, en.y, tx, ty);
        } else {
          en.wanderA = rand(0, TAU);
        }
        en.wanderT = rand(1.5, 3.5);
      }
      smoothTurn(en, en.wanderA, dt, 6);
      en.x += Math.cos(en.wanderA) * en.speed * 0.55 * dt;
      en.y += Math.sin(en.wanderA) * en.speed * 0.55 * dt;
    }
    en.x = clamp(en.x, 10, WORLD_W - 10);
    en.y = clamp(en.y, 10, WORLD_H - 10);
    resolveEnemyWorld(en);
  }
  enemies = enemies.filter(en => !en.dead);
}

function hitPlayer(dmg, attacker = null) {
  if (player.dead || game.over) return;
  dmg = Math.max(0, Number(dmg) || 0) * runDefenseMul();
  player.health -= dmg;
  player.hurtFlash = 0.22;
  game.shake = 8;
  sfx.hurt();
  for (const pet of player.pets) {
    if (pet.dead) continue;
    if (attacker && combatTargetAlive(attacker)) setPetAttackerTarget(pet, attacker);
    else pet.combat = Math.max(pet.combat || 0, 6);
  }
  if (player.health <= 0 && !player.dead) {
    player.health = 0;
    player.dead = true;
    player.splitT = 0;
    setKilledBy(player, attacker);
    beginDeathCamera(attacker);
    sfx.die();
  }
}

// ---------- projectiles & towers ----------
function updatePetBlasts(dt) {
  for (const b of petBlasts) {
    const x0=b.x,y0=b.y,x1=b.x+b.vx*dt,y1=b.y+b.vy*dt;
    b.x=x1;b.y=y1;b.life-=dt;
    if(b.life<=0){b.dead=true;continue;}
    let best={t:2,type:"",obj:null};
    const consider=(t,type,obj)=>{if(t!=null&&t<best.t)best={t,type,obj};};
    for(const en of enemies){if(!en.dead)consider(segmentCircleT(x0,y0,x1,y1,en.x,en.y,en.r+b.r),"enemy",en);}
    for(const wa of animals){if(wa.dead||wa.owned)continue;consider(animalProjectileSegmentT(wa,x0,y0,x1,y1,b.r),"wild",wa);}
    const mx=(x0+x1)*.5,my=(y0+y1)*.5,travel=Math.hypot(x1-x0,y1-y0);
    for(const r of queryStaticNearby("resources",mx,my,travel*.5+110)){if(r.alive)consider(resourceProjectileSegmentT(r,x0,y0,x1,y1,b.r),"solid",r);}
    for(const w of walls){if((w.hp??1)>0)consider(segmentCircleT(x0,y0,x1,y1,w.x,w.y,w.r+b.r),"solid",w);}
    if(best.t<=1){
      b.x=x0+(x1-x0)*best.t;b.y=y0+(y1-y0)*best.t;
      if(best.type==="enemy"){
        const en=best.obj;if(b.sourcePet&&!b.sourcePet.dead)en.revengeTarget=b.sourcePet;
        damageEnemy(en,b.dmg,b.kind==="lightning",(b.sourcePet&&!b.sourcePet.dead)?b.sourcePet:player);
        if(b.slow){en.speed*=.4;setTimeout(()=>{if(!en.dead)en.speed/=.4;},2500);}
        if(b.knock){const a=Math.atan2(b.vy,b.vx);en.x+=Math.cos(a)*b.knock;en.y+=Math.sin(a)*b.knock;}
      }else if(best.type==="wild"){
        const wa=best.obj,dealt=animalDamageTaken(wa.type,wa.stage,b.dmg);wa.hp-=dealt;wa.flash=.12;
        if(b.sourcePet&&!b.sourcePet.dead)wildlifeHitByPet(wa,b.sourcePet);else{markCreatureHit(wa,4);wa.sleeping=false;wa.enraged=true;}
        if(wa.hp<=0){setKilledBy(wa,(b.sourcePet&&!b.sourcePet.dead)?b.sourcePet:player);wa.dead=true;}
      }
      spark(b.x,b.y,b.color,6,80);b.dead=true;
    }
  }
  petBlasts=petBlasts.filter(b=>!b.dead&&b.life>0);
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    const x0=p.x, y0=p.y, x1=p.x+p.vx*dt, y1=p.y+p.vy*dt;
    p.x=x1; p.y=y1; p.life-=dt;
    if (p.life <= 0) { p.dead=true; continue; }
    let best={t:2,type:"",obj:null};
    const consider=(t,type,obj)=>{if(t!=null&&t<best.t)best={t,type,obj};};

    if (p.hostile) {
      if(!player.dead) consider(segmentCircleT(x0,y0,x1,y1,player.x,player.y,PLAYER_R+p.r),"player",player);
      for(const pet of player.pets){if(!pet.dead)consider(animalProjectileSegmentT(pet,x0,y0,x1,y1,p.r),"pet",pet);}
      for(const wa of animals){if(wa.dead||wa.owned||wa.enemyOwner)continue;consider(animalProjectileSegmentT(wa,x0,y0,x1,y1,p.r),"wild",wa);}
    } else {
      for(const en of enemies){if(!en.dead)consider(segmentCircleT(x0,y0,x1,y1,en.x,en.y,en.r+p.r),"enemy",en);}
      for(const wa of animals){if(wa.dead||wa.owned)continue;consider(animalProjectileSegmentT(wa,x0,y0,x1,y1,p.r),"wild",wa);}
    }

    for(const w of walls){if((w.hp??1)>0)consider(segmentCircleT(x0,y0,x1,y1,w.x,w.y,w.r+p.r),"solid",w);}
    const mx=(x0+x1)*.5,my=(y0+y1)*.5,travel=Math.hypot(x1-x0,y1-y0);
    for(const r of queryStaticNearby("resources",mx,my,travel*.5+110)){if(r.alive)consider(resourceProjectileSegmentT(r,x0,y0,x1,y1,p.r),"solid",r);}
    for(const g of queryStaticNearby("gold",mx,my,travel*.5+260)){if(g.infinite||g.goldLeft>0){const gh=goldSolidHitbox(g);consider(segmentCircleT(x0,y0,x1,y1,gh.x,gh.y,gh.r+p.r),"solid",g);}}

    if(best.t<=1){
      p.x=x0+(x1-x0)*best.t; p.y=y0+(y1-y0)*best.t;
      if(best.type==="player") hitPlayer(p.dmg||8,p.source||null);
      else if(best.type==="pet") damageCreatureFromEnemy(best.obj,p.source,p.dmg||8);
      else if(best.type==="enemy") damageEnemy(best.obj,p.dmg||TOOLS.Bow.dmg,false);
      else if(best.type==="wild"){
        const wa=best.obj;
        if(p.hostile) damageCreatureFromEnemy(wa,p.source,p.dmg||8);
        else {const dealt=animalDamageTaken(wa.type,wa.stage,p.dmg||TOOLS.Bow.dmg);wa.hp-=dealt;wa.flash=.12;markCreatureHit(wa,4);wa.sleeping=false;wa.enraged=true;wa.hostileTarget=player;if(wa.hp<=0){setKilledBy(wa,player);wa.dead=true;}}
      }
      spark(p.x,p.y,p.kind==="arcaneBolt"?"#c77dff":"#9fdfff",5,65);
      p.dead=true;
    }
    if(p.x<0||p.x>WORLD_W||p.y<0||p.y>WORLD_H)p.dead=true;
  }
  projectiles=projectiles.filter(p=>!p.dead);
}

function updateTowers(dt) {
  for (const t of towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    let nearest = null, bestD = 220;
    for (const en of enemies) {
      if (en.dead) continue;
      const d = dist(t.x, t.y, en.x, en.y);
      if (d < bestD) { bestD = d; nearest = en; }
    }
    if (nearest) {
      t.cd = 1.1;
      const a = angTo(t.x, t.y, nearest.x, nearest.y);
      projectiles.push({
        x: t.x, y: t.y, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500, life: 0.9, r: 4,
      });
    }
  }
}

// ---------- resources / walls ----------
function updateResources(dt) {
  for (const r of resources) {
    if (r.pulse > 0) r.pulse -= dt * 4;
    if (r.netState) {
      r.hp = Math.max(0, Number(r.netState.hp) || 0);
      r.maxHp = Math.max(0.01, Number(r.netState.maxHp) || r.maxHp || 1);
      r.alive = r.netState.alive !== false;
    } else if (!r.alive && game.time >= r.respawnAt) {
      r.alive = true; r.hp = r.maxHp; r.gatherCredit = 0;
    }
  }
  for (const g of goldChunks) {
    if (g.pulse > 0) g.pulse -= dt * 3;
    if (g.netState) {
      g.infinite = !!g.netState.infinite;
      g.pure = !!g.netState.pure;
      g.goldLeft = g.infinite ? Infinity : Math.max(0, Number(g.netState.goldLeft) || 0);
    }
  }
  for (const c of chests) if (c.pulse > 0) c.pulse -= dt * 2.8;
}
function updateWalls(dt) {
  for (const w of walls) {
    if (w.flash > 0) w.flash = Math.max(0, w.flash - dt);
    if (!net.room && w.ttl > 0) w.ttl -= dt;
    if (!net.room && (w.hp ?? 1) > 0) {
      w.enemyBreakCd = Math.max(0, (w.enemyBreakCd || 0) - dt);
      if (w.enemyBreakCd <= 0) {
        for (const en of enemies) {
          if (en.dead) continue;
          if (dist(w.x, w.y, en.x, en.y) <= w.r + en.r + 4) {
            const wallHit = Math.max(2.5, (en.dmg || 6) * 0.7);
            w.hp = Math.max(0, (w.hp ?? w.maxHp ?? 72) - wallHit);
            w.flash = 0.12;
            w.enemyBreakCd = 0.9;
            spark(w.x, w.y, w.kind === "stoneSpike" ? "#d9e0e6" : "#c99a5b", 4, 55);
            break;
          }
        }
      }
    }
    if (!net.room && w.spiked && (w.hp ?? 1) > 0) {
      w.spikeCd = Math.max(0, (w.spikeCd || 0) - dt);
      if (w.spikeCd <= 0) {
        let hit = false;
        // Your Dog's wall hurts hostile cubes, never you or your pets.
        for (const en of enemies) {
          if (en.dead) continue;
          if (dist(w.x, w.y, en.x, en.y) <= w.r + en.r + 3) {
            damageEnemy(en, w.spikeDmg || 5, false, w.sourcePet || player);
            hit = true; break;
          }
        }
        // It also punishes wildlife that runs directly into the spikes.
        if (!hit && w.sourcePet) {
          for (const wa of animals) {
            if (wa.dead || wa.owned) continue;
            if (dist(w.x, w.y, wa.x, wa.y) <= w.r + wa.r * 0.78 + 2) {
              const dealt = animalDamageTaken(wa.type, wa.stage, w.spikeDmg || 5);
              wa.hp -= dealt; wa.flash = 0.12; wa.sleeping = false; wa.enraged = true;
              wildlifeHitByPet(wa, w.sourcePet);
              floatText(wa.x, wa.y - wa.r - 7, Math.round(dealt), "#d9e0e6");
              spark(wa.x, wa.y, "#d9e0e6", 5, 70);
              if (wa.hp <= 0 && !wa.dead) { wa.dead = true; game.kills++; givePetExp(w.sourcePet, 16); }
              hit = true; break;
            }
          }
        }
        // A wild Dog's spiked wall can hurt the player; pet-owned walls cannot.
        if (!hit && w.hostileToPlayer && !player.dead && dist(w.x, w.y, player.x, player.y) <= w.r + PLAYER_R) {
          hitPlayer(w.spikeDmg || 5, w.sourceAnimal || null);
          hit = true;
        }
        if (hit) w.spikeCd = 0.55;
      }
    }
  }
  walls = walls.filter(w => (w.hp ?? 1) > 0 && (w.ttl === -1 || w.ttl > 0 || !!net.room));
}

// ---------- animals & pets ----------
function tryTameNearby() {
  if (game.tamePending) { banner("Tame attempt already in progress…", true); return; }
  if (player.pets.length >= 4) { banner("Max 4 pets!", true); return; }
  if (net.room) {
    let best=null,bestD=70;
    for(const a of animals){ if(a.dead||a.owned||!a.sleeping||a.stage!=="baby"||!a.netId)continue; const d=dist(player.x,player.y,a.x,a.y); if(d<bestD){bestD=d;best=a;} }
    if(!best){banner("No sleeping baby nearby (press T)",true);return;}
    game.tamePending = true;
    if(sfx.tameTry)sfx.tameTry(); banner(`Taming… ${Math.round(tameChanceFor(best.type)*100)}% chance`);
    try{net.room.send("tame",{id:best.netId});}catch(_){game.tamePending=false;}
    return;
  }
  let best = null, bestD = 70;
  for (const a of animals) {
    if (a.owned || a.dead || !a.sleeping || a.stage !== "baby") continue;
    const d = dist(player.x, player.y, a.x, a.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  if (!best) { banner("No sleeping baby nearby (press T)", true); return; }
  game.tamePending = true;
  // suspense build-up sound
  if (sfx.tameTry) sfx.tameTry();
  else {
    try {
      const ac = sfx._ac || (sfx._ac = new (window.AudioContext || window.webkitAudioContext)());
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(220, ac.currentTime);
      o.frequency.linearRampToValueAtTime(440, ac.currentTime + 0.55);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.12, ac.currentTime + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6);
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.65);
    } catch (_) {}
  }
  const chance = tameChanceFor(best.type);
  banner(`Taming… ${Math.round(chance*100)}% chance`);
  setTimeout(() => {
    game.tamePending = false;
    if (best.dead || best.owned) return;
    if (Math.random() < chance) {
      best.owned = true;
      best.follow = true;
      best.orderMode = "follow";
      best.petName = best.petName || PET_TYPES[best.type].name;
      best.huntTarget = null; best.huntRetarget = 0; best.huntWanderT = 0;
      best.sleeping = false;
      best.tameFailedAggro = false;
      best.desperateAggro = false;
      best.fleeUntil = 0;
      best.enraged = false;
      best.exp = 0; best.level = 1; best.combat = 0; best.atkCd = 0;
      best.speed = upgradedPetSpeed(best.type, best.stage);
      best.maxHp = upgradedPetMaxHp(best.type, best.stage);
      best.hp = best.maxHp;
      if (!best.coat) best.coat = PET_TYPES[best.type].color;
      player.pets.push(best);
      if (sfx.tame) sfx.tame();
      try {
        const ac = sfx._ac || (sfx._ac = new (window.AudioContext || window.webkitAudioContext)());
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "triangle"; o.frequency.setValueAtTime(523, ac.currentTime);
        o.frequency.setValueAtTime(659, ac.currentTime + 0.12);
        o.frequency.setValueAtTime(784, ac.currentTime + 0.24);
        g.gain.setValueAtTime(0.15, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
        o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.55);
      } catch (_) {}
      spark(best.x, best.y, "#7be08a", 14, 120);
      if (!meta.speciesCards) meta.speciesCards = {};
      meta.speciesCards[best.type] = (meta.speciesCards[best.type] || 0) + 1;
      saveMeta();
      banner(`Tamed ${PET_TYPES[best.type].name}! +1 Card (${meta.speciesCards[best.type]}/${cardsNeeded(best.type)})`);
    } else {
      // fail — sad sound + attacks you
      try {
        const ac = sfx._ac || (sfx._ac = new (window.AudioContext || window.webkitAudioContext)());
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(400, ac.currentTime);
        o.frequency.linearRampToValueAtTime(120, ac.currentTime + 0.7);
        g.gain.setValueAtTime(0.12, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.75);
        o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.8);
      } catch (_) {}
      best.sleeping = false;
      best.enraged = true;
      best.tameFailedAggro = true;
      best.desperateAggro = false;
      best.fleeUntil = 0;
      best.combat = 9999;
      best.wanderA = angTo(best.x, best.y, player.x, player.y);
      spark(best.x, best.y, "#f2836a", 10, 90);
      // No free contactless hit: it must physically reach you and bite with its head.
    }
    syncPetCards();
  }, 600);
}

function animalUnderWorldPoint(wx, wy) {
  let best = null;
  let bestScore = Infinity;
  const list = net.room ? Array.from(net.animalVisuals.values()) : animals;
  for (const a of list) {
    if (!a || a.dead || a.owned || (Number(a.hp) || 0) <= 0) continue;
    const d = dist(wx, wy, a.x, a.y);
    const pickR = Math.max(24, (Number(a.r) || 18) * 1.35);
    if (d <= pickR && d < bestScore) {
      best = a;
      bestScore = d;
    }
  }
  return best;
}

function focusAllPetsOnAnimal(target) {
  if (!target || target.dead || target.owned) return false;
  let commanded = 0;

  for (const p of player.pets) {
    if (!p || p.dead) continue;
    commanded++;

    // Local/offline focus target.
    p.forcedTarget = target;
    p.forcedTargetAutoDefense = false;
    p.combat = Math.max(p.combat || 0, 9999);
    p.huntTarget = null;
    p.huntRetarget = 0;
    p.targetX = null;
    p.targetY = null;
    p.follow = false;
    p.followReturning = false;

    // Multiplayer server-authoritative focus target.
    if (net.room && p.netId && target.netId) {
      try {
        net.room.send("petOrder", {
          id: p.netId,
          mode: "focus",
          targetKind: "animal",
          targetId: target.netId
        });
      } catch (_) {}
    }
  }

  if (commanded > 0) {
    const speciesName = PET_TYPES[target.type]?.name || "animal";
    banner(`All pets targeting ${speciesName}`);
    return true;
  }
  return false;
}

function commandPets() {
  const wx = mouse.sx + game.camX, wy = mouse.sy + game.camY;
  for (const p of player.pets) {
    p.targetX = wx; p.targetY = wy;
    p.follow = false;
    p.orderMode = "set";
    p.huntTarget = null;
    if(net.room && p.netId){try{net.room.send("petOrder",{id:p.netId,mode:"set",x:wx,y:wy});}catch(_){}}
  }
  banner("Pets moving to target");
}

function activatePetAbility(pet, batchCast = false) {
  if (!pet || pet.dead) return;
  const info = PET_TYPES[pet.type];
  if (!info) return;
  if (pet.abilityCd > 0) {
    banner(`${petDisplayName(pet)} ability ready in ${Math.ceil(pet.abilityCd)}s`, true);
    return;
  }
  if (net.room && pet.netId) {
    pet.abilityCd = info.abilityCd;
    try { net.room.send("petAbility", { id:pet.netId }); } catch (_) {}
    if (!batchCast) banner(`${petDisplayName(pet)} used ${info.elem}! (${info.abilityCd}s cd)`);
    syncPetCards();
    return;
  }
  pet.abilityCd = info.abilityCd; // full wait before next use
  sfx.ability();
  const px = pet.x, py = pet.y;
  // Immediate cast flash so every pet ability is visibly obvious on activation.
  abilityFx.push({ type: "cast", x: px, y: py, life: 0.5, maxLife: 0.5, color: ELEM_GLOW[info.elem] || "#ffffff", r: pet.r + 10 });
  if (info.elem === "Stone") {
    const a = player.angle;
    const ws = dogWallStats(pet.stage);
    walls.push({
      x: px + Math.cos(a) * 44, y: py + Math.sin(a) * 44,
      ttl: 34, r: 27, hp: ws.hp, maxHp: ws.hp, kind:"stoneSpike", spiked:true,
      spikeDmg: ws.spikeDmg, spikeCd: 0, sourcePet: pet, ownerId:"local"
    });
    abilityFx.push({ type: "stone", x: px, y: py, life: 0.8 });
    spark(px, py, "#d5dde3", 14, 95);
  } else if (info.elem === "Sound") {
    abilityFx.push({ type: "sound", x: px, y: py, life: 5, r: pet.r + 28, baseR: pet.r + 28, followPet: pet, dmg: 5, phase: 0, tick: 0 });
  } else if (info.elem === "Fire") {
    abilityFx.push({ type: "fire", x: px, y: py, life: 5, r: pet.r + 30, baseR: pet.r + 30, followPet: pet, dmg: 7, phase: 0, tick: 0 });
  } else if (info.elem === "Lightning") {
    const a = player.angle;
    petBlasts.push({ x: px, y: py, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, life: 0.9, r: 7, dmg: 20, kind: "lightning", color: "#ffe66d", sourcePet: pet });
    abilityFx.push({ type: "lightning", x: px, y: py, life: 0.3 });
    spark(px, py, "#ffe66d", 10, 120);
  } else if (info.elem === "Ice") {
    abilityFx.push({ type: "ice", x: px, y: py, life: 5, r: pet.r + 30, baseR: pet.r + 30, followPet: pet, dmg: 5, slow: true, phase: 0, tick: 0 });
  } else if (info.elem === "Water") {
    const a = player.angle;
    petBlasts.push({ x: px, y: py, vx: Math.cos(a) * 360, vy: Math.sin(a) * 360, life: 1.15, r: 12, dmg: 15, kind: "water", color: "#4aa3e0", knock: 26, sourcePet: pet });
    abilityFx.push({ type: "water", x: px, y: py, life: 0.4, r: 12 });
    game.shake = 5;
  } else if (info.elem === "Plant") {
    const a = player.angle;
    petBlasts.push({ x: px, y: py, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400, life: 1.0, r: 7, dmg: 14, kind: "leaf", color: "#5cb85c", sourcePet: pet });
    player.health = clamp(player.health + 22, 0, player.maxHealth);
    floatText(player.x, player.y - 30, "+22", "#7be08a");
    for (const mate of player.pets) {
      if (mate.dead) continue;
      mate.hp = clamp(mate.hp + 18, 0, mate.maxHp);
      floatText(mate.x, mate.y - mate.r - 8, "+18", "#9ae6b4");
    }
    abilityFx.push({ type: "plant", x: px, y: py, life: 0.5 });
    sfx.eat();
  } else if (info.elem === "Wind") {
    abilityFx.push({ type: "wind", x: px, y: py, life: 5, r: pet.r + 32, baseR: pet.r + 32, followPet: pet, dmg: 3, slow: true, phase: 0, tick: 0 });
  } else if (info.elem === "Poison") {
    abilityFx.push({ type: "poison", x: px, y: py, life: 5, r: pet.r + 28, baseR: pet.r + 28, followPet: pet, dmg: 6, phase: 0, tick: 0 });
  } else if (info.elem === "Light") {
    abilityFx.push({ type: "light", x: px, y: py, life: 5, r: pet.r + 30, baseR: pet.r + 30, followPet: pet, dmg: 3, phase: 0, tick: 0 });
    player.health = clamp(player.health + 12, 0, player.maxHealth);
    floatText(player.x, player.y - 28, "+12", "#ffe66d");
  } else if (info.elem === "Earth") {
    abilityFx.push({ type: "earth", x: px, y: py, life: 5, r: pet.r + 32, baseR: pet.r + 32, followPet: pet, dmg: 7, phase: 0, tick: 0 });
    game.shake = 6;
  } else if (info.elem === "Combat") {
    // Sabertooth: dash to the nearest hostile target and deal burst damage.
    let target = null, bestD = 300, targetIsAnimal = false;
    for (const en of enemies) {
      if (en.dead) continue;
      const d = dist(px, py, en.x, en.y);
      if (d < bestD) { bestD = d; target = en; targetIsAnimal = false; }
    }
    for (const wa of animals) {
      if (wa.dead || wa.owned || wa === pet) continue;
      const d = dist(px, py, wa.x, wa.y);
      if (d < bestD) { bestD = d; target = wa; targetIsAnimal = true; }
    }
    const dashA = target ? angTo(px, py, target.x, target.y) : player.angle;
    const dashDist = target ? Math.max(0, bestD - (pet.r + target.r) * 0.7) : 95;
    pet.x = clamp(px + Math.cos(dashA) * Math.min(dashDist, 150), 20, WORLD_W - 20);
    pet.y = clamp(py + Math.sin(dashA) * Math.min(dashDist, 150), 20, WORLD_H - 20);
    smoothTurn(pet, dashA, 1, 20);
    spark(px, py, "#e07040", 10, 140);
    spark(pet.x, pet.y, "#ffd08a", 12, 150);
    if (target && animalHeadTouchesTarget(pet, target)) {
      const rawDmg = 34 + (pet.level || 1) * 4;
      const dmg = targetIsAnimal ? animalDamageTaken(target.type, target.stage, rawDmg) : rawDmg;
      target.hp -= dmg;
      target.flash = 0.16;
      pet.attackAnim = 0.18;
      floatText(target.x, target.y - target.r - 10, Math.round(dmg), "#ffd08a");
      if (targetIsAnimal) {
        wildlifeHitByPet(target, pet);
        if (target.hp <= 0) { target.dead = true; game.kills++; givePetExp(pet, 18); }
      } else {
        target.revengeTarget = pet;
      }
      if (!targetIsAnimal && target.hp <= 0) {
        damageEnemy(target, 0, false, pet);
        givePetExp(pet, 20);
      }
    }
    game.shake = 5;
  }
  if (!batchCast) banner(`${petDisplayName(pet)} used ${info.elem}! (${info.abilityCd}s cd)`);
  if (!batchCast) syncPetCards();
}

function safePetFollowPoint(p, tx, ty) {
  let x = clamp(tx, 24, WORLD_W - 24);
  let y = clamp(ty, 24, WORLD_H - 24);
  const pr = Math.max(10, (Number(p.r) || 18) * 0.72 + 5);
  const range = pr + 130;

  for (let pass = 0; pass < 2; pass++) {
    for (const r of queryStaticNearby("resources", x, y, range)) {
      if (!r.alive) continue;
      let cx, cy, rr;
      if (r.type === "log") {
        const h = resourceHitboxes(r)[0];
        if (!h) continue;
        cx = h.x; cy = h.y; rr = h.r;
      } else {
        const c = resourceSolidCenter(r);
        cx = c.x; cy = c.y; rr = r.solidR;
      }
      const d = dist(x, y, cx, cy), min = pr + rr + 4;
      if (d < min) {
        const a = d > 0.01 ? angTo(cx, cy, x, y) : (p.angle || 0);
        x = cx + Math.cos(a) * min;
        y = cy + Math.sin(a) * min;
      }
    }

    for (const g of queryStaticNearby("gold", x, y, range)) {
      if (!g.infinite && g.goldLeft <= 0) continue;
      const h = goldSolidHitbox(g);
      const d = dist(x, y, h.x, h.y), min = pr + h.r + 4;
      if (d < min) {
        const a = d > 0.01 ? angTo(h.x, h.y, x, y) : (p.angle || 0);
        x = h.x + Math.cos(a) * min;
        y = h.y + Math.sin(a) * min;
      }
    }

    for (const c of queryStaticNearby("chests", x, y, range)) {
      if (c.opened) continue;
      const h = chestSolidHitbox(c);
      const d = dist(x, y, h.x, h.y), min = pr + h.r + 4;
      if (d < min) {
        const a = d > 0.01 ? angTo(h.x, h.y, x, y) : (p.angle || 0);
        x = h.x + Math.cos(a) * min;
        y = h.y + Math.sin(a) * min;
      }
    }

    for (const w of walls) {
      const d = dist(x, y, w.x, w.y), min = pr + w.r + 5;
      if (d < min) {
        const a = d > 0.01 ? angTo(w.x, w.y, x, y) : (p.angle || 0);
        x = w.x + Math.cos(a) * min;
        y = w.y + Math.sin(a) * min;
      }
    }
  }

  return { x: clamp(x, 24, WORLD_W - 24), y: clamp(y, 24, WORLD_H - 24) };
}

function resolveAnimalWorld(a) {
  // Spatially-cull static collisions so off-screen wildlife is cheap to simulate.
  const searchRange = Math.max(260, a.r + 190);
  for (const r of queryStaticNearby("resources", a.x, a.y, searchRange)) {
    if (!r.alive) continue;
    if (r.type === "log") {
      let best = null;
      for (const ah of animalBodyHitboxes(a)) {
        const hit = deepestResourceOverlap(r, ah.x, ah.y, ah.r * 0.9);
        if (hit && (!best || hit.overlap > best.overlap)) best = hit;
      }
      if (best && best.d > 0.1) {
        const ang = angTo(best.h.x, best.h.y, a.x, a.y);
        a.x += Math.cos(ang) * best.overlap;
        a.y += Math.sin(ang) * best.overlap;
      }
    } else {
      const c = resourceSolidCenter(r);
      const hit = deepestAnimalPhysicalOverlap(a, c.x, c.y, r.solidR);
      if (hit && hit.d > 0.1) {
        const ang = angTo(c.x, c.y, hit.h.x, hit.h.y);
        a.x += Math.cos(ang) * hit.overlap;
        a.y += Math.sin(ang) * hit.overlap;
      }
    }
  }
  for (const g of queryStaticNearby("gold", a.x, a.y, searchRange)) {
    if (!g.infinite && g.goldLeft <= 0) continue;
    const gh = goldSolidHitbox(g);
    const hit = deepestAnimalCircleOverlap(a, gh.x, gh.y, gh.r);
    if (hit && hit.d > 0.1) {
      const ang = angTo(gh.x, gh.y, hit.h.x, hit.h.y);
      a.x += Math.cos(ang) * hit.overlap;
      a.y += Math.sin(ang) * hit.overlap;
    }
  }
  for (const w of walls) {
    const d = dist(a.x, a.y, w.x, w.y);
    if (d < w.r + a.r * 0.85 && d > 0.1) {
      const ang = angTo(w.x, w.y, a.x, a.y);
      a.x = w.x + Math.cos(ang) * (w.r + a.r * 0.85);
      a.y = w.y + Math.sin(ang) * (w.r + a.r * 0.85);
    }
  }
  for (const c of queryStaticNearby("chests", a.x, a.y, searchRange)) {
    if (c.opened) continue;
    const ch = chestSolidHitbox(c);
    const hit = deepestAnimalCircleOverlap(a, ch.x, ch.y, ch.r);
    if (hit && hit.d > 0.1) {
      const ang = angTo(ch.x, ch.y, hit.h.x, hit.h.y);
      a.x += Math.cos(ang) * hit.overlap;
      a.y += Math.sin(ang) * hit.overlap;
    }
  }
}

function wildUseAbility(a) {
  if ((a.abilityCd || 0) > 0 || a.dead || a.sleeping) return;
  const info = PET_TYPES[a.type];
  const target = wildCombatTarget(a);
  if (!target) return;
  a.abilityCd = info.abilityCd * 1.15;
  sfx.ability();
  const px = a.x, py = a.y;
  const tx = target.x, ty = target.y;
  const dTarget = dist(px, py, tx, ty);
  if (info.elem === "Stone") {
    const ws = dogWallStats(a.stage);
    walls.push({ x: px + Math.cos(a.angle) * 38, y: py + Math.sin(a.angle) * 38, ttl: 16, r: 25,
      hp: ws.hp, maxHp: ws.hp, kind:"stoneSpike", spiked:true, spikeDmg:ws.spikeDmg,
      spikeCd:0, sourceAnimal:a, hostileToPlayer:true });
    abilityFx.push({ type: "stone", x: px, y: py, life: 0.6 });
  } else if (info.elem === "Sound") {
    abilityFx.push({ type: "sound", x: px, y: py, life: 0.45, r: 0 });
    if (dTarget < 100) {
      damageTargetFromWild(a, target, 6);
      const ang = angTo(px, py, tx, ty);
      if (target === player) {
        player.x += Math.cos(ang) * 22; player.y += Math.sin(ang) * 22;
      } else {
        target.x += Math.cos(ang) * 22; target.y += Math.sin(ang) * 22;
      }
    }
  } else if (info.elem === "Fire") {
    abilityFx.push({ type: "fire", x: px, y: py, life: 1.0, r: 0 });
    if (dTarget < 85) damageTargetFromWild(a, target, 10);
  } else if (info.elem === "Lightning") {
    abilityFx.push({ type: "lightning", x: px, y: py, life: 0.4 });
    if (dTarget < 140) {
      damageTargetFromWild(a, target, 11);
      abilityFx.push({ type: "bolt", x: tx, y: ty, life: 0.25, fromX: px, fromY: py });
    }
  } else if (info.elem === "Ice") {
    abilityFx.push({ type: "ice", x: px, y: py, life: 0.6, r: 0 });
    if (dTarget < 110) damageTargetFromWild(a, target, 9);
  } else if (info.elem === "Water") {
    abilityFx.push({ type: "water", x: px, y: py, life: 0.7, r: 0 });
    if (dTarget < 120) {
      damageTargetFromWild(a, target, 10);
      const ang = angTo(px, py, tx, ty);
      if (target === player) {
        player.x += Math.cos(ang) * 28; player.y += Math.sin(ang) * 28;
      } else {
        target.x += Math.cos(ang) * 28; target.y += Math.sin(ang) * 28;
      }
    }
  } else if (info.elem === "Plant") {
    abilityFx.push({ type: "plant", x: px, y: py, life: 0.5 });
    if (dTarget < 100) damageTargetFromWild(a, target, 5);
  }
}

function chooseCombatHuntTarget(pet) {
  const candidates = [];
  for (const en of enemies) {
    if (!en.dead) candidates.push({ obj: en, isAnimal: false });
  }
  for (const wa of animals) {
    if (!wa.dead && !wa.owned && wa !== pet) candidates.push({ obj: wa, isAnimal: true });
  }
  if (!candidates.length) return null;

  // Favor things that are reasonably close, but keep selection random so pets split up.
  const nearby = candidates.filter(c => dist(pet.x, pet.y, c.obj.x, c.obj.y) < 1100);
  const pool = nearby.length ? nearby : candidates;
  return pool[randi(0, pool.length - 1)];
}

function defeatOwnedPet(p, killer = null) {
  if (!p || p.dead) return;
  const name = petDisplayName(p);
  setKilledBy(p, killer);
  p.dead = true;
  p.hp = 0;
  p.huntTarget = null;
  p.targetX = null;
  p.targetY = null;
  if (player.riding === p) player.riding = null;
  if (window._petSetTarget === p) window._petSetTarget = null;
  if (renamePetTarget === p) closePetRename();

  // Remove the defeated pet from the live party immediately, in the same moment
  // the defeat message is shown. This makes its HUD card disappear instantly.
  player.pets = player.pets.filter(other => other !== p && !other.dead);
  retargetAfterOwnedPetFalls(killer, p);
  syncPetCards();
  banner(`${name} was defeated…`, true);
  spark(p.x, p.y, "#f2836a", 12, 100);
  sfx.die();
}

function updateCombatHunt(p, dt) {
  p.follow = false;
  p.targetX = null; p.targetY = null;
  p.huntRetarget = (p.huntRetarget || 0) - dt;

  let hunt = p.huntTarget;
  if (!hunt || !hunt.obj || hunt.obj.dead || (hunt.isAnimal && hunt.obj.owned) || p.huntRetarget <= 0) {
    hunt = chooseCombatHuntTarget(p);
    p.huntTarget = hunt;
    p.huntRetarget = rand(7, 13);
  }

  if (hunt && hunt.obj && !hunt.obj.dead) {
    const target = hunt.obj;
    const d = dist(p.x, p.y, target.x, target.y);
    const a = angTo(p.x, p.y, target.x, target.y);
    smoothTurn(p, a, dt, 4.8);
    const headOnTarget = animalHeadTouchesTarget(p, target);
    if (!headOnTarget) {
      // Combat pets turn into the chase and then move where they are actually facing.
      const chaseBoost = d > 350 ? 1.45 : 1.28;
      moveFacing(p, p.speed * chaseBoost, dt);
    } else if (p.atkCd <= 0) {
      const rawDmg = petAtkDmg(p);
      const dmg = hunt.isAnimal ? animalDamageTaken(target.type, target.stage, rawDmg) : rawDmg;
      target.hp -= dmg;
      target.flash = 0.12;
      if (!hunt.isAnimal) target.revengeTarget = p;
      p.atkCd = animalAttackCooldown(p.type, p.stage, true);
      p.attackAnim = 0.18;
      if (hunt.isAnimal) markCreatureHit(target, 3.8);
      spark(target.x, target.y, "#7be08a", 5, 80);
      floatText(target.x, target.y - target.r - 6, Math.round(dmg), "#7be08a");

      if (hunt.isAnimal) {
        wildlifeHitByPet(target, p);
      }

      // Wildlife can only retaliate when ITS head is actually touching the pet.
      // Triangle enemies keep their existing abstract contact retaliation.
      const retaliationConnects = hunt.isAnimal
        ? ((target.atkCd || 0) <= 0 && animalHeadTouches(target, p.x, p.y, p.r * 0.82))
        : Math.random() < 0.3;
      if (retaliationConnects) {
        p.hp -= animalDamageTaken(p.type, p.stage, (target.dmg || typeDmg(target.type, target.stage) || 7) * 0.4);
        p.flash = 0.15;
        markCreatureHit(p, 3.2);
        if (!hunt.isAnimal) setPetAttackerTarget(p, target);
        if (hunt.isAnimal) {
          target.atkCd = target.stage === "bigmomma" ? 1.25 : target.stage === "superboss" ? 0.95 : target.stage === "boss" ? 0.8 : 1.05;
          target.attackAnim = 0.18;
        }
        if (p.hp <= 0) {
          defeatOwnedPet(p, target);
          return;
        }
      }

      if (target.hp <= 0 && !target.dead) {
        if (hunt.isAnimal) {
          target.dead = true;
          game.kills++;
          givePetExp(p, petKillXpForAnimal(targetEn));
          spark(target.x, target.y, PET_TYPES[target.type].color, 10, 100);
        } else {
          damageEnemy(target, 0, false, p);
          givePetExp(p, petKillXpForEnemy(targetEn));
        }
        p.huntTarget = null;
        p.huntRetarget = 0;
      }
    }
    return;
  }

  // Nothing alive to hunt right now: keep roaming instead of freezing or returning to player.
  p.huntWanderT = (p.huntWanderT || 0) - dt;
  if (p.huntWanderT <= 0 || p.huntTX == null || dist(p.x, p.y, p.huntTX, p.huntTY) < 18) {
    const ang = rand(0, TAU);
    const rad = rand(220, 650);
    p.huntTX = clamp(p.x + Math.cos(ang) * rad, 40, WORLD_W - 40);
    p.huntTY = clamp(p.y + Math.sin(ang) * rad, 40, WORLD_H - 40);
    p.huntWanderT = rand(2.5, 6);
  }
  const a = angTo(p.x, p.y, p.huntTX, p.huntTY);
  smoothTurn(p, a, dt, 4.2);
  moveFacing(p, p.speed * 0.85, dt);
}

function playerIsActivelyEscapingAnimal(a) {
  if (!a) return false;
  let mx = 0, my = 0;
  if (keys.has("w") || keys.has("arrowup")) my -= 1;
  if (keys.has("s") || keys.has("arrowdown")) my += 1;
  if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
  if (keys.has("d") || keys.has("arrowright")) mx += 1;
  if (mobileMode && joyActive) { mx += joyDX; my += joyDY; }
  const ml = Math.hypot(mx, my);
  if (ml < 0.12) return false;
  mx /= ml; my /= ml;
  let ax = player.x - a.x, ay = player.y - a.y;
  const al = Math.hypot(ax, ay) || 1;
  ax /= al; ay /= al;
  return mx * ax + my * ay > 0.18;
}

function carryPlayerWithOfflineWildMovement(a, oldX, oldY) {
  if (!a || player.dead) return;
  const dx = a.x - oldX, dy = a.y - oldY;
  if (Math.hypot(dx, dy) < 0.001) return;

  const hit = deepestAnimalPhysicalOverlap(a, player.x, player.y, PLAYER_R * 0.82);
  if (!hit) return;

  // Movement collision still carries a stationary player, but never traps a
  // player who is deliberately running away from the animal.
  if (playerIsActivelyEscapingAnimal(a)) return;

  player.x = clamp(player.x + dx, PLAYER_R, WORLD_W - PLAYER_R);
  player.y = clamp(player.y + dy, PLAYER_R, WORLD_H - PLAYER_R);
}

function updateAnimals(dt) {
  // wild
  for (const a of animals) {
    if (a.dead || a.owned) continue;
    if (a.flash > 0) a.flash -= dt;
    if (a.atkCd > 0) a.atkCd -= dt;
    if (a.abilityCd > 0) a.abilityCd -= dt;
    if (a.combat > 0) a.combat -= dt;
    updateCreatureRecovery(a, dt, Math.max(0.8, a.maxHp * 0.018));
    a.tailPhase = (a.tailPhase || 0) + dt * (2.2 + a.speed * 0.02);

    if (a.enemyOwner) {
      const en = a.enemyOwner;
      if (en.dead) {
        if (en.guardPet === a) en.guardPet = null;
        if (en.ridingPet === a) en.ridingPet = null;

        a.enemyOwner = null;
        a.enemyRider = false;

        if (en.diedFromMorning) {
          // Morning/daylight killed the hostile cube owner:
          // this animal is now ordinary wild life again.
          a.hostileTarget = null;
          a.enraged = false;
          a.tameFailedAggro = false;
          a.desperateAggro = false;
          a.fleeUntil = 0;
          a.fleeFrom = null;
          a.combat = 0;
          a.atkCd = 0;
          a.sleeping = false;
          a.wanderT = rand(0.7, 2.4);
          a.wanderA = rand(0, TAU);
        } else {
          // Combat death keeps the old retaliation behavior.
          a.hostileTarget = player;
          a.enraged = true;
        }
      } else {
        const rider = en.ridingPet === a;
        const dPlayerGuard = dist(a.x,a.y,player.x,player.y);
        const wantsFight = !player.dead && (rider || dPlayerGuard < 300 || en.revengeTarget === player);
        if (wantsFight) {
          const face = angTo(a.x,a.y,player.x,player.y);
          smoothTurn(a,face,dt,rider?7.8:6.8);
          const ox=a.x,oy=a.y;
          moveFacing(a,a.speed*(rider?1.16:1.08),dt);
          a.x=clamp(a.x,20,WORLD_W-20);a.y=clamp(a.y,20,WORLD_H-20);resolveAnimalWorld(a);
          carryPlayerWithOfflineWildMovement(a,ox,oy);
          if(animalHeadTouches(a,player.x,player.y,PLAYER_R*.82)&&a.atkCd<=0){
            const base=typeDmg(a.type,a.stage),dmg=rand(base*.82,base*1.16);damageTargetFromWild(a,player,dmg);a.atkCd = animalAttackCooldown(a.type, a.stage, false);a.attackAnim=.22;
          }
        } else if (rider) {
          a.wanderT-=dt;if(a.wanderT<=0){a.wanderA=rand(0,TAU);a.wanderT=rand(1.1,2.7);}smoothTurn(a,a.wanderA,dt,4);moveFacing(a,a.speed*.42,dt);resolveAnimalWorld(a);
        } else {
          const d=dist(a.x,a.y,en.x,en.y),stand=en.r+a.r*.72+18;
          if(d>stand+8){const face=angTo(a.x,a.y,en.x,en.y);smoothTurn(a,face,dt,6.1);moveFacing(a,a.speed*(d>200?1.5:d>120?1.25:.92),dt);resolveAnimalWorld(a);}
          else if(d<stand&&d>.01){const q=angTo(en.x,en.y,a.x,a.y),push=stand-d+1;a.x+=Math.cos(q)*push;a.y+=Math.sin(q)*push;resolveAnimalWorld(a);}
        }
        if(rider){en.x=a.x;en.y=a.y;en.angle=a.angle;}
        continue;
      }
    }

    const dPlayer = dist(a.x, a.y, player.x, player.y);
    const info = PET_TYPES[a.type];
    const isFriendly = info && info.friendly;
    const lowHealthFight = !!(info && info.flee) && a.hp > 0 && a.hp / a.maxHp <= 0.32;
    if (lowHealthFight) {
      a.desperateAggro = true;
      if (!a.hostileTarget && combatTargetAlive(a.fleeFrom)) a.hostileTarget = a.fleeFrom;
    }
    if (a.tameFailedAggro || a.desperateAggro) {
      a.enraged = true;
      a.sleeping = false;
      a.fleeUntil = 0;
    }

    if (a.hostileTarget && !combatTargetAlive(a.hostileTarget)) a.hostileTarget = null;

    // Wildlife can start fights with nearby wildlife or hostile cubes instead
    // of only retaliating after something damages it first.
    a.wildFightScan = (a.wildFightScan || 0) - dt;
    if (!a.hostileTarget && a.wildFightScan <= 0) {
      a.wildFightScan = rand(0.30, 0.65);
      const wildFoe = chooseWildlifeFightTarget(a);
      if (wildFoe) {
        a.hostileTarget = wildFoe;
        a.sleeping = false;
        a.enraged = true;
        a.combat = Math.max(a.combat || 0, 6);
      }
    }

    if (a.hostileTarget) {
      const foe = a.hostileTarget;
      a.sleeping = false;
      a.enraged = true;
      const foeA = angTo(a.x, a.y, foe.x, foe.y);
      smoothTurn(a, foeA, dt, 5.0);

      // Attack range NEVER stops movement. The animal keeps stepping toward
      // the target every tick; face contact only decides whether a bite lands.
      const oldX = a.x, oldY = a.y;
      moveFacing(a, a.speed * 1.05, dt);
      a.x = clamp(a.x, 20, WORLD_W - 20);
      a.y = clamp(a.y, 20, WORLD_H - 20);
      resolveAnimalWorld(a);

      if (foe === player) {
        carryPlayerWithOfflineWildMovement(a, oldX, oldY);
      } else if (foe && foe.owned && !foe.dead) {
        const dx = a.x - oldX, dy = a.y - oldY;
        if (deepestAnimalPhysicalOverlap(a, foe.x, foe.y, (foe.r || 18) * 0.82)) {
          foe.x += dx; foe.y += dy;
        }
      }

      if (wildAttackConnects(a, foe) && a.atkCd <= 0) {
        // Keep wildlife-vs-wildlife bites real: this damage path accepts animals.
        const stageDmg = typeDmg(a.type, a.stage);
        const dmg = rand(stageDmg * 0.8, stageDmg * 1.15);
        damageTargetFromWild(a, foe, dmg);
        a.atkCd = animalAttackCooldown(a.type, a.stage, false);
        a.attackAnim = 0.18;
        spark(foe.x, foe.y, "#e0563f", 5, 70);
        if (!combatTargetAlive(foe)) a.hostileTarget = null;
      }
      continue;
    }

    // mega bosses go back to sleep if you leave
    if (isBossTier(a.stage) && a.enraged && dPlayer > (a.stage === "bigmomma" ? 520 : a.stage === "superboss" ? 420 : 320)) {
      a.enraged = false;
      a.combat = 0;
      a.sleeping = true;
      a.hp = Math.min(a.maxHp, a.hp + 15);
      floatText(a.x, a.y - a.r - 10, "zzz", "#efe6d2");
    }

    if (a.sleeping) { resolveAnimalWorld(a); continue; }

    // fleeing after being attacked (cats, foxes, dragons…). Failed tames and
    // critically hurt skittish animals override fleeing and fight instead.
    if (!a.tameFailedAggro && !a.desperateAggro && a.fleeUntil && game.time < a.fleeUntil) {
      const fleeSource = combatTargetAlive(a.fleeFrom) ? a.fleeFrom : player;
      const fleeA = angTo(fleeSource.x, fleeSource.y, a.x, a.y);
      a.wanderA = fleeA;
      smoothTurn(a, fleeA, dt, 4.5);
      moveFacing(a, a.speed * 1.15, dt);
      a.x = clamp(a.x, 20, WORLD_W - 20);
      a.y = clamp(a.y, 20, WORLD_H - 20);
      resolveAnimalWorld(a);
      continue;
    }
    if (a.fleeUntil && game.time >= a.fleeUntil) {
      a.fleeUntil = 0;
      a.fleeFrom = null;
    }

    // timid wildlife behavior before hostile chase
    const skittishType = !!(info && info.flee);
    const babyAlwaysFlees = a.stage === "baby";
    const ambientFlee = !a.tameFailedAggro && !a.desperateAggro && !a.hostileTarget && !player.dead &&
      babyAlwaysFlees && dPlayer < 185;
    if (ambientFlee) {
      a.sleeping = false;
      a.fleeFrom = player;
      a.fleeUntil = Math.max(a.fleeUntil || 0, game.time + 0.55);
      const fleeA = angTo(player.x, player.y, a.x, a.y);
      a.wanderA = fleeA;
      smoothTurn(a, fleeA, dt, 4.5);
      moveFacing(a, a.speed * (babyAlwaysFlees ? 1.24 : 1.18), dt);
      a.x = clamp(a.x, 20, WORLD_W - 20);
      a.y = clamp(a.y, 20, WORLD_H - 20);
      resolveAnimalWorld(a);
      continue;
    }

    // enraged / hostile chase
    const isHostile = a.enraged || (!isFriendly && !babyAlwaysFlees) ||
      (isBossTier(a.stage) && !skittishType && !babyAlwaysFlees && a.type !== "fox");
    const aggroRange = a.tameFailedAggro ? 620 :
      a.desperateAggro ? 430 :
      a.enraged ? (a.stage === "bigmomma" ? 520 : a.stage === "superboss" ? 420 : 300) :
      (isBossTier(a.stage) ? 240 : (a.type === "bear" ? 170 : 190));

    if (isHostile && dPlayer < aggroRange && !player.dead) {
      const moveA = angTo(a.x, a.y, player.x, player.y);
      smoothTurn(a, moveA, dt, 4.8);

      // No minimum attack-distance stop. Always advance toward the player.
      const oldX = a.x, oldY = a.y;
      moveFacing(a, a.speed * 0.9, dt);
      a.x = clamp(a.x, 20, WORLD_W - 20);
      a.y = clamp(a.y, 20, WORLD_H - 20);
      resolveAnimalWorld(a);
      carryPlayerWithOfflineWildMovement(a, oldX, oldY);

      const headOnPlayer = animalHeadTouches(a, player.x, player.y, PLAYER_R * 0.82);
      if (headOnPlayer && a.atkCd <= 0) {
        const stageDmg = typeDmg(a.type, a.stage);
        const dmg = rand(stageDmg * 0.8, stageDmg * 1.15);
        damageTargetFromWild(a, player, dmg);
        a.atkCd = animalAttackCooldown(a.type, a.stage, false);
        a.attackAnim = 0.18;
        a.flash = 0.1;
        spark(player.x, player.y, "#e0563f", 6, 70);
      }
      // Wild powers use the same real combat target as bites.
      const abilityTarget = wildCombatTarget(a);
      if (a.abilityCd <= 0 && abilityTarget && dist(a.x, a.y, abilityTarget.x, abilityTarget.y) < 140 && Math.random() < 0.012) wildUseAbility(a);
    } else if (!isHostile && isFriendly && dPlayer < 300 && dPlayer > 45 && !player.dead) {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        const orbit = rand(90, 200);
        const ang = rand(0, TAU);
        a.wanderA = angTo(a.x, a.y, player.x + Math.cos(ang) * orbit, player.y + Math.sin(ang) * orbit);
        a.wanderT = rand(0.9, 2.2);
      }
      smoothTurn(a, a.wanderA, dt, 3.8);
      moveFacing(a, a.speed * 0.55, dt);
    } else if (isHostile && (a.tameFailedAggro || a.desperateAggro) && !player.dead) {
      const moveA = angTo(a.x, a.y, player.x, player.y);
      smoothTurn(a, moveA, dt, 4.1);
      moveFacing(a, a.speed * (a.tameFailedAggro ? 0.92 : 0.82), dt);
    } else {
      a.wanderT -= dt;
      if (a.wanderT <= 0) {
        a.wanderA = rand(0, TAU);
        a.wanderT = rand(1.2, 3.2);
        if (a.stage === "baby" && Math.random() < 0.1) a.sleeping = true;
        if (isBossTier(a.stage) && !a.enraged && Math.random() < (a.stage === "bigmomma" ? 0.22 : 0.08)) a.sleeping = true;
      }
      smoothTurn(a, a.wanderA, dt, 3.6);
      moveFacing(a, a.speed * 0.5, dt);
    }
    a.x = clamp(a.x, 20, WORLD_W - 20);
    a.y = clamp(a.y, 20, WORLD_H - 20);
    resolveAnimalWorld(a);
  }

  // owned pets
  for (const p of player.pets) {
    if (p.dead) continue;
    if (p.abilityCd > 0) p.abilityCd -= dt;
    if (p.flash > 0) p.flash -= dt;
    if (p.atkCd > 0) p.atkCd -= dt;
    if (p.combat > 0) p.combat -= dt;
    updateCreatureRecovery(p, dt, Math.max(1.2, p.maxHp * 0.024) * petUpgradeMultiplier(p.type, "regen"));
    p.tailPhase = (p.tailPhase || 0) + dt * (2.8 + p.speed * 0.02);

    if (player.riding === p) {
      p.x = player.x; p.y = player.y;
      smoothTurn(p, player.angle, dt, 7.5);
      continue;
    }

    if (p.forcedTarget && !combatTargetAlive(p.forcedTarget)) {
      p.forcedTarget = null;
      p.combat = 0;
    }
    if (p.forcedTarget) {
      petLockedCombat(p, p.forcedTarget, dt);
      p.x = clamp(p.x, 20, WORLD_W - 20);
      p.y = clamp(p.y, 20, WORLD_H - 20);
      resolveAnimalWorld(p);
      continue;
    }

    // Permanent Combat order: roam independently and hunt random triangles / wildlife.
    if (p.orderMode === "combat") {
      updateCombatHunt(p, dt);
      p.x = clamp(p.x, 20, WORLD_W - 20);
      p.y = clamp(p.y, 20, WORLD_H - 20);
      resolveAnimalWorld(p);
      continue;
    }

    // Follow / Defend / Set are peaceful unless something explicitly attacked
    // the owner/pet (handled above through forcedTarget) or the player manually
    // right-clicked a target. Only Combat mode proactively hunts by itself.
    let targetEn = null, bestD = Infinity, targetIsAnimal = false;

    if (targetEn) {
      const a = angTo(p.x, p.y, targetEn.x, targetEn.y);
      smoothTurn(p, a, dt, 4.8);
      const headOnTarget = animalHeadTouchesTarget(p, targetEn);
      if (!headOnTarget) {
        moveFacing(p, p.speed * 1.25, dt);
      } else if (p.atkCd <= 0) {
        const rawDmg = petAtkDmg(p);
        const dmg = targetIsAnimal ? animalDamageTaken(targetEn.type, targetEn.stage, rawDmg) : rawDmg;
        targetEn.hp -= dmg;
        targetEn.flash = 0.12;
        if (!targetIsAnimal) targetEn.revengeTarget = p;
        p.atkCd = animalAttackCooldown(p.type, p.stage, true);
        p.attackAnim = 0.18;
        if (targetIsAnimal) markCreatureHit(targetEn, 3.8);
        spark(targetEn.x, targetEn.y, "#7be08a", 5, 80);
        floatText(targetEn.x, targetEn.y - targetEn.r - 6, Math.round(dmg), "#7be08a");
        if (targetIsAnimal) {
          wildlifeHitByPet(targetEn, p);
        }
        const retaliationConnects = targetIsAnimal
          ? ((targetEn.atkCd || 0) <= 0 && animalHeadTouches(targetEn, p.x, p.y, p.r * 0.82))
          : Math.random() < 0.3;
        if (retaliationConnects) {
          p.hp -= upgradedPetDamageTaken(p, (targetEn.dmg || typeDmg(targetEn.type, targetEn.stage) || 7) * 0.4);
          p.flash = 0.15;
          markCreatureHit(p, 3.2);
          if (!targetIsAnimal) setPetAttackerTarget(p, targetEn);
          if (targetIsAnimal) {
            targetEn.atkCd = animalAttackCooldown(targetEn.type, targetEn.stage, false);
            targetEn.attackAnim = 0.18;
          }
          if (p.hp <= 0) {
            defeatOwnedPet(p, targetEn);
            continue;
          }
        }
        if (targetEn.hp <= 0 && !targetEn.dead) {
          if (targetIsAnimal) {
            targetEn.dead = true;
            game.kills++;
            givePetExp(p, petKillXpForAnimal(targetEn));
            spark(targetEn.x, targetEn.y, PET_TYPES[targetEn.type].color, 10, 100);
          } else {
            damageEnemy(targetEn, 0, false, p);
            givePetExp(p, petKillXpForEnemy(targetEn));
          }
        }
      }
    } else if (p.targetX != null) {
      const d = dist(p.x, p.y, p.targetX, p.targetY);
      if (d > 12) {
        const a = angTo(p.x, p.y, p.targetX, p.targetY);
        smoothTurn(p, a, dt, 4.6);
        moveFacing(p, p.speed * 1.3, dt);
      } else {
        p.targetX = null; p.targetY = null;
        p.follow = true;
        p.followReturning = false;
      }
    } else if (p.follow) {
      const ownerMoving = keys.has("w") || keys.has("a") || keys.has("s") || keys.has("d") ||
        keys.has("arrowup") || keys.has("arrowdown") || keys.has("arrowleft") || keys.has("arrowright") ||
        (mobileMode && typeof joyActive !== "undefined" && joyActive);
      const followRange = petFollowRangeFor(p);

      if (ownerMoving) {
        // Continuous formation following removes the old stop/sprint/stop cycle.
        if (!Number.isFinite(p._followSlotSide)) {
          const key = String(p.id || p.netId || p.type || "pet");
          let seed = 7;
          for (const ch of key) seed = ((seed * 31) + ch.charCodeAt(0)) | 0;
          p._followSlotSide = ((Math.abs(seed) % 5) - 2) * 0.52;
          p._followSlotDepth = 0.78 + (Math.abs(seed >> 3) % 4) * 0.14;
        }

        const speedT = clamp((Math.max(35, Number(p.speed) || 60) - 45) / 145, 0, 1);
        let trail = 48 + speedT * 70;
        if (p.type === "rabbit") trail += 22;
        trail = Math.max(trail, p.r * 0.75 + PLAYER_R + 14);

        const side = trail * p._followSlotSide;
        const back = trail * p._followSlotDepth;

        // Follow the player's TRAVEL direction, not aim/facing direction.
        // This prevents the formation from whipping around when the mouse turns.
        const move = currentMoveVector();
        const ml = Math.hypot(move.x, move.y);
        const dirX = ml > 0.05 ? move.x / ml : Math.cos(player.angle || 0);
        const dirY = ml > 0.05 ? move.y / ml : Math.sin(player.angle || 0);
        const desiredX = player.x - dirX * back - dirY * side;
        const desiredY = player.y - dirY * back + dirX * side;
        const safe = safePetFollowPoint(p, desiredX, desiredY);

        const targetFollow = 1 - Math.exp(-6.2 * dt);
        p._followTargetX = Number.isFinite(p._followTargetX)
          ? lerp(p._followTargetX, safe.x, targetFollow) : safe.x;
        p._followTargetY = Number.isFinite(p._followTargetY)
          ? lerp(p._followTargetY, safe.y, targetFollow) : safe.y;

        const dd = dist(p.x, p.y, p._followTargetX, p._followTargetY);
        if (dd > 5) {
          const a = angTo(p.x, p.y, p._followTargetX, p._followTargetY);
          smoothTurn(p, a, dt, 7.2);
          const speedMul = clamp(0.24 + dd / Math.max(62, trail * 0.78), 0.24, 1.58);
          moveFacing(p, p.speed * speedMul, dt);
          // Resolve on the same frame as movement so a follow step never visually
          // enters a solid object and gets popped back on the next frame.
          resolveAnimalWorld(p);
        }

        p.followReturning = dd > 16;
        p.idleWanderT = 0;
        p.idleTX = null; p.idleTY = null;
      } else {
        const d = dist(p.x, p.y, player.x, player.y);
        p.idleWanderT = (p.idleWanderT || 0) - dt;
        const wanderMax = followRange.wanderMax;
        const wanderMin = clamp(wanderMax * 0.38, 48, 78);

        if (d > wanderMax + 42) {
          const a = angTo(p.x, p.y, player.x, player.y);
          smoothTurn(p, a, dt, 5.3);
          moveFacing(p, p.speed * clamp(0.45 + (d - wanderMax) / 160, 0.45, 1.12), dt);
          p.idleTX = null; p.idleTY = null;
        } else {
          const targetBad = p.idleTX == null || p.idleTY == null ||
            dist(player.x, player.y, p.idleTX, p.idleTY) > wanderMax + 18;
          if (p.idleWanderT <= 0 || targetBad) {
            const ang = rand(0, TAU);
            const rad = rand(wanderMin, wanderMax);
            p.idleTX = player.x + Math.cos(ang) * rad;
            p.idleTY = player.y + Math.sin(ang) * rad;
            p.idleWanderT = rand(2.4, 5.0);
          }

          const dd = dist(p.x, p.y, p.idleTX, p.idleTY);
          if (dd < 18) {
            p.idleWanderT = rand(0.35, 0.8);
            p.idleTX = null; p.idleTY = null;
          } else {
            const a = angTo(p.x, p.y, p.idleTX, p.idleTY);
            smoothTurn(p, a, dt, 3.9);
            const cruise = clamp(0.26 + dd / 250, 0.30, 0.68);
            moveFacing(p, p.speed * cruise, dt);
          }
        }
      }
    }
    p.x = clamp(p.x, 20, WORLD_W - 20);
    p.y = clamp(p.y, 20, WORLD_H - 20);
    resolveAnimalWorld(p);
  }
  // Remove defeated pets immediately and rebuild the cards so no dead-pet card lingers.
  const petCountBeforeDeathCleanup = player.pets.length;
  player.pets = player.pets.filter(p => !p.dead);
  if (player.pets.length !== petCountBeforeDeathCleanup) {
    if (renamePetTarget && (renamePetTarget.dead || !player.pets.includes(renamePetTarget))) closePetRename();
    syncPetCards();
  }
  // animal ↔ animal separation using the actual physical body hitboxes.
  // Spatial buckets keep this fast even with hundreds of animals.
  const everyone = [];
  for (const a of animals) if (a && !a.dead) everyone.push(a);
  for (const p of player.pets) if (p && !p.dead && player.riding !== p) everyone.push(p);
  const SEP_CELL = 220;
  const sepGrid = new Map();
  const collisionMoved = new Set();

  for (let i = 0; i < everyone.length; i++) {
    const a = everyone[i];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    const cx = Math.floor(a.x / SEP_CELL), cy = Math.floor(a.y / SEP_CELL);
    const key = `${cx},${cy}`;
    let bucket = sepGrid.get(key);
    if (!bucket) { bucket = []; sepGrid.set(key, bucket); }
    bucket.push(i);
  }

  for (let i = 0; i < everyone.length; i++) {
    const a = everyone[i];
    if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    const cx = Math.floor(a.x / SEP_CELL), cy = Math.floor(a.y / SEP_CELL);

    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = sepGrid.get(`${gx},${gy}`);
        if (!bucket) continue;

        for (const j of bucket) {
          if (j <= i) continue;
          const b = everyone[j];
          if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;

          // Cheap broad-phase first, then exact body-circle collision.
          const broad = animalSpawnFootprint(a.type, a.stage) + animalSpawnFootprint(b.type, b.stage);
          const dx = b.x - a.x, dy = b.y - a.y;
          if (dx * dx + dy * dy > broad * broad) continue;

          if (resolveAnimalPhysicalPair(a, b)) {
            collisionMoved.add(a);
            collisionMoved.add(b);
          }
        }
      }
    }
  }

  // Collision separation should not push an animal through trees/rocks/world edges.
  for (const a of collisionMoved) {
    a.x = clamp(a.x, 20, WORLD_W - 20);
    a.y = clamp(a.y, 20, WORLD_H - 20);
    resolveAnimalWorld(a);
  }

  animals = animals.filter(a => !a.dead || a.owned);

  // keep the world full of animals
  const wildCount = animals.filter(a => !a.owned && !a.dead).length;
  if (wildCount < 300 && Math.random() < 0.016) spawnWildAnimal(true);
  if (wildCount < 250 && Math.random() < 0.04) spawnWildAnimal(false);
}

function updateAbilityFx(dt) {
  for (const fx of abilityFx) {
    fx.life -= dt;
    fx.phase = (fx.phase || 0) + dt * 4;
    // rings follow pet, fixed size, tick damage for ~5s
    if (fx.type === "cast") {
      // Visuals are drawn in drawAbilityFx(). Keep the update pass free of canvas
      // state changes so an ability can never fade the grass/background texture.
    } else if (fx.followPet) {
      const pet = fx.followPet;
      if (pet && !pet.dead) {
        fx.x = pet.x; fx.y = pet.y;
        fx.r = fx.baseR || (pet.r + 28);
        fx.tick = (fx.tick || 0) - dt;
        if (fx.tick <= 0) {
          fx.tick = 0.4;
          const rad = fx.r + 8;
          // triangles
          for (const en of enemies) {
            if (en.dead) continue;
            if (dist(fx.x, fx.y, en.x, en.y) < rad) {
              en.hp -= (fx.dmg || 4);
              en.flash = 0.08;
              if (fx.slow) {
                en.speed *= 0.75;
                setTimeout(() => { if (!en.dead) en.speed /= 0.75; }, 350);
              }
              if (en.hp <= 0) damageEnemy(en, 0, false, pet);
            }
          }
          // wild animals (hostile or any non-owned)
          for (const wa of animals) {
            if (wa.dead || wa.owned || wa === pet) continue;
            if (dist(fx.x, fx.y, wa.x, wa.y) < rad + wa.r * 0.3) {
              const dealt = animalDamageTaken(wa.type, wa.stage, (fx.dmg || 4));
              wa.hp -= dealt;
              wa.flash = 0.08;
              markCreatureHit(wa, 3.8);
              wa.sleeping = false;
              wa.enraged = true;
              if (wa.hp <= 0) {
                setKilledBy(wa, pet);
                wa.dead = true;
                game.kills++;
                spark(wa.x, wa.y, PET_TYPES[wa.type].color, 8, 80);
              }
            }
          }
        }
      } else fx.life = 0;
    }
  }
  abilityFx = abilityFx.filter(f => f.life > 0);
}

// ---------- collision (solid only) ----------
function resolveSolidCollisions() {
  // trees: only trunk
  for (const r of queryStaticNearby("resources", player.x, player.y, 180)) {
    if (!r.alive) continue;
    const solid = r.solidR;
    if (r.type === "tree" || r.type === "bush") {
      const c = resourceSolidCenter(r);
      const d = dist(player.x, player.y, c.x, c.y);
      if (d < solid + PLAYER_R * 0.7) {
        const a = angTo(c.x, c.y, player.x, player.y);
        player.x = c.x + Math.cos(a) * (solid + PLAYER_R * 0.7);
        player.y = c.y + Math.sin(a) * (solid + PLAYER_R * 0.7);
      }
    } else if (r.type === "rock") {
      const d = dist(player.x, player.y, r.x, r.y);
      if (d < solid + PLAYER_R) {
        const a = angTo(r.x, r.y, player.x, player.y);
        player.x = r.x + Math.cos(a) * (solid + PLAYER_R);
        player.y = r.y + Math.sin(a) * (solid + PLAYER_R);
      }
    } else if (r.type === "log") {
      const hit = deepestResourceOverlap(r, player.x, player.y, PLAYER_R);
      if (hit && hit.d > 0.1) {
        const a = angTo(hit.h.x, hit.h.y, player.x, player.y);
        player.x += Math.cos(a) * hit.overlap;
        player.y += Math.sin(a) * hit.overlap;
      }
    }
  }
  // gold chunks solid
  for (const g of goldChunks) {
    if (!g.infinite && g.goldLeft <= 0) continue;
    const gh = goldSolidHitbox(g);
    const d = dist(player.x, player.y, gh.x, gh.y);
    if (d < gh.r + PLAYER_R) {
      const a = angTo(gh.x, gh.y, player.x, player.y);
      player.x = gh.x + Math.cos(a) * (gh.r + PLAYER_R);
      player.y = gh.y + Math.sin(a) * (gh.r + PLAYER_R);
    }
  }
  for (const c of queryStaticNearby("chests", player.x, player.y, 100)) {
    if (c.opened) continue;
    const ch = chestSolidHitbox(c);
    const d = dist(player.x, player.y, ch.x, ch.y);
    if (d < ch.r + PLAYER_R * 0.9) {
      const a = angTo(ch.x, ch.y, player.x, player.y);
      player.x = ch.x + Math.cos(a) * (ch.r + PLAYER_R * 0.9);
      player.y = ch.y + Math.sin(a) * (ch.r + PLAYER_R * 0.9);
    }
  }
  // walls
  for (const w of walls) {
    const d = dist(player.x, player.y, w.x, w.y);
    if (d < w.r + PLAYER_R) {
      const a = angTo(w.x, w.y, player.x, player.y);
      player.x = w.x + Math.cos(a) * (w.r + PLAYER_R);
      player.y = w.y + Math.sin(a) * (w.r + PLAYER_R);
    }
  }
  // animals vs player (don't push if riding that pet)
  // Broad-phase first: only nearby animals get expensive multi-circle checks.
  const allAnimals = animals.concat(player.pets);
  const mv = currentMoveVector();
  const moveLen = Math.hypot(mv.x, mv.y);
  const moveX = moveLen > 0.05 ? mv.x / moveLen : 0;
  const moveY = moveLen > 0.05 ? mv.y / moveLen : 0;

  for (const a of allAnimals) {
    if (!a || a.dead || player.riding === a) continue;
    const broad = (a.r || 18) * 2.35 + PLAYER_R + 46;
    const bdx = player.x - a.x, bdy = player.y - a.y;
    if (bdx * bdx + bdy * bdy > broad * broad) continue;

    const hit = deepestAnimalPhysicalOverlap(a, player.x, player.y, PLAYER_R * 0.82);
    if (!hit || hit.d <= 0.1) continue;

    // The escape direction is sacred. Never push a player back toward an animal
    // when they are already moving out of the overlap.
    if (localMoveEscapingAnimal(a)) continue;

    if (net.room) {
      // Network animals stay server-authoritative. Locally, only cancel the
      // penetrating part of movement along the player's own movement axis; no
      // radial knockback and no visual animal shoving against server patches.
      if (moveLen > 0.05) {
        let tx = hit.h.x - player.x, ty = hit.h.y - player.y;
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const movingInto = moveX * tx + moveY * ty;
        if (movingInto > 0.02) {
          const stop = Math.min(9, Math.max(0, hit.overlap * 0.72));
          player.x -= moveX * stop;
          player.y -= moveY * stop;
        }
      }
      continue;
    }

    // Offline contact uses a weight-based split.
    // Small/light animals move more; large/heavy animals make the player yield more.
    const mobility = animalPushMobility(a);
    const weight = animalWeight(a);

    // Resolve penetration in small eased steps instead of one hard snap.
    const correction = Math.min(
      hit.overlap,
      1.25 + Math.sqrt(Math.max(0, hit.overlap)) * 1.35
    );

    const ang = angTo(hit.h.x, hit.h.y, player.x, player.y);
    const nx = Math.cos(ang), ny = Math.sin(ang);

    // Light animals receive most of the displacement.
    const animalShare = Math.max(0.10, Math.min(0.82, mobility * 0.92));
    const playerShare = 1 - animalShare;

    player.x += nx * correction * playerShare;
    player.y += ny * correction * playerShare;

    a.x -= nx * correction * animalShare;
    a.y -= ny * correction * animalShare;

    // Smooth residual correction prevents jitter when a huge animal is nearly immovable.
    a._pushVelX = (a._pushVelX || 0) * 0.62 - nx * correction * animalShare * 0.38;
    a._pushVelY = (a._pushVelY || 0) * 0.62 - ny * correction * animalShare * 0.38;
    a.x += a._pushVelX;
    a.y += a._pushVelY;

    // Keep the displacement bounded for very large weights.
    if (weight > 4) {
      a._pushVelX *= 0.72;
      a._pushVelY *= 0.72;
    }
  }
}

// ---------- day/night ----------
function updateTime(dt) {
  game.phaseTimer -= dt;
  if (game.phaseTimer <= 0) {
    game.phaseIdx = (game.phaseIdx + 1) % TIME_PHASES.length;
    if (game.phaseIdx === 0) game.dayCount++;
    const phase = TIME_PHASES[game.phaseIdx];
    game.phaseTimer = phase.duration;
    document.getElementById("timeBanner").textContent = phase.name + (phase.name === "Day" ? ` ${game.dayCount}` : "");
    document.getElementById("timeBanner").style.background = phase.color + "cc";
    if (phase.name === "Night") { sfx.night(); }
    if (phase.name === "Midnight") banner("Midnight — stronger triangles appear!");
  }
  const phase = TIME_PHASES[game.phaseIdx];
  if (phase.spawn) {
    game.waveTimer -= dt;
    if (game.waveTimer <= 0) {
      game.wave++;
      // Night: more frequent & denser; Midnight: even denser + stronger
      game.waveTimer = phase.strong ? 6.5 : 8.5;
      const base = phase.strong ? 5 : 4;
      const count = Math.min(base + Math.floor(game.wave * 1.6), phase.strong ? 14 : 11);
      for (let i = 0; i < count && enemies.length < 70; i++) spawnEnemy(phase.strong);
      // extra burst on midnight waves
      if (phase.strong && Math.random() < 0.45) {
        for (let i = 0; i < 3 && enemies.length < 70; i++) spawnEnemy(true);
      }
    }
  }
}

// ---------- fx update ----------

function trimRuntimeLists() {
  // Hard ceilings prevent effects/projectiles from ever growing into a freeze.
  if (particles.length > 900) particles.splice(0, particles.length - 900);
  if (floaters.length > 140) floaters.splice(0, floaters.length - 140);
  if (abilityFx.length > 120) abilityFx.splice(0, abilityFx.length - 120);
  if (projectiles.length > 260) projectiles.splice(0, projectiles.length - 260);
  if (petBlasts.length > 220) petBlasts.splice(0, petBlasts.length - 220);

  // Remove corrupted positions before collision/draw math can spread NaN values.
  const validPos = o => o && Number.isFinite(o.x) && Number.isFinite(o.y);
  if (animals.some(a => a && !validPos(a))) animals = animals.filter(a => !a || validPos(a));
  if (enemies.some(e => e && !validPos(e))) enemies = enemies.filter(e => !e || validPos(e));
  if (projectiles.some(p => p && !validPos(p))) projectiles = projectiles.filter(p => !p || validPos(p));
  if (petBlasts.some(p => p && !validPos(p))) petBlasts = petBlasts.filter(p => !p || validPos(p));
  if (player.pets.some(p => p && !validPos(p))) player.pets = player.pets.filter(p => !p || validPos(p));
}

function updateFx(dt) {
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.9; p.vy *= 0.9;
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
  for (const f of floaters) { f.y -= 28 * dt; f.life -= dt; }
  floaters = floaters.filter(f => f.life > 0);
}


function validDeathCamTarget(t) {
  if (!t || t === player) return false;
  if (!Number.isFinite(Number(t.x)) || !Number.isFinite(Number(t.y))) return false;
  return true;
}
function setKilledBy(victim, killer) {
  if (!victim || !killer || victim === killer) return;
  victim._killedBy = killer;
}
function setDeathCameraTarget(target, kind = "", id = "") {
  if (!validDeathCamTarget(target)) return false;
  game.deathCamTarget = target;
  game.deathCamTargetKind = kind || "";
  game.deathCamTargetId = id || target.netId || "";
  return true;
}
function resolveNetworkDeathCamTarget(kind, id) {
  id = String(id || "");
  if (!id) return null;

  if (kind === "animal") return net.animalVisuals.get(id) || null;
  if (kind === "enemy") return net.enemyVisuals.get(id) || null;
  if (kind === "pet") return net.remotePetVisuals.get(id) || player.pets.find(p => p && p.netId === id) || null;
  if (kind === "player" || kind === "playerProjectile" || kind === "projectile") {
    if (id === net.sessionId) return player;
    return net.remoteVisuals.get(id) || null;
  }
  return net.animalVisuals.get(id) || net.enemyVisuals.get(id) || net.remotePetVisuals.get(id) || net.remoteVisuals.get(id) || null;
}
function beginDeathCamera(killer, kind = "", id = "") {
  game.deathCamTarget = null;
  game.deathCamTargetKind = "";
  game.deathCamTargetId = "";
  if (validDeathCamTarget(killer)) setDeathCameraTarget(killer, kind, id);
}
function updateDeathCameraTargetChain() {
  if (!player.dead) return;

  let t = game.deathCamTarget;
  if (!t && game.deathCamTargetId) {
    t = resolveNetworkDeathCamTarget(game.deathCamTargetKind, game.deathCamTargetId);
    if (t) game.deathCamTarget = t;
  }

  // If the watched killer dies, jump to whatever killed it. Repeat as long as
  // another killer exists, so the camera can follow an entire revenge chain.
  let guard = 0;
  while (t && (t.dead || (t.hp != null && t.hp <= 0)) && guard++ < 12) {
    const next = t._killedBy || null;
    if (!validDeathCamTarget(next)) break;
    setDeathCameraTarget(next, next._netKind || "", next.netId || "");
    t = next;
  }
}
function deathCameraFocus() {
  updateDeathCameraTargetChain();
  return validDeathCamTarget(game.deathCamTarget) ? game.deathCamTarget : player;
}

// ---------- player update ----------
function updatePlayer(dt) {
  if (player.attackCd > 0) player.attackCd -= dt;
  if (player.shootCd > 0) player.shootCd -= dt;
  if (player.punchTimer > 0) player.punchTimer -= dt;
  if (player.hurtFlash > 0) player.hurtFlash -= dt;
  const runRegen = runRegenPerSec();
  if (runRegen > 0 && !player.dead && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + runRegen * dt);
  }

  if (player.dead) {
    player.splitT = Math.min(1, player.splitT + dt * 1.4);
    if (player.splitT >= 1 && !game.over) endGame();
    return;
  }

  const wx = mouse.sx + game.camX, wy = mouse.sy + game.camY;
  if (mobileMode && Math.hypot(joyDX, joyDY) > 0.10) {
    // Mobile has no mouse cursor; face the direction the player is actually moving.
    player.angle = Math.atan2(joyDY, joyDX);
  } else if (!mobileMode) {
    player.angle = angTo(player.x, player.y, wx, wy);
  }

  let dx = 0, dy = 0;
  if (keys.has("w") || keys.has("arrowup")) dy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dy += 1;
  if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
  if (keys.has("d") || keys.has("arrowright")) dx += 1;
  if (mobileMode && joyActive) { dx += joyDX; dy += joyDY; }
  if (dx || dy) {
    const len = Math.hypot(dx, dy) || 1;
    const analog = mobileMode && joyActive && !keys.size ? Math.min(1, len) : 1;
    let speed = 148;
    if (player.riding) speed = player.riding.speed || animalSpeed(player.riding.type, player.riding.stage, true);
    player.x += (dx / len) * speed * analog * dt;
    player.y += (dy / len) * speed * analog * dt;
  }
  player.x = clamp(player.x, PLAYER_R, WORLD_W - PLAYER_R);
  player.y = clamp(player.y, PLAYER_R, WORLD_H - PLAYER_R);

  resolveSolidCollisions();

  if (mouse.down) {
    if (player.tool === "Bow" && !player.heldSpecial) fireBow();
    else meleeAttack();
  }
  if (keys.has("f")) fireBow();

  // ride toggle (R)
  if (keys.has("r")) {
    keys.delete("r");
    if (player.hasSaddle) toggleRide();
  }
}

function buildRunShop(){
  const grid=document.getElementById("runShopGrid"), gold=document.getElementById("runShopGold");
  if(!grid)return;
  if(gold)gold.textContent=Math.floor(player.gold||0);
  grid.innerHTML="";
  const cats=[{id:"hat",name:"Hats"},{id:"cape",name:"Capes"},{id:"armor",name:"Armor"}];
  for(const cat of cats){
    const col=document.createElement("div"); col.className="run-shop-col";
    const h=document.createElement("h3");h.textContent=cat.name;col.appendChild(h);
    for(const item of RUN_SHOP_ITEMS.filter(i=>i.cat===cat.id)){
      const bought=runShop.purchased.has(item.id), equipped=runShop[item.cat]===item.id;
      const box=document.createElement("div");box.className="run-shop-item"+(equipped?" equipped":"");
      box.innerHTML=`<div class="title"><span>${item.icon} ${item.name}</span><span>🟡 ${item.cost}</span></div><div class="desc">${item.desc}</div>`;
      const b=document.createElement("button");b.className="btn";b.type="button";
      b.textContent=equipped?"Equipped":bought?"Equip":`Buy — ${item.cost} Gold`;
      b.disabled=equipped;
      b.addEventListener("click",()=>buyRunShopItem(item.id));
      box.appendChild(b);col.appendChild(box);
    }
    grid.appendChild(col);
  }
}
function toggleRunShop(force){
  const ov=document.getElementById("runShopOverlay");if(!ov)return;
  const open=force==null?!ov.classList.contains("show"):!!force;
  ov.classList.toggle("show",open);if(open)buildRunShop();
}
function applyRunShopPurchase(itemId,goldValue){
  const item=RUN_SHOP_BY_ID[itemId];if(!item)return;
  runShop.purchased.add(itemId);runShop[item.cat]=itemId;
  if(Number.isFinite(Number(goldValue)))player.gold=Math.max(0,Number(goldValue));
  buildRunShop();syncHud();banner(`${item.name} equipped`);
}
function buyRunShopItem(itemId){
  const item=RUN_SHOP_BY_ID[itemId];if(!item)return;
  if(net.room){
    try{net.room.send("runShopBuy",{id:itemId});}catch(_){banner("Shop connection failed",true);}
    return;
  }
  if(!runShop.purchased.has(itemId)){
    if(player.gold<item.cost){banner(`Need ${item.cost} gold`,true);return;}
    player.gold-=item.cost;runShop.purchased.add(itemId);
  }
  runShop[item.cat]=itemId;applyRunShopPurchase(itemId,player.gold);
}

// ---------- HUD ----------
const el = id => document.getElementById(id);
function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return m + ":" + String(s).padStart(2, "0");
}
function updateTameBtn() {
  const btn = el("tameBtn");
  if (!btn || !game.started || game.over) { if (btn) btn.classList.remove("show"); return; }
  if (game.tamePending) { btn.classList.remove("show"); return; }
  let near = false;
  for (const a of animals) {
    if (a.owned || a.dead || !a.sleeping || a.stage !== "baby") continue;
    if (dist(player.x, player.y, a.x, a.y) < 75) { near = true; break; }
  }
  btn.classList.toggle("show", near);
}

function syncHud() {
  renderPlayerLeaderboard();
  if (el("healthFill")) el("healthFill").style.width = clamp(player.health / player.maxHealth, 0, 1) * 100 + "%";
  if (el("resWood")) el("resWood").textContent = player.wood;
  if (el("resStone")) el("resStone").textContent = player.stone;
  if (el("resGold")) el("resGold").textContent = player.gold;
  if (el("resServs")) el("resServs").textContent = meta.servs;
  if (el("resBerries")) el("resBerries").textContent = player.berries || 0;
  if (el("dockWood")) el("dockWood").textContent = player.wood;
  if (el("dockStone")) el("dockStone").textContent = player.stone;
  if (el("dockGold")) el("dockGold").textContent = player.gold;
  if (el("dockServs")) el("dockServs").textContent = meta.servs;
  if (el("dockBerries")) el("dockBerries").textContent = player.berries || 0;
  syncHotbar();
  updatePetCardCooldowns();
  if (bannerTimer > 0) {
    bannerTimer -= 1 / 60;
    if (bannerTimer <= 0) el("banner").classList.remove("show");
  }
}

function getHotbarItems() {
  // The hotbar grows only when the player actually acquires a usable item.
  // Shop clothing/armor stays in Inventory and never consumes a combat slot.
  const items = [];
  const hotkeys = ["1","2","3","4","5","6","7","8","9","0"];
  let slot = 0;

  function add(entry) {
    if (slot >= hotkeys.length) return;
    items.push({ key: hotkeys[slot++], ...entry });
  }

  add({ tool: "Fist", label: "Fist" });

  for (const t of ["Axe", "Pickaxe", "Sword", "Bow"]) {
    if (player.owned[t]) add({ tool: t, label: t });
  }

  if (player.hasSaddle) {
    add({ tool: null, label: "Saddle", special: "Saddle" });
  }

  // Consumables only appear once you actually have some.
  if ((player.berries || 0) > 0) {
    add({ tool: null, label: "Berry", special: "Berry", qty: player.berries || 0 });
  }

  // Buildables appear after the player has unlocked/crafted them.
  if (player.owned.Wall) {
    add({ tool: null, label: "Wall" });
  }
  if (player.owned.Tower) {
    add({ tool: null, label: "Tower", special: "Tower" });
  }

  return items;
}
function iconSvg(name) {
  const s = {
    Fist: '<circle cx="13" cy="13" r="7" fill="#e8c9a0"/>',
    Axe: '<g transform="translate(0.5 0.5)"><path d="M12.4 5.2 L15 5.2 L15 22.4 L12.4 22.4 Z" fill="#9a5d31" stroke="#4f2f16" stroke-width="1"/><rect x="11.5" y="11" width="4.4" height="2.1" rx="0.9" fill="#c8844b" opacity="0.75"/><circle cx="14.3" cy="6.6" r="1.4" fill="#c8844b"/><path d="M4.9 10.2 L7.6 7.6 L12.4 7.6 L12.4 17.7 L7.6 17.7 L4.9 15.3 Z" fill="#b7a46f" stroke="#4c4230" stroke-width="1.05"/><path d="M6.4 10.6 L8.3 8.8 L11.6 8.8 L11.6 16.4 L8.3 16.4 L6.4 14.8 Z" fill="#d5c18b" opacity="0.42"/><path d="M6.5 9.9 Q5.5 12.4 6.5 15" fill="none" stroke="#eadcb5" stroke-width="0.9" stroke-linecap="round" opacity="0.7"/></g>',
    Pickaxe: '<rect x="13" y="7" width="3.5" height="20" rx="1.5" fill="#8a5a2b"/><path d="M5,10 Q14,4 25,8 L24,11 Q16,8 9,13Z" fill="#aab4bd" stroke="#4d555c" stroke-width="1"/><path d="M16,8 Q22,10 28,15 L26,18 Q20,13 14,11Z" fill="#8f9aa3"/>',
    Sword: '<g transform="translate(0.5 0.5)"><circle cx="6.4" cy="13" r="2.1" fill="#d8b23f" stroke="#7a5a16" stroke-width="0.9"/><rect x="7.2" y="11.7" width="4.2" height="2.6" rx="1.2" fill="#5e3a22" stroke="#3a2416" stroke-width="0.8"/><path d="M11.2 9.5 L13.7 9.5 L14.8 11.1 L14.8 14.9 L13.7 16.5 L11.2 16.5 Z" fill="#d8b23f" stroke="#8a6a20" stroke-width="0.9"/><path d="M14.7 10.3 L18.9 8.7 L23.6 13 L18.9 17.3 L14.7 15.7 Z" fill="#d9dee3" stroke="#737981" stroke-width="1"/><path d="M15.5 12.05 L20.1 12.05 L20.1 13.95 L15.5 13.95 Z" fill="#f8fbff" opacity="0.85"/><path d="M18.9 9.9 L21.8 13 L18.9 16.1" fill="none" stroke="#a8b0b8" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/></g>',
    Bow: '<path d="M20,3 Q28,13 20,23" stroke="#7a5327" stroke-width="3" fill="none"/><line x1="20" y1="5" x2="20" y2="21" stroke="#d9d9d9" stroke-width="1.5"/>',
    Wall: '<rect x="3" y="3" width="20" height="20" rx="2" fill="#a9744f" stroke="#5c3a22" stroke-width="2"/><line x1="3" y1="13" x2="23" y2="13" stroke="#5c3a22" stroke-width="1.5"/><line x1="13" y1="3" x2="13" y2="13" stroke="#5c3a22" stroke-width="1.5"/>',
    Tower: '<rect x="7" y="6" width="12" height="16" rx="2" fill="#6b5344"/><rect x="4" y="4" width="18" height="6" fill="#8a6a50"/><circle cx="13" cy="14" r="3" fill="#c94b4b"/>',
    Saddle: '<path d="M5 9 Q13 4 21 9 L19 17 Q13 20 7 17 Z" fill="#9a6238" stroke="#4a2d18" stroke-width="2"/><path d="M8 10 Q13 7 18 10" fill="none" stroke="#d8b23f" stroke-width="2"/><path d="M9 17 L7 23 M17 17 L19 23" stroke="#5c3a22" stroke-width="2.2" stroke-linecap="round"/>',
    Berry: '<circle cx="9" cy="15" r="5" fill="#d83d68"/><circle cx="17" cy="15" r="5" fill="#e65a80"/><circle cx="13" cy="10" r="4" fill="#c92e5c"/><path d="M13 7 Q16 3 20 5 Q17 9 13 9Z" fill="#6ab04c"/>', 
  };
  return `<svg class="ico" viewBox="0 0 26 26">${s[name] || ""}</svg>`;
}

function buildHotbar() {
  const bar = el("hotbar");
  bar.innerHTML = "";
  const items = getHotbarItems();
  for (const item of items) {
    const div = document.createElement("div");
    div.classList.add("slot");
    if (item.empty) div.style.opacity = "0.35";
    div.dataset.key = item.key;
    div.dataset.itemLabel = item.label || "";
    if (item.empty) {
      div.innerHTML = `<span class="key">${item.key}</span>`;
      div.title = "Empty — craft items to fill";
    } else {
      div.innerHTML = `<span class="key">${item.key}</span>${iconSvg(item.label)}${item.qty != null ? `<span class="qty">${item.qty}</span>` : ""}`;
      div.title = item.label === "Berry" ? `Berry ×${player.berries || 0} — select it, then click to eat` : item.label;
      div.addEventListener("click", () => handleHotkey(item.key));
    }
    bar.appendChild(div);
  }
  syncHotbar();
}
function syncHotbar() {
  // rebuild so newly crafted tools appear
  const bar = el("hotbar");
  if (!bar) return;
  const items = getHotbarItems();
  const slots = bar.querySelectorAll(".slot");
  const contentChanged = slots.length !== items.length || items.some((item, i) => {
    const slot = slots[i];
    if (!slot) return true;
    return (slot.dataset.itemLabel || "") !== (item.label || "");
  });
  if (contentChanged) { buildHotbar(); return; }
  items.forEach((item, i) => {
    const s = slots[i];
    if (!s) return;
    const isTool = !!item.tool;
    const berryActive = item.special === "Berry" && player.heldSpecial === "Berry";
    s.classList.toggle("active", (isTool && item.tool === player.tool && !player.heldSpecial) || berryActive);
    s.classList.toggle("locked", false);
    if (item.special === "Berry") {
      const q = s.querySelector(".qty");
      if (q) q.textContent = player.berries || 0;
      s.title = `Berry ×${player.berries || 0} — select it, then click to eat`;
    }
  });
}

const ELEM_GLOW = {
  Stone: "#c9a06a", Sound: "#a0e0ff", Fire: "#ff6a2a", Lightning: "#ffe66d",
  Ice: "#a8d8ff", Water: "#4aa3e0", Plant: "#7be08a", Wind: "#c0e8ff",
  Poison: "#5cb85c", Light: "#ffe66d", Earth: "#8a6040", Combat: "#e07040",
};
function petDisplayName(pet) {
  const fallback = PET_TYPES[pet.type] ? PET_TYPES[pet.type].name : "Pet";
  return (pet.petName || fallback).slice(0, 14);
}

let renamePetTarget = null;
function openPetRename(pet) {
  if (!pet || pet.dead) return;
  renamePetTarget = pet;
  const overlay = el("renamePetOverlay");
  const input = el("renamePetInput");
  const species = el("renamePetSpecies");
  const info = PET_TYPES[pet.type];
  if (species) species.textContent = info ? `${info.emoji} ${info.name}` : "Pet";
  if (input) {
    input.value = petDisplayName(pet);
    input.setSelectionRange(0, input.value.length);
  }
  if (overlay) {
    overlay.classList.add("show");
    overlay.setAttribute("aria-hidden", "false");
  }
  keys.clear();
  mouse.down = false;
  setTimeout(() => { if (input) input.focus(); }, 0);
}
function closePetRename() {
  const overlay = el("renamePetOverlay");
  if (overlay) {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }
  renamePetTarget = null;
  keys.clear();
}
function savePetRename() {
  const pet = renamePetTarget;
  if (!pet || pet.dead || !player.pets.includes(pet)) { closePetRename(); return; }
  const input = el("renamePetInput");
  const clean = ((input && input.value) || "").trim().replace(/[<>]/g, "").slice(0, 14);
  if (!clean) {
    banner("Type a name first", true);
    if (input) input.focus();
    return;
  }
  pet.petName = clean;
  if (net.room && pet.netId) { try { net.room.send("petRename", { id:pet.netId, name:clean }); } catch (_) {} }
  banner(`${PET_TYPES[pet.type].name} is now named ${clean}!`);
  closePetRename();
  hideLootPopup();
  syncPetCards();
}
function activateAllPetAbilities() {
  const readyPets = player.pets.filter(p => p && !p.dead && (p.abilityCd || 0) <= 0);
  if (!readyPets.length) {
    banner("No pet abilities are ready yet", true);
    return;
  }
  // Cast every currently-ready pet. Pets on cooldown are simply skipped.
  for (const pet of readyPets) activatePetAbility(pet, true);
  banner(`ALL ABILITIES! ${readyPets.length} pet${readyPets.length === 1 ? "" : "s"} cast at once`);
  syncPetCards();
}
function releasePet(pet) {
  if (!pet || pet.dead || !pet.owned) return;
  const name = petDisplayName(pet);
  if (net.room && pet.netId) {
    if (player.riding === pet) player.riding = null;
    try { net.room.send("petRelease", { id:pet.netId }); } catch (_) {}
    banner(name + " was released");
    return;
  }

  // If this is the current mount, get off before ownership changes.
  if (player.riding === pet) player.riding = null;

  // Remove it from the owned-pet roster first so other pet systems stop treating it as an ally.
  const idx = player.pets.indexOf(pet);
  if (idx >= 0) player.pets.splice(idx, 1);

  // Turn the same creature back into wildlife, preserving its stage, health, look, and level.
  pet.owned = false;
  pet.releasedWild = true;
  pet.follow = false;
  pet.orderMode = null;
  pet.targetX = null; pet.targetY = null;
  pet.huntTarget = null; pet.huntRetarget = 0; pet.huntWanderT = 0;
  pet.forcedTarget = null;
  pet.followReturning = false;
  pet.sleeping = false;
  pet.hp = Math.max(1, Math.min(pet.hp, pet.maxHp));
  pet.invulnerable = false;
  pet.speed = animalSpeed(pet.type, pet.stage, false);
  pet.wanderT = rand(0.4, 1.3);
  pet.wanderA = angTo(player.x, player.y, pet.x, pet.y);

  // A released pet is angry at the player. Even normally skittish species fight instead of fleeing.
  pet.enraged = true;
  pet.tameFailedAggro = true;
  pet.desperateAggro = true;
  pet.fleeUntil = 0;
  pet.fleeFrom = null;
  pet.hostileTarget = player;
  pet.combat = 9999;
  pet.recentHit = Math.max(pet.recentHit || 0, 2.5);

  if (!animals.includes(pet)) animals.push(pet);
  if (window._petSetTarget === pet) window._petSetTarget = null;

  spark(pet.x, pet.y, "#e0563f", 10, 100);
  floatText(pet.x, pet.y - pet.r - 12, "RELEASED", "#f2836a");
  banner(name + " was released — it is hostile now!");
  syncPetCards();
}

function syncPetCards() {
  const wrap = el("petCards");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (player.pets.length) {
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "pet-all-abilities";
    allBtn.innerHTML = "⚡ ALL<br>ABILITIES";
    allBtn.title = "Activate every pet ability that is ready";
    allBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateAllPetAbilities();
    });
    wrap.appendChild(allBtn);
  }

  player.pets.forEach((pet, petIndex) => {
    const info = PET_TYPES[pet.type];
    if (!info) return;
    const maxCd = info.abilityCd || 12;
    const cdLeft = Math.max(0, pet.abilityCd || 0);
    const ready = cdLeft <= 0;
    const name = petDisplayName(pet);
    const div = document.createElement("div");
    div.className = "pet-card" + (ready ? " ready" : " cd");
    div.dataset.petIndex = String(petIndex);
    div.style.setProperty("--glow", ELEM_GLOW[info.elem] || "#f4c65f");
    if (ready) div.style.borderColor = ELEM_GLOW[info.elem] || "#f4c65f";
    const fillPct = ready ? 0 : (cdLeft / maxCd) * 100;
    const combatActive = pet.orderMode === "combat" ? " active" : "";
    const defendActive = pet.orderMode === "defend" ? " active" : "";
    const followActive = pet.orderMode === "follow" ? " active" : "";
    const setActive = pet.orderMode === "set" ? " active" : "";
    div.innerHTML =
      `<div class="pc-cdbar" style="height:${fillPct}%"></div>` +
      `<div class="pc-icon">${info.emoji}</div>` +
      `<div class="pc-name">${name}</div>` +
      `<div class="pc-type">${info.name}</div>` +
      `<div class="pc-hp"><div class="pc-hp-fill" style="width:${Math.max(0,Math.min(100,(pet.hp/Math.max(1,pet.maxHp))*100))}%"></div></div>` +
      `<button class="pet-orders" type="button" title="Pet orders">⋯</button>` +
      `<div class="pet-menu" data-pet="${pet.type}">` +
      `<button data-cmd="ability" title="Use ability"><span class="cmd-ico">💥</span><span class="cmd-label">Ability</span></button>` +
      `<button data-cmd="rename" title="Rename pet"><span class="cmd-ico">✏️</span><span class="cmd-label">Rename</span></button>` +
      `<button data-cmd="combat" class="${combatActive}" title="Attack mode"><span class="cmd-ico">⚔️</span><span class="cmd-label">Attack</span></button>` +
      `<button data-cmd="defend" class="${defendActive}" title="Defend mode"><span class="cmd-ico">🛡️</span><span class="cmd-label">Defend</span></button>` +
      `<button data-cmd="set" class="${setActive}" title="Set pet destination"><span class="cmd-ico">🎯</span><span class="cmd-label">Target</span></button>` +
      `<button data-cmd="follow" class="${followActive}" title="Follow me"><span class="cmd-ico">👣</span><span class="cmd-label">Follow</span></button>` +
      `<button data-cmd="release" class="release" title="Release this pet"><span class="cmd-ico">🕊️</span><span class="cmd-label">Release</span></button></div>`;
    div.title = `${name} · ${info.name} (${pet.stage}) · Click to use ability · ⋯ for orders\nHP ${Math.ceil(pet.hp)}/${pet.maxHp}`;
    div.addEventListener("click", (e) => {
      if (e.target.closest(".pet-menu") || e.target.closest(".pet-orders")) return;
      activatePetAbility(pet);
    });
    const togglePetMenu = () => {
      const menu = div.querySelector(".pet-menu");
      if (!menu) return;
      const wasOpen = menu.classList.contains("show");
      document.querySelectorAll(".pet-menu").forEach((m) => m.classList.remove("show"));
      if (!wasOpen) menu.classList.add("show");
    };
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePetMenu();
    });
    const ordersBtn = div.querySelector(".pet-orders");
    if (ordersBtn) ordersBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePetMenu();
    });
    div.querySelectorAll(".pet-menu button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const cmd = btn.dataset.cmd;
        if (cmd === "ability") activatePetAbility(pet);
        else if (cmd === "rename") {
          openPetRename(pet);
        } else if (cmd === "combat") {
          pet.orderMode = "combat";
          pet.targetX = null; pet.targetY = null; pet.follow = false;
          pet.huntTarget = null; pet.huntRetarget = 0; pet.huntWanderT = 0;
          banner(petDisplayName(pet) + ": Combat mode — hunting enemies & wildlife");
        } else if (cmd === "defend") {
          pet.orderMode = "defend"; pet.targetX = null; pet.targetY = null; pet.follow = true;
          pet.huntTarget = null;
          banner(petDisplayName(pet) + ": Defending you");
        } else if (cmd === "set") {
          pet.orderMode = "set";
          pet.huntTarget = null;
          banner("Click the world to set " + petDisplayName(pet) + "'s destination");
          window._petSetTarget = pet;
        } else if (cmd === "follow") {
          pet.orderMode = "follow"; pet.follow = true; pet.targetX = null; pet.targetY = null;
          pet.huntTarget = null;
          banner(petDisplayName(pet) + ": Following");
        } else if (cmd === "release") {
          document.querySelectorAll(".pet-menu").forEach((m) => m.classList.remove("show"));
          releasePet(pet);
          return;
        }
        if (net.room && pet.netId && ["combat","defend","set","follow"].includes(cmd)) {
          const msg = { id:pet.netId, mode:pet.orderMode || cmd };
          if (pet.targetX != null) { msg.x=pet.targetX; msg.y=pet.targetY; }
          try { net.room.send("petOrder", msg); } catch (_) {}
        }
        document.querySelectorAll(".pet-menu").forEach((m) => m.classList.remove("show"));
        syncPetCards();
      });
    });
    wrap.appendChild(div);
  });
}
function updatePetCardCooldowns() {
  const wrap = el("petCards");
  if (!wrap) return;
  const cards = wrap.querySelectorAll(".pet-card[data-pet-index]");
  const livePets = player.pets.filter(p => p && !p.dead);
  if (cards.length !== livePets.length || livePets.length !== player.pets.length) {
    player.pets = livePets;
    syncPetCards();
    return;
  }
  cards.forEach((card) => {
    const idx = Number(card.dataset.petIndex);
    const pet = player.pets[idx];
    if (!pet || pet.dead) return;
    const info = PET_TYPES[pet.type];
    if (!info) return;
    const cdLeft = Math.max(0, pet.abilityCd || 0);
    const ready = cdLeft <= 0;
    card.classList.toggle("ready", ready);
    card.classList.toggle("cd", !ready);
    card.style.borderColor = ready ? (ELEM_GLOW[info.elem] || "#f4c65f") : "";
    const bar = card.querySelector(".pc-cdbar");
    if (bar) bar.style.height = ready ? "0%" : `${Math.min(100, (cdLeft / (info.abilityCd || 12)) * 100)}%`;
    const hpFill = card.querySelector(".pc-hp-fill");
    if (hpFill) {
      const hpRatio = clamp((pet.hp || 0) / Math.max(1, pet.maxHp || 1), 0, 1);
      hpFill.style.width = `${hpRatio * 100}%`;
      hpFill.style.background = hpRatio > 0.6 ? "#7be08a" : hpRatio > 0.3 ? "#f4c65f" : "#f2836a";
    }
  });
}

// ---------- crafting / inv ----------
function toggleCraft() {
  if (!game.started || game.over) return;
  const o = el("craftOverlay");
  if (o.classList.contains("show")) { o.classList.remove("show"); return; }
  buildCraftList();
  o.classList.add("show");
}
function buildCraftList() {
  const list = el("craftList");
  list.innerHTML = "";
  for (const c of CRAFTABLES) {
    const can = canAfford(c.cost) || (c.id in TOOLS && player.owned[c.id]);
    const div = document.createElement("div");
    div.className = "craft-item" + (canAfford(c.cost) ? "" : " cant");
    div.innerHTML = `<b>${c.name}</b><br><span style="opacity:0.7">${c.desc}</span><br><span style="color:#7be08a;font-size:11px">${costText(c.cost)}</span>`;
    div.addEventListener("click", () => doCraft(c));
    list.appendChild(div);
  }
}
function doCraft(c) {
  if (!canAfford(c.cost)) { banner("Not enough resources", true); return; }
  if (c.id in TOOLS) {
    if (player.owned[c.id]) { banner("Already own " + c.name); return; }
    pay(c.cost); player.owned[c.id] = true; player.tool = c.id;
    sfx.craft(); banner("Crafted " + c.name + "! Added to hotbar");
    buildHotbar();
  } else if (c.id === "Wall") {
    player.owned.Wall = true;
    placeWall();
    buildHotbar();
  } else if (c.id === "Tower") {
    player.owned.Tower = true;
    pay(c.cost);
    const a = player.angle;
    towers.push({ x: player.x + Math.cos(a) * 55, y: player.y + Math.sin(a) * 55, cd: 0.5 });
    sfx.craft(); banner("Watch Tower placed!");
    buildHotbar();
  } else if (c.id === "Saddle") {
    if (player.hasSaddle) { banner("Already have a saddle"); return; }
    pay(c.cost); player.hasSaddle = true;
    sfx.craft(); banner("Saddle ready! It is now in your hotbar — click it or press R near an adult/boss pet");
    buildHotbar();
  } else if (c.id === "HealPack") {
    pay(c.cost);
    player.health = clamp(player.health + 40, 0, player.maxHealth);
    sfx.eat(); banner("+40 HP");
  }
  buildCraftList();
  syncHotbar();
}
el("closeCraft").addEventListener("click", () => el("craftOverlay").classList.remove("show"));

function toggleInv() {
  if (!game.started || game.over) return;
  const o = el("invOverlay");
  if (o.classList.contains("show")) { o.classList.remove("show"); return; }
  buildInv();
  o.classList.add("show");
}
function buildInv() {
  const grid = el("invGrid");
  grid.innerHTML = "";

  // Inventory is for resources...
  const resources = [
    { name: "Wood", qty: player.wood, col: "#c99a5b", icon: "🪵" },
    { name: "Stone", qty: player.stone, col: "#a9b3bd", icon: "🪨" },
    { name: "Gold", qty: player.gold, col: "#f2c94c", icon: "🟡" },
    { name: "Berries", qty: player.berries || 0, col: "#e65a80", icon: "🍓" },
  ];

  for (const it of resources) {
    const div = document.createElement("div");
    div.className = "inv-slot";
    div.innerHTML = `<span style="color:${it.col}">${it.icon} ${it.name}</span><span class="qty">${it.qty}</span>`;
    grid.appendChild(div);
  }

  // ...and for selecting/equipping gear purchased from the in-game run shop.
  const purchasedGear = RUN_SHOP_ITEMS.filter(item => runShop.purchased.has(item.id));
  for (const item of purchasedGear) {
    const equipped = runShop[item.cat] === item.id;
    const div = document.createElement("div");
    div.className = "inv-slot";
    div.style.cursor = "pointer";
    if (equipped) {
      div.style.borderColor = "#7be08a";
      div.style.boxShadow = "0 0 0 1px rgba(123,224,138,.22) inset";
    }
    div.innerHTML =
      `<span>${item.icon} ${item.name}</span>` +
      `<span class="qty">${equipped ? "Equipped" : "Equip"}</span>`;
    div.title = item.desc + (equipped ? " — currently equipped" : " — click to equip");
    div.addEventListener("click", () => {
      if (runShop[item.cat] === item.id) return;
      buyRunShopItem(item.id);
      // buyRunShopItem/applyRunShopPurchase refreshes HUD/shop; refresh inventory too.
      setTimeout(() => {
        if (el("invOverlay")?.classList.contains("show")) buildInv();
      }, 0);
    });
    grid.appendChild(div);
  }

  if (!purchasedGear.length) {
    const div = document.createElement("div");
    div.className = "inv-slot";
    div.style.opacity = "0.65";
    div.innerHTML = `<span>🧢 Shop Gear</span><span class="qty">None bought</span>`;
    grid.appendChild(div);
  }
}
el("closeInv").addEventListener("click", () => el("invOverlay").classList.remove("show"));
el("invBtn").addEventListener("click", toggleInv);
el("craftBtn").addEventListener("click", toggleCraft);
el("runShopBtn").addEventListener("click", () => toggleRunShop());
el("closeRunShop").addEventListener("click", () => toggleRunShop(false));

// ---------- drawing ----------
function drawBackground() {
  ctx.save();
  ctx.translate(-game.camX, -game.camY);
  ctx.fillStyle = bgPattern;
  ctx.fillRect(game.camX, game.camY, W, H);
  // Soft forest shade so the ground feels richer without hurting readability.
  ctx.fillStyle = "rgba(24,38,24,0.06)";
  const startX = Math.floor(game.camX / 220) * 220;
  const startY = Math.floor(game.camY / 220) * 220;
  for (let y = startY; y < game.camY + H + 220; y += 220) {
    for (let x = startX; x < game.camX + W + 220; x += 220) {
      const ox = ((x * 13 + y * 7) % 37) - 18;
      const oy = ((x * 5 + y * 11) % 29) - 14;
      ctx.beginPath();
      ctx.ellipse(x + 110 + ox, y + 110 + oy, 52, 34, ((x + y) % 9) * 0.07, 0, TAU);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(20,30,20,0.5)";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, WORLD_W - 10, WORLD_H - 10);
  ctx.restore();
}

function circ(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function poly(pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach(([x,y], i) => i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y));
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawResource(r) {
  const pulse = 1 + (r.pulse > 0 ? r.pulse * 0.15 : 0);
  const sc = (r.scale || 1) * pulse;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(sc, sc);
  if (r.type === "tree") {
    // Top-down tree canopy: no visible trunk, just a leafy crown with slightly spiky edges.
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath(); ctx.ellipse(0, 20, 26, 10, 0, 0, TAU); ctx.fill();
    const spikeR1 = [38,32,37,31,36,32,37,31,36,33,37,31,38,32];
    ctx.fillStyle = "#1e5d2d";
    ctx.strokeStyle = "#133b1f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    spikeR1.forEach((rad, i) => {
      const a = i / spikeR1.length * TAU - Math.PI / 2;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath(); ctx.fill(); ctx.stroke();

    const spikeR2 = [30,24,29,25,28,24,29,25,29,24,28,25];
    ctx.fillStyle = "#2f7c3e";
    ctx.beginPath();
    spikeR2.forEach((rad, i) => {
      const a = i / spikeR2.length * TAU - Math.PI / 2 + 0.08;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = "#49a35a";
    circ(-11, -14, 10); circ(12, -10, 9); circ(13, 10, 8); circ(-14, 9, 8); circ(0, 2, 12);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath(); ctx.ellipse(-10, -16, 12, 5.4, -0.32, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(10, -9, 9, 4.2, 0.24, 0, TAU); ctx.fill();
  } else if (r.type === "rock") {
    poly([[-25,10],[-19,-16],[2,-27],[24,-16],[29,6],[15,23],[-13,22]], "#8f979f", "#596169");
    ctx.fillStyle = "#aab1b8";
    poly([[-12,4],[-8,-11],[3,-19],[15,-10],[12,3],[0,13]], "#b9c0c8", "rgba(0,0,0,0)");
    ctx.fillStyle = "#727981";
    ctx.beginPath(); ctx.ellipse(-8, 5, 6, 4, -0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11, 0, 5, 3.5, 0.35, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.38)"; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(6, -15); ctx.lineTo(15, -8); ctx.stroke();
  } else if (r.type === "log") {
    ctx.rotate(r.rot || 0);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.beginPath(); ctx.ellipse(2, 9, 35, 10.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#6a4326";
    ctx.strokeStyle = "#3f2414";
    ctx.lineWidth = 2.7;
    roundRect(-32, -10, 64, 20, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#835334";
    roundRect(-29, -7, 58, 7, 4); ctx.fill();
    ctx.fillStyle = "rgba(55,32,19,0.22)";
    roundRect(-30, 0, 60, 6, 3); ctx.fill();
    ctx.strokeStyle = "rgba(54,31,18,0.52)";
    ctx.lineWidth = 1.45;
    for (const xx of [-18, -5, 9, 21]) {
      ctx.beginPath(); ctx.moveTo(xx, -8); ctx.lineTo(xx + 4, 7); ctx.stroke();
    }
    // old knot holes
    ctx.fillStyle = "#3d2417";
    ctx.beginPath(); ctx.ellipse(-7, -1, 3.5, 2.7, -0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(10, 3, 2.7, 2.2, 0.15, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(150,108,73,0.35)";
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.ellipse(-7, -1, 5.6, 4.4, -0.2, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10, 3, 4.2, 3.3, 0.15, 0, TAU); ctx.stroke();
    // mushroom shelf clusters
    for (const [mx, my, s] of [[-18, -5, 1], [-13, -7, 0.8], [3, -6, 0.95]]) {
      ctx.fillStyle = "#d7c0a2";
      ctx.beginPath(); ctx.ellipse(mx, my + 1.5, 2.2 * s, 1.1 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#b87b5f";
      ctx.beginPath();
      ctx.moveTo(mx - 3.5 * s, my + 1.2 * s);
      ctx.quadraticCurveTo(mx, my - 2.4 * s, mx + 3.8 * s, my + 1.2 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#744736"; ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.fillStyle = "#b17a4d";
    ctx.strokeStyle = "#5a341f";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(31, 0, 8.5, 9.2, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "rgba(91,52,29,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(31, 0, 4.8, 5.5, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(31, 0, 2.1, 2.5, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "#5d3822";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-11, 6); ctx.lineTo(-19, 15); ctx.stroke();
  } else if (r.type === "bush") {
    // Top-down berry bush: leafy, spiky, and covered with berries on top.
    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.beginPath(); ctx.ellipse(0, 12, 18, 7, 0, 0, TAU); ctx.fill();
    const bushSpikes = [22,18,21,17,21,18,22,17,21,18,22,17];
    ctx.fillStyle = "#286e34";
    ctx.strokeStyle = "#184621";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    bushSpikes.forEach((rad, i) => {
      const a = i / bushSpikes.length * TAU - Math.PI / 2 + 0.04;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3f8f4a"; circ(-9, 2, 10.5);
    ctx.fillStyle = "#4aa858"; circ(10, 1, 10.5);
    ctx.fillStyle = "#57bb66"; circ(0, -8, 10.5);
    ctx.fillStyle = "#2f7b3b"; circ(-1, 9, 8.5);
    ctx.fillStyle = "#d1315c";
    for (const [bx,by,br] of [[-10,-2,3.2],[9,-5,3.1],[12,5,3.1],[-1,2,3.2],[3,8,2.8],[-7,8,2.7]]) circ(bx, by, br);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    circ(10, -6, 1.3); circ(-8, -3, 1.2); circ(2, 6, 1.2);
  }
  ctx.restore();
}

function drawTreeCanopy(r) {
  if (r.type !== "tree" || !r.alive) return;
  const pulse = 1 + (r.pulse > 0 ? r.pulse * 0.15 : 0);
  const sc = (r.scale || 1) * pulse;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(sc, sc);
  // Upper canopy overlay so player/animals still feel under the tree.
  ctx.globalAlpha = 0.74;
  const spikeR = [34,29,35,28,34,29,35,28,34,29,35,28];
  ctx.fillStyle = "#2d6b38";
  ctx.beginPath();
  spikeR.forEach((rad, i) => {
    const a = i / spikeR.length * TAU - Math.PI / 2 + 0.03;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#5aa466";
  circ(-7, -12, 11); circ(11, -6, 10); circ(8, 11, 9); circ(-11, 8, 8.5);
  ctx.fillStyle = "rgba(247,255,240,0.16)";
  ctx.beginPath(); ctx.ellipse(-8, -13, 10, 4.5, -0.34, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(10, -7, 8, 3.6, 0.22, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawGoldChunk(g) {
  if (!g.infinite && g.goldLeft <= 0) return;
  const s = 1 + (g.pulse > 0 ? g.pulse * 0.15 : 0);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(s, s);
  const r = g.r;
  if (g.pure) {
    ctx.shadowColor = "rgba(255,214,79,0.62)";
    ctx.shadowBlur = 28;
    ctx.fillStyle = "#efc34f";
    ctx.strokeStyle = "#7f6218";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-r * 0.96, r * 0.36);
    ctx.lineTo(-r * 0.82, -r * 0.22);
    ctx.lineTo(-r * 0.52, -r * 0.7);
    ctx.lineTo(-r * 0.08, -r * 0.98);
    ctx.lineTo(r * 0.38, -r * 0.88);
    ctx.lineTo(r * 0.88, -r * 0.34);
    ctx.lineTo(r * 0.98, r * 0.22);
    ctx.lineTo(r * 0.62, r * 0.82);
    ctx.lineTo(r * 0.02, r * 1.0);
    ctx.lineTo(-r * 0.68, r * 0.78);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#ffe07b";
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, -r * 0.2);
    ctx.lineTo(-r * 0.16, -r * 0.62);
    ctx.lineTo(r * 0.2, -r * 0.55);
    ctx.lineTo(0, -r * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.08);
    ctx.lineTo(r * 0.46, -r * 0.34);
    ctx.lineTo(r * 0.68, 0);
    ctx.lineTo(r * 0.24, r * 0.22);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.06);
    ctx.lineTo(r * 0.16, r * 0.42);
    ctx.lineTo(-r * 0.18, r * 0.64);
    ctx.lineTo(-r * 0.48, r * 0.28);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff1b2";
    ctx.beginPath(); ctx.ellipse(-r * 0.25, -r * 0.42, r * 0.3, r * 0.12, -0.45, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.28, -r * 0.18, r * 0.18, r * 0.08, -0.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.08, r * 0.46, r * 0.2, r * 0.08, 0.15, 0, TAU); ctx.fill();
    ctx.fillStyle = "#4a3510";
    ctx.font = `bold ${Math.max(18, r * 0.14)}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("PURE GOLD", 0, r * 0.06);
    ctx.restore();
    return;
  }
  // Normal gold chunks are solid gold — no gray stone base.
  ctx.shadowColor = "rgba(255,210,55,0.28)";
  ctx.shadowBlur = g.size === "huge" ? 12 : 6;
  ctx.fillStyle = "#d9a514";
  ctx.beginPath();
  ctx.moveTo(-r * 0.92, r * 0.5);
  ctx.lineTo(-r * 0.56, -r * 0.74);
  ctx.lineTo(r * 0.28, -r * 0.9);
  ctx.lineTo(r * 0.95, -r * 0.2);
  ctx.lineTo(r * 0.7, r * 0.72);
  ctx.lineTo(-r * 0.32, r * 0.88);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#8b6510"; ctx.lineWidth = Math.max(1.5, r * 0.06); ctx.stroke();

  // Gold facets across the whole chunk.
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, -r * 0.5);
  ctx.lineTo(r * 0.02, -r * 0.72);
  ctx.lineTo(r * 0.25, -r * 0.22);
  ctx.lineTo(-r * 0.18, r * 0.02);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#ffd95a";
  ctx.beginPath();
  ctx.moveTo(r * 0.25, -r * 0.22);
  ctx.lineTo(r * 0.76, -r * 0.14);
  ctx.lineTo(r * 0.5, r * 0.5);
  ctx.lineTo(r * 0.04, r * 0.28);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#e5b326";
  ctx.beginPath();
  ctx.moveTo(-r * 0.75, r * 0.34);
  ctx.lineTo(-r * 0.18, r * 0.02);
  ctx.lineTo(r * 0.04, r * 0.28);
  ctx.lineTo(-r * 0.28, r * 0.68);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = "#fff19a";
  ctx.beginPath();
  ctx.ellipse(-r * 0.18, -r * 0.42, r * 0.26, r * 0.08, -0.35, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(r * 0.38, -r * 0.05, r * 0.16, r * 0.06, -0.15, 0, TAU);
  ctx.fill();

  if (g.size === "huge") {
    ctx.fillStyle = "#f7cf43";
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.12);
    ctx.lineTo(-r * 0.08, -r * 0.1);
    ctx.lineTo(r * 0.18, r * 0.18);
    ctx.lineTo(-r * 0.12, r * 0.48);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawWall(w) {
  ctx.save();
  ctx.translate(w.x, w.y);
  const fade = w.ttl > 0 && w.ttl < 3 ? 0.4 + 0.6 * Math.abs(Math.sin(w.ttl * 6)) : 1;
  ctx.globalAlpha = fade;
  if (w.flash > 0) ctx.filter = "brightness(1.55)";

  if (w.kind === "stoneSpike") {
    ctx.fillStyle = "#858f98"; ctx.strokeStyle = "#3f4850"; ctx.lineWidth = 4;
    roundRect(-w.r, -w.r, w.r * 2, w.r * 2, 6); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#5b6670"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w.r, -w.r * .18); ctx.lineTo(w.r, -w.r * .18);
    ctx.moveTo(-w.r, w.r * .42); ctx.lineTo(w.r, w.r * .42);
    ctx.moveTo(-w.r * .28, -w.r); ctx.lineTo(-w.r * .28, w.r);
    ctx.moveTo(w.r * .38, -w.r); ctx.lineTo(w.r * .38, w.r); ctx.stroke();

    // Four obvious metal-stone spikes.
    ctx.fillStyle = "#d8e0e6"; ctx.strokeStyle = "#4a545d"; ctx.lineWidth = 2;
    const spike = (rot) => { ctx.save(); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(w.r - 2, -6); ctx.lineTo(w.r + 14, 0); ctx.lineTo(w.r - 2, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); };
    spike(0); spike(Math.PI/2); spike(Math.PI); spike(-Math.PI/2);
  } else {
    ctx.fillStyle = "#a9744f"; ctx.strokeStyle = "#5c3a22"; ctx.lineWidth = 4;
    roundRect(-w.r, -w.r, w.r * 2, w.r * 2, 5); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#5c3a22"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-w.r, 0); ctx.lineTo(w.r, 0); ctx.moveTo(0, -w.r); ctx.lineTo(0, w.r); ctx.stroke();
  }
  ctx.restore();

  if ((w.maxHp || 0) > 0 && (w.hp ?? w.maxHp) < w.maxHp) {
    const ratio = clamp((w.hp || 0) / Math.max(1, w.maxHp), 0, 1);
    drawTopHealthBar(w.x, w.y - w.r - 13, Math.max(34, w.r * 2), 6, ratio, w.kind === "stoneSpike" ? "#b8c5cf" : "#c48a5a", w.kind === "stoneSpike" ? "STONE WALL" : "WALL");
  }
}

function drawTower(t) {
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.fillStyle = "#6b5344";
  roundRect(-14, -18, 28, 36, 4); ctx.fill();
  ctx.fillStyle = "#8a6a50";
  ctx.fillRect(-18, -22, 36, 10);
  ctx.fillStyle = "#c94b4b";
  circ(0, -8, 5);
  ctx.restore();
}

function drawEnemy(en) {
  ctx.save();
  ctx.translate(en.x, en.y);
  if (en.ridingPetId || en.ridingPet) ctx.translate(0, -Math.max(11, (en.r || 17) * 0.72));
  ctx.rotate(en.angle);
  if (en.flash > 0) ctx.filter = "brightness(2)";

  const r = en.r;
  const body = en.hue;
  const outline = "#2a1414";
  const dark = shadeColor(body, -38);
  const light = shadeColor(body, 28);
  const weapon = en.weapon || (en.armed ? "Sword" : "Fist");
  const attackT = (en.attackAnim || 0) > 0
    ? Math.sin((1 - clamp(en.attackAnim / 0.28, 0, 1)) * Math.PI)
    : 0;

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(0, r * 0.9, r * 0.98, r * 0.4, 0, 0, TAU); ctx.fill();
  ctx.restore();

  const armColor = shadeColor(body, -18);
  const bodyHalf = r * 0.95;
  const shoulderX = r * 0.24;
  const shoulderSpread = r * 0.58;

  // Offhand arm.
  ctx.strokeStyle = armColor;
  ctx.lineWidth = Math.max(5.2, r * 0.32);
  ctx.lineCap = "round";
  let offHandX = r * 0.6;
  let offHandY = -r * 0.88;
  if (weapon === "Bow") { offHandX = r * 0.16; offHandY = -r * 0.62 - attackT * r * 0.1; }
  if (weapon === "Staff") { offHandX = r * 0.42; offHandY = -r * 0.72; }
  ctx.beginPath(); ctx.moveTo(shoulderX, -shoulderSpread); ctx.lineTo(offHandX, offHandY); ctx.stroke();
  ctx.fillStyle = light; circ(offHandX, offHandY, Math.max(3.2, r * 0.2));

  // Main arm and held item.
  let handX = r * 0.62, handY = r * 0.82;
  if (weapon === "Sword") {
    handX = lerp(r * 0.28, r * 0.98, attackT);
    handY = lerp(r * 0.72, -r * 0.26, attackT);
  } else if (weapon === "Bow") {
    handX = r * 0.74;
    handY = r * 0.18 + attackT * r * 0.04;
  } else if (weapon === "Staff") {
    handX = r * 0.74;
    handY = r * 0.18 + attackT * r * 0.03;
  } else if (weapon === "Fist") {
    handX = lerp(r * 0.62, r * 0.9, attackT);
    handY = lerp(r * 0.9, r * 0.14, attackT);
  }
  ctx.strokeStyle = armColor;
  ctx.lineWidth = Math.max(5.2, r * 0.32);
  ctx.beginPath(); ctx.moveTo(shoulderX, shoulderSpread); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.fillStyle = light; circ(handX, handY, Math.max(3.2, r * 0.2));

  if (weapon === "Sword") {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(0.18 - attackT * 1.32);
    ctx.fillStyle = "#5e3a22"; ctx.strokeStyle = "#3a2416"; ctx.lineWidth = 1.1;
    roundRect(-3, -4, 10, 8, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d5b14b"; ctx.strokeStyle = "#8a6a20"; ctx.lineWidth = 1;
    roundRect(5, -6, 5, 12, 1.8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d9dee3"; ctx.strokeStyle = "#71767c"; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(10, -3.8); ctx.lineTo(32, -1.5); ctx.lineTo(38, 0); ctx.lineTo(32, 1.5); ctx.lineTo(10, 3.8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#f8fbff"; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(13, -0.35); ctx.lineTo(31, -0.35); ctx.stroke();
    ctx.restore();
  } else if (weapon === "Bow") {
    ctx.save();
    ctx.translate(handX - r * 0.04, handY);
    ctx.rotate(-0.28 + attackT * 0.08);
    ctx.strokeStyle = "#6f4a2c"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 14, -1.1, 1.1); ctx.stroke();
    ctx.strokeStyle = "#d9d9d9"; ctx.lineWidth = 1.4;
    const pull = 3 + attackT * 4;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-pull, 0); ctx.lineTo(0, 12); ctx.stroke();
    // nocked arrow hint
    ctx.strokeStyle = "#70492a"; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(12, 0); ctx.stroke();
    ctx.fillStyle = "#b7cfe5";
    ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(10, -3); ctx.lineTo(10, 3); ctx.closePath(); ctx.fill();
    ctx.restore();
  } else if (weapon === "Staff") {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(0.25 - attackT * 0.18);
    ctx.strokeStyle = "#6f4a2c"; ctx.lineWidth = 4.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-2, 10); ctx.lineTo(5, -20); ctx.stroke();
    ctx.shadowColor = "rgba(199,125,255,0.7)"; ctx.shadowBlur = 10;
    ctx.fillStyle = "#c77dff"; circ(8, -24, 5.4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#efe0ff"; circ(7, -25, 2.1);
    ctx.restore();
  }

  // Cube body like the player.
  ctx.fillStyle = body;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3.2;
  roundRect(-bodyHalf, -bodyHalf, bodyHalf * 2, bodyHalf * 2, r * 0.24);
  ctx.fill(); ctx.stroke();

  // Outfit details.
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.42;
  roundRect(-bodyHalf * 0.54, -bodyHalf * 0.34, bodyHalf * 1.08, bodyHalf * 0.7, r * 0.16);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = weapon === "Bow" ? "#27546b" : weapon === "Staff" ? "#5d2c7f" : "#6e2020";
  ctx.lineWidth = Math.max(3.2, r * 0.16);
  ctx.beginPath(); ctx.moveTo(-bodyHalf * 0.42, -bodyHalf * 0.14); ctx.lineTo(bodyHalf * 0.34, -bodyHalf * 0.14); ctx.stroke();
  ctx.strokeStyle = "rgba(35,20,20,0.75)";
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.beginPath(); ctx.moveTo(-bodyHalf * 0.78, bodyHalf * 0.54); ctx.lineTo(bodyHalf * 0.78, bodyHalf * 0.54); ctx.stroke();
  ctx.fillStyle = "#caa85f";
  roundRect(-bodyHalf * 0.16, bodyHalf * 0.42, bodyHalf * 0.32, bodyHalf * 0.24, r * 0.08); ctx.fill();

  // Face.
  ctx.fillStyle = "#151515";
  const eyeX = bodyHalf * 0.5;
  const eyeDY = bodyHalf * 0.33;
  circ(eyeX, -eyeDY, Math.max(2.2, r * 0.14));
  circ(eyeX, eyeDY, Math.max(2.2, r * 0.14));
  ctx.fillStyle = "#fff";
  circ(eyeX + 1, -eyeDY - 1, Math.max(0.8, r * 0.045));
  circ(eyeX + 1, eyeDY - 1, Math.max(0.8, r * 0.045));
  ctx.strokeStyle = outline; ctx.lineWidth = Math.max(1.4, r * 0.08); ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(eyeX - r * 0.2, -eyeDY - r * 0.17); ctx.lineTo(eyeX + r * 0.04, -eyeDY - r * 0.04);
  ctx.moveTo(eyeX - r * 0.2, eyeDY + r * 0.17); ctx.lineTo(eyeX + r * 0.04, eyeDY + r * 0.04);
  ctx.stroke();
  ctx.strokeStyle = "#281717";
  ctx.lineWidth = Math.max(1.2, r * 0.08);
  ctx.beginPath();
  ctx.moveTo(bodyHalf * 0.12, 0);
  ctx.quadraticCurveTo(bodyHalf * 0.32, bodyHalf * 0.14, bodyHalf * 0.58, 0);
  ctx.stroke();

  if (en.strong) {
    ctx.strokeStyle = weapon === "Staff" ? "#d495ff" : "#ff6b9a"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.35, 0, TAU); ctx.stroke();
    ctx.strokeStyle = weapon === "Staff" ? "rgba(212,149,255,0.45)" : "rgba(255,107,154,0.45)"; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.52, 0, TAU); ctx.stroke();
    ctx.fillStyle = weapon === "Staff" ? "#e3b6ff" : "#ff90b6";
    circ(-bodyHalf * 0.72, -bodyHalf * 0.72, 2.2);
    circ(-bodyHalf * 0.72, bodyHalf * 0.72, 2.2);
    circ(bodyHalf * 0.06, -bodyHalf * 0.78, 2.2);
  }

  ctx.filter = "none";
  ctx.restore();

  if (en.ridingPetId || en.ridingPet) {
    ctx.save(); ctx.fillStyle="#f2d59a"; ctx.font="bold 9px sans-serif"; ctx.textAlign="center";
    ctx.fillText("RIDER", en.x, en.y - en.r - 25); ctx.restore();
  }
  if (en.hp < en.maxHp) {
    const bw = Math.max(30, en.r * 1.8);
    ctx.save();
    ctx.translate(en.x - bw / 2, en.y - r - 16);
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(0, 0, bw, 5);
    ctx.fillStyle = "#e0563f"; ctx.fillRect(0, 0, bw * clamp(en.hp / en.maxHp, 0, 1), 5);
    ctx.restore();
  }
}

function drawProjectile(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(p.vy, p.vx));

  if (p.kind === "arcaneBolt") {
    ctx.shadowColor = p.color || "#c77dff";
    ctx.shadowBlur = 14;
    ctx.fillStyle = p.color || "#c77dff";
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 5.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#efe0ff";
    ctx.beginPath(); ctx.ellipse(-2, 0, 4.2, 2.2, 0, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(199,125,255,0.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-3, 0); ctx.stroke();
  } else {
    const shaft = p.hostile ? "#70492a" : "#4a3520";
    const fletch = p.hostile ? "#d9537d" : "#7ec0ee";
    const metal = p.hostile ? "#b9c8d6" : "#9aa0a6";
    ctx.strokeStyle = shaft; ctx.lineWidth = 3.1; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(9, 0); ctx.stroke();
    ctx.fillStyle = fletch;
    ctx.beginPath();
    ctx.moveTo(-10, 0); ctx.lineTo(-15, -4); ctx.lineTo(-12, 0); ctx.lineTo(-15, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = metal;
    ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}



function drawMountedSaddleOnCustom(baseW, baseH, sx, sy, sw, sh) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = "#5f3920";
  ctx.strokeStyle = "#2d1a10";
  ctx.lineWidth = 2;
  roundRect(-sw * 0.52, -sh * 0.52, sw * 1.04, sh * 0.86, Math.max(3, sh * 0.22)); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#8a562f";
  roundRect(-sw * 0.22, -sh * 0.86, sw * 0.44, sh * 0.36, Math.max(3, sh * 0.15)); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#7a5030";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-sw * 0.2, -sh * 0.08);
  ctx.lineTo(-sw * 0.2, sh * 0.72);
  ctx.moveTo(sw * 0.14, -sh * 0.08);
  ctx.lineTo(sw * 0.14, sh * 0.72);
  ctx.stroke();
  ctx.strokeStyle = "#c8a55d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-sw * 0.44, 0);
  ctx.lineTo(sw * 0.44, 0);
  ctx.stroke();
  ctx.fillStyle = "#d8bc75";
  roundRect(sw * 0.29, -sh * 0.08, sw * 0.16, sh * 0.16, Math.max(2, sh * 0.04)); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawCustomDesignedPet(a) {
  if (drawUploadedAnimalSkin(a)) return true;
  if (!["dog", "cat", "dragon", "fox", "wolf"].includes(a.type)) return false;
  const meta = CUSTOM_PET_SEGMENTS[a.type];
  if (!meta) return false;

  const stageKey = a.stage === "baby" ? "baby" :
                   a.stage === "boss" ? "boss" :
                   a.stage === "superboss" ? "superboss" :
                   a.stage === "bigmomma" ? "bigmomma" : "adult";

  let img = null;
  let box = null;
  const preferSleepArt = !!(a.sleeping && CUSTOM_SLEEP_PET_IMAGES[a.type] && CUSTOM_SLEEP_PET_IMAGES[a.type][stageKey]);
  if (preferSleepArt) {
    img = CUSTOM_SLEEP_PET_IMAGES[a.type][stageKey];
    if (!img.complete || !img.naturalWidth) return false;
    box = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  } else if (CUSTOM_STAGE_PET_IMAGES[a.type] && CUSTOM_STAGE_PET_IMAGES[a.type][stageKey]) {
    img = CUSTOM_STAGE_PET_IMAGES[a.type][stageKey];
    if (!img.complete || !img.naturalWidth) return false;
    box = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  } else {
    img = REFERENCE_PET_SPRITES[a.type];
    if (!img || !img.complete || !img.naturalWidth) return false;
    box = meta.stages[stageKey] || meta.stages.adult;
  }

  const r = a.r;
  const wag = Math.sin(a.tailPhase || 0) * (a.sleeping ? 0.06 : 1.0);
  const sleepTailTuck = a.sleeping ? (a.type === "cat" ? 0.28 : a.type === "fox" ? 0.24 : a.type === "dog" ? 0.20 : 0.16) : 0;
  const sleepTailShift = a.sleeping ? r * (a.type === "cat" ? 0.20 : a.type === "fox" ? 0.18 : 0.15) : 0;
  const attackT = Math.max(0, Math.min(1, a.attackAnim || 0));
  const bite = Math.sin(attackT * Math.PI);
  const sleepBob = a.sleeping ? Math.sin(game.time * 2.2 + a.x * 0.01) * r * 0.03 : 0;
  const drawH = r * meta.drawHMul;
  const drawW = drawH * (box.w / box.h);
  const scale = drawH / box.h;
  const x0 = -drawW * meta.anchorX;
  const y0 = -drawH * meta.anchorY;
  const overlap = box.w * meta.overlap;

  if (preferSleepArt) {
    ctx.save();
    const prevSmooth = ctx.imageSmoothingEnabled;
    const prevSmoothQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(0, sleepBob);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.ellipse(meta.shadow.x * r, meta.shadow.y * r, meta.shadow.rx * r, meta.shadow.ry * r, 0, 0, TAU);
    ctx.fill();
    ctx.drawImage(img, x0, y0, drawW, drawH);
    if (player.riding === a) {
      drawMountedSaddleOnCustom(drawW, drawH, meta.saddle.x * r, meta.saddle.y * r, meta.saddle.w * r, meta.saddle.h * r);
    }
    ctx.imageSmoothingEnabled = prevSmooth;
    ctx.imageSmoothingQuality = prevSmoothQuality;
    ctx.restore();
    return true;
  }

  const tailEnd = box.x + box.w * meta.tailEnd;
  const headStart = box.x + box.w * meta.headStart;
  const tailPivotX = box.x + box.w * meta.tailPivot;
  const headPivotX = box.x + box.w * meta.headPivot;
  const centerY = box.y + box.h * 0.5;

  const tailPart = {
    sx: box.x,
    sy: box.y,
    sw: Math.max(1, Math.round(tailEnd - box.x + overlap)),
    sh: box.h,
    px: tailPivotX,
    py: centerY
  };
  const bodyPart = {
    sx: Math.max(box.x, Math.round(tailEnd - overlap)),
    sy: box.y,
    sw: Math.max(1, Math.round((headStart - tailEnd) + overlap * 2)),
    sh: box.h
  };
  const headPart = {
    sx: Math.max(box.x, Math.round(headStart - overlap)),
    sy: box.y,
    sw: Math.max(1, Math.round((box.x + box.w) - (headStart - overlap))),
    sh: box.h,
    px: headPivotX,
    py: centerY
  };

  function drawStatic(part) {
    ctx.drawImage(
      img,
      part.sx, part.sy, part.sw, part.sh,
      x0 + (part.sx - box.x) * scale,
      y0 + (part.sy - box.y) * scale,
      part.sw * scale,
      part.sh * scale
    );
  }
  function drawRotated(part, rot, tx = 0, ty = 0) {
    ctx.save();
    ctx.translate(x0 + (part.px - box.x) * scale + tx, y0 + (part.py - box.y) * scale + ty);
    ctx.rotate(rot);
    ctx.drawImage(
      img,
      part.sx, part.sy, part.sw, part.sh,
      (part.sx - part.px) * scale,
      (part.sy - part.py) * scale,
      part.sw * scale,
      part.sh * scale
    );
    ctx.restore();
  }

  ctx.save();
  const prevSmooth = ctx.imageSmoothingEnabled;
  const prevSmoothQuality = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(0, sleepBob);
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(meta.shadow.x * r, meta.shadow.y * r, meta.shadow.rx * r, meta.shadow.ry * r, 0, 0, TAU);
  ctx.fill();

  drawRotated(tailPart, meta.tailRotBase + sleepTailTuck + wag * meta.tailRotAmp, sleepTailShift, 0);
  drawStatic(bodyPart);
  drawRotated(headPart, bite * meta.headRotAmp, bite * meta.headPush * r, 0);

  if (a.sleeping && !preferSleepArt) {
    // Fallback only if a custom sleeping-eye stage image is missing.
    const sleepEyeByType = {
      dog:    { x: 0.845, y1: 0.33, y2: 0.67, rx: 0.205, ry: 0.155 },
      cat:    { x: 0.855, y1: 0.33, y2: 0.67, rx: 0.195, ry: 0.145 },
      dragon: { x: 0.865, y1: 0.32, y2: 0.68, rx: 0.205, ry: 0.145 },
      fox:    { x: 0.825, y1: 0.31, y2: 0.69, rx: 0.205, ry: 0.155 },
      wolf:   { x: 0.84, y1: 0.34, y2: 0.66, rx: 0.205, ry: 0.15 },
    };
    const eyeCfg = sleepEyeByType[a.type] || sleepEyeByType.dog;
    const eyeX = x0 + box.w * scale * eyeCfg.x;
    const eyeYs = [y0 + box.h * scale * eyeCfg.y1, y0 + box.h * scale * eyeCfg.y2];
    const eyeRX = Math.max(4, r * eyeCfg.rx);
    const eyeRY = Math.max(3, r * eyeCfg.ry);
    ctx.fillStyle = "#050505";
    for (const ey of eyeYs) {
      ctx.beginPath();
      ctx.ellipse(eyeX, ey, eyeRX, eyeRY, 0, 0, TAU);
      ctx.fill();
    }
  }

  if (player.riding === a) {
    drawMountedSaddleOnCustom(drawW, drawH, meta.saddle.x * r, meta.saddle.y * r, meta.saddle.w * r, meta.saddle.h * r);
  }

  ctx.imageSmoothingEnabled = prevSmooth;
  ctx.imageSmoothingQuality = prevSmoothQuality;
  ctx.restore();
  return true;
}

function drawReferencePetSprite(a) {
  const meta = REFERENCE_PET_SPRITE_META[a.type];
  const img = REFERENCE_PET_SPRITES[a.type];
  if (!meta || !img || !img.complete || !img.naturalWidth) return false;
  const r = a.r;
  const drawW = r * meta.wMul;
  const drawH = drawW * (img.naturalHeight / img.naturalWidth);
  const attackT = Math.max(0, Math.min(1, a.attackAnim || 0));
  const attackShift = Math.sin(attackT * Math.PI) * r * 0.18;
  const wag = Math.sin(a.tailPhase || 0) * (a.sleeping ? 0.02 : 0.09);
  const sleepBob = a.sleeping ? Math.sin(game.time * 2.4 + a.x * 0.01) * r * 0.02 : 0;

  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(-r * 0.05, r * 0.22, drawW * 0.28, drawH * 0.14, 0, 0, TAU);
  ctx.fill();

  ctx.save();
  const prevSmooth = ctx.imageSmoothingEnabled;
  const prevSmoothQuality = ctx.imageSmoothingQuality;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(attackShift, wag * r * 0.25 + sleepBob);
  ctx.rotate(wag * 0.08);
  ctx.drawImage(img, -drawW * meta.anchorX, -drawH * meta.anchorY, drawW, drawH);

  if (player.riding === a) {
    ctx.save();
    const sx = drawW * meta.saddleX;
    const sy = drawH * meta.saddleY;
    const sw = drawW * meta.saddleW;
    const sh = drawH * meta.saddleH;
    ctx.translate(sx, sy);
    ctx.fillStyle = "#5f3920";
    ctx.strokeStyle = "#2d1a10";
    ctx.lineWidth = 2;
    roundRect(-sw * 0.52, -sh * 0.52, sw * 1.04, sh * 0.86, Math.max(3, sh * 0.22)); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#8a562f";
    roundRect(-sw * 0.22, -sh * 0.86, sw * 0.44, sh * 0.36, Math.max(3, sh * 0.15)); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#7a5030";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-sw * 0.2, -sh * 0.08);
    ctx.lineTo(-sw * 0.2, sh * 0.72);
    ctx.moveTo(sw * 0.14, -sh * 0.08);
    ctx.lineTo(sw * 0.14, sh * 0.72);
    ctx.stroke();
    ctx.strokeStyle = "#c8a55d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-sw * 0.44, 0);
    ctx.lineTo(sw * 0.44, 0);
    ctx.stroke();
    ctx.fillStyle = "#d8bc75";
    roundRect(sw * 0.29, -sh * 0.08, sw * 0.16, sh * 0.16, Math.max(2, sh * 0.04)); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  ctx.imageSmoothingEnabled = prevSmooth;
  ctx.imageSmoothingQuality = prevSmoothQuality;
  ctx.restore();
  return true;
}

function drawAnimal(a) {
  if (a.dead) return;
  const info = PET_TYPES[a.type];
  const r = a.r;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  if (a.flash > 0) ctx.filter = "brightness(1.8)";
  const customDesigned = drawCustomDesignedPet(a);
  if (!customDesigned) {
  const col = a.coat || info.color;
  const outline = "#1a1a1a";
  const dark = shadeColor(col, -35);
  const light = shadeColor(col, 30);
  const wag = Math.sin(a.tailPhase || 0) * (a.sleeping ? 0.05 : 0.45);

  const nowMs = performance.now();
  const recentlyMoved = (nowMs - (a._visualMoveAt || 0)) < 150;
  const actualMoveSpeed = (!a.sleeping && recentlyMoved) ? Math.max(0, Number(a._visualMoveSpeed) || 0) : 0;
  const normalMoveSpeed = Math.max(1, Number(a.speed) || animalSpeed(a.type, a.stage, !!a.owned) || 1);
  const moveRatio = Math.max(0, Math.min(1.9, actualMoveSpeed / normalMoveSpeed));
  const slitherT = nowMs * 0.001;
  const snakeWaveSpeed = 4.0 + moveRatio * 8.8;
  const snakeTailSwing = (a.type === "snake" && moveRatio > 0.03)
    ? Math.sin(slitherT * snakeWaveSpeed + (a.tailPhase || 0)) * r * (0.10 + moveRatio * 0.28)
    : 0;
  const snakeMidSwing = (a.type === "snake" && moveRatio > 0.03)
    ? Math.sin(slitherT * snakeWaveSpeed + (a.tailPhase || 0) + 0.85) * r * (0.08 + moveRatio * 0.22)
    : 0;
  const snakeHeadSwing = (a.type === "snake" && moveRatio > 0.03)
    ? Math.sin(slitherT * snakeWaveSpeed + (a.tailPhase || 0) + 1.55) * r * (0.05 + moveRatio * 0.12)
    : 0;

  // ============================================================
  // Taming.io-style: TAIL → BODY → HEAD, ears at neck junction
  // ============================================================

  // --- TAIL (drawn first, behind body) ---
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (a.type === "fox") {
    // smooth diamond / teardrop bushy tail (rounded, not pointed)
    const ty = wag * r * 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    // base at body
    ctx.moveTo(-r * 0.65, -r * 0.18);
    // upper curve out to widest point, then soft tip
    ctx.quadraticCurveTo(-r * 1.15, ty - r * 0.55, -r * 1.55, ty - r * 0.35);
    ctx.quadraticCurveTo(-r * 1.95, ty - r * 0.12, -r * 2.05, ty); // soft tip
    ctx.quadraticCurveTo(-r * 1.95, ty + r * 0.12, -r * 1.55, ty + r * 0.35);
    ctx.quadraticCurveTo(-r * 1.15, ty + r * 0.55, -r * 0.65, r * 0.18);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2.6; ctx.stroke();
    // cream tip blob
    ctx.fillStyle = "#f5e6d0";
    ctx.beginPath(); ctx.ellipse(-r * 1.95, ty, r * 0.28, r * 0.22, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1.6; ctx.stroke();
  } else if (a.type === "cat") {
    // thin long curved tail
    const ty = wag * r * 0.75;
    ctx.strokeStyle = outline; ctx.lineWidth = r * 0.28;
    ctx.beginPath(); ctx.moveTo(-r * 0.75, 0); ctx.quadraticCurveTo(-r * 1.4, ty * 0.6, -r * 1.85, ty); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = r * 0.18;
    ctx.beginPath(); ctx.moveTo(-r * 0.75, 0); ctx.quadraticCurveTo(-r * 1.4, ty * 0.6, -r * 1.85, ty); ctx.stroke();
  } else if (a.type === "dog") {
    // medium thick tail
    const ty = -r * 0.15 + wag * r * 0.45;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.12);
    ctx.quadraticCurveTo(-r * 1.35, ty - r * 0.18, -r * 1.65, ty);
    ctx.quadraticCurveTo(-r * 1.3, ty + r * 0.2, -r * 0.7, r * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2.2; ctx.stroke();
  } else if (a.type === "wolf") {
    // bushy held-out tail
    const ty = wag * r * 0.35;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, -r * 0.15);
    ctx.quadraticCurveTo(-r * 1.55, ty - r * 0.3, -r * 1.95, ty);
    ctx.quadraticCurveTo(-r * 1.5, ty + r * 0.32, -r * 0.75, r * 0.15);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2.4; ctx.stroke();
  } else if (a.type === "bear") {
    // tiny stub
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(-r * 0.95, wag * r * 0.08, r * 0.2, r * 0.16, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
  } else if (a.type === "rabbit") {
    ctx.fillStyle = "#fff";
    circ(-r * 0.95, wag * r * 0.1, r * 0.32);
    ctx.strokeStyle = outline; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(-r * 0.95, wag * r * 0.1, r * 0.32, 0, TAU); ctx.stroke();
    ctx.fillStyle = "#f0e8e0"; circ(-r * 0.95, wag * r * 0.1, r * 0.16);
  } else if (a.type === "owl") {
    // short fan tail
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.25);
    ctx.lineTo(-r * 1.25, -r * 0.35 + wag * r * 0.15);
    ctx.lineTo(-r * 1.25, r * 0.35 + wag * r * 0.15);
    ctx.lineTo(-r * 0.7, r * 0.25);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
  } else if (a.type === "snake") {
    // Viper: no torso block — just a long slithering tail/body line plus the head.
    // The wiggle only happens while it is actually moving.
    const rearY = snakeTailSwing;
    const midY = snakeMidSwing;
    const neckY = snakeHeadSwing * 0.7;

    ctx.strokeStyle = outline; ctx.lineWidth = r * 0.34; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 1.95, rearY * 0.95);
    ctx.quadraticCurveTo(-r * 1.18, rearY, -r * 0.48, midY);
    ctx.quadraticCurveTo(r * 0.16, -midY * 0.72, r * 0.70, neckY * 0.4);
    ctx.stroke();

    ctx.strokeStyle = col; ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(-r * 1.95, rearY * 0.95);
    ctx.quadraticCurveTo(-r * 1.18, rearY, -r * 0.48, midY);
    ctx.quadraticCurveTo(r * 0.16, -midY * 0.72, r * 0.70, neckY * 0.4);
    ctx.stroke();

    ctx.fillStyle = dark;
    circ(-r * 1.95, rearY * 0.95, r * 0.055);
  } else if (a.type === "deer") {
    const ty = wag * r * 0.3;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.1);
    ctx.quadraticCurveTo(-r * 1.2, ty - r * 0.15, -r * 1.5, ty);
    ctx.quadraticCurveTo(-r * 1.2, ty + r * 0.15, -r * 0.7, r * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
  } else if (a.type === "boar") {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(-r * 0.95, wag * r * 0.08, r * 0.22, r * 0.14, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
  } else {
    // dragon long taper
    const ty = wag * r * 0.5;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, -r * 0.12);
    ctx.quadraticCurveTo(-r * 1.5, ty - r * 0.2, -r * 2.15, ty);
    ctx.quadraticCurveTo(-r * 1.5, ty + r * 0.2, -r * 0.7, r * 0.12);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.fillStyle = dark; circ(-r * 2.1, ty, r * 0.12);
  }

  // --- BODY ---
  let bL = 1.05, bW = 0.72;
  if (a.type === "bear") { bL = 1.1; bW = 0.88; }
  else if (a.type === "rabbit") { bL = 0.95; bW = 0.7; }
  else if (a.type === "wolf") { bL = 1.15; bW = 0.65; }
  else if (a.type === "cat") { bL = 1.0; bW = 0.65; }
  else if (a.type === "dragon") { bL = 1.15; bW = 0.55; } // lizard — longer flatter body
  else if (a.type === "snake") { bL = 1.6; bW = 0.18; } // very skinny
  else if (a.type === "owl") { bL = 0.95; bW = 0.85; }
  else if (a.type === "deer") { bL = 1.15; bW = 0.58; }
  else if (a.type === "boar") { bL = 1.1; bW = 0.8; }

  // wings only for birds (owl) — bearded dragon is a lizard, not a fantasy dragon
  if (a.type === "owl") {
    const flap = Math.sin((a.tailPhase || 0) * 2.2) * (a.sleeping ? 0.05 : 0.18);
    for (const side of [-1, 1]) {
      ctx.fillStyle = shadeColor(col, -15);
      ctx.beginPath();
      ctx.moveTo(-r * 0.1, side * r * 0.2);
      ctx.quadraticCurveTo(-r * 0.2, side * r * (1.1 + flap), r * 0.5, side * r * (1.35 + flap));
      ctx.quadraticCurveTo(r * 0.7, side * r * 0.7, r * 0.3, side * r * 0.15);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1;
      for (let f = 0; f < 3; f++) {
        ctx.beginPath();
        ctx.moveTo(r * 0.1, side * r * 0.25);
        ctx.lineTo(r * 0.35, side * r * (0.7 + f * 0.2 + flap));
        ctx.stroke();
      }
    }
  }

  if (a.type === "snake") {
    // No torso ellipse/body block for the viper.
  } else {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(0, 0, r * bL, r * bW, 0, 0, TAU); ctx.fill();
  // soft body shading
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath(); ctx.ellipse(r * 0.1, -r * 0.12, r * bL * 0.5, r * bW * 0.35, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath(); ctx.ellipse(-r * 0.12, r * 0.15, r * bL * 0.45, r * bW * 0.32, 0, 0, TAU); ctx.fill();
  }

  // fur tufts along body
  if (a.type !== "snake" && a.type !== "dragon") {
    ctx.fillStyle = shadeColor(col, -20);
    const tuftN = a.type === "bear" || a.type === "wolf" ? 7 : 5;
    for (let i = 0; i < tuftN; i++) {
      const ang = (i / tuftN) * Math.PI * 2 + 0.3;
      const tx = Math.cos(ang) * r * bL * 0.85;
      const ty = Math.sin(ang) * r * bW * 0.85;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(ang) * r * 0.14 - Math.sin(ang) * r * 0.06, ty + Math.sin(ang) * r * 0.14 + Math.cos(ang) * r * 0.06);
      ctx.lineTo(tx + Math.cos(ang) * r * 0.14 + Math.sin(ang) * r * 0.06, ty + Math.sin(ang) * r * 0.14 - Math.cos(ang) * r * 0.06);
      ctx.closePath(); ctx.fill();
    }
  }
  // bearded dragon: side spike frills (the "beard") + small back ridges
  if (a.type === "dragon") {
    ctx.fillStyle = dark;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const bx = -r * 0.4 + i * r * 0.22;
        ctx.beginPath();
        ctx.moveTo(bx, side * r * bW * 0.75);
        ctx.lineTo(bx + r * 0.06, side * r * (bW * 0.75 + 0.28));
        ctx.lineTo(bx + r * 0.14, side * r * bW * 0.75);
        ctx.closePath(); ctx.fill();
      }
    }
    // tiny dorsal ridge
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.25, -r * bW * 0.55);
      ctx.lineTo(i * r * 0.25 + r * 0.04, -r * bW * 0.8);
      ctx.lineTo(i * r * 0.25 + r * 0.1, -r * bW * 0.55);
      ctx.closePath(); ctx.fill();
    }
  }
  // bear belly
  if (a.type === "bear") {
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(r * 0.15, 0, r * 0.45, r * 0.38, 0, 0, TAU); ctx.fill();
  }
  // boar bristly back
  if (a.type === "boar") {
    ctx.fillStyle = dark;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.2, -r * bW * 0.75);
      ctx.lineTo(i * r * 0.2 + r * 0.04, -r * bW * 1.05);
      ctx.lineTo(i * r * 0.2 + r * 0.1, -r * bW * 0.75);
      ctx.closePath(); ctx.fill();
    }
  }

  if (a.type !== "snake") {
    ctx.strokeStyle = outline; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.ellipse(0, 0, r * bL, r * bW, 0, 0, TAU); ctx.stroke();
  }

  if (player.riding === a && a.type !== "snake") {
    ctx.save();
    ctx.translate(-r * 0.08, -r * 0.02);
    ctx.fillStyle = "#5f3920";
    ctx.strokeStyle = "#2d1a10";
    ctx.lineWidth = 2;
    roundRect(-r * 0.38, -r * 0.36, r * 0.64, r * 0.34, r * 0.11); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#8a562f";
    roundRect(-r * 0.18, -r * 0.5, r * 0.34, r * 0.2, r * 0.08); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#7a5030";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, -r * 0.02);
    ctx.lineTo(-r * 0.18, r * 0.42);
    ctx.moveTo(r * 0.12, -r * 0.02);
    ctx.lineTo(r * 0.12, r * 0.42);
    ctx.stroke();
    ctx.strokeStyle = "#c8a55d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.28, r * 0.02);
    ctx.lineTo(r * 0.28, r * 0.02);
    ctx.stroke();
    ctx.fillStyle = "#d8bc75";
    roundRect(r * 0.2, -r * 0.03, r * 0.1, r * 0.1, r * 0.03); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  if (a.spots && a.spots.length) {
    ctx.fillStyle = a.spotCol || dark;
    for (const s of a.spots) {
      ctx.beginPath();
      ctx.ellipse(s.x * r * 0.8, s.y * r * 0.7, s.s * r, s.s * r * 0.75, 0, 0, TAU);
      ctx.fill();
    }
  }

  // little legs / feet so the animals read more clearly
  if (a.type !== "snake") {
    ctx.strokeStyle = outline;
    ctx.lineCap = "round";
    if (a.type === "owl") {
      ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(r * 0.15, side * r * 0.16); ctx.lineTo(r * 0.28, side * r * 0.16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.28, side * r * 0.16); ctx.lineTo(r * 0.45, side * r * 0.2); ctx.stroke();
      }
      ctx.strokeStyle = "#d89b3c"; ctx.lineWidth = 1.4;
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(r * 0.12, side * r * 0.08); ctx.lineTo(r * 0.22, side * r * 0.08); ctx.stroke();
      }
    } else if (a.type === "bear" || a.type === "boar") {
      ctx.fillStyle = shadeColor(col, -18);
      for (const py of [-r * 0.34, r * 0.34]) {
        ctx.beginPath(); ctx.ellipse(-r * 0.1, py, r * 0.18, r * 0.11, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.45, py, r * 0.18, r * 0.11, 0, 0, TAU); ctx.fill();
      }
    } else {
      ctx.fillStyle = shadeColor(col, -12);
      for (const py of [-r * 0.34, r * 0.34]) {
        ctx.beginPath(); ctx.ellipse(-r * 0.12, py, r * 0.14, r * 0.09, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(r * 0.35, py, r * 0.14, r * 0.09, 0, 0, TAU); ctx.fill();
      }
    }
  }

  // species markings and shape details to make each animal read more clearly
  if (a.type === "fox") {
    // cream chest and dark socks
    ctx.fillStyle = "#f5e6d0";
    ctx.beginPath(); ctx.ellipse(r * 0.32, 0, r * 0.28, r * 0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = dark;
    for (const py of [-r * 0.34, r * 0.34]) {
      ctx.beginPath(); ctx.ellipse(r * 0.35, py, r * 0.1, r * 0.08, 0, 0, TAU); ctx.fill();
    }
  } else if (a.type === "wolf") {
    // darker back saddle and chest ruff
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-r * 0.08, -r * 0.02, r * 0.64, r * 0.24, 0, 0, TAU); ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.42, side * r * 0.08);
      ctx.lineTo(r * 0.14, side * r * 0.2);
      ctx.lineTo(r * 0.3, side * r * 0.34);
      ctx.closePath(); ctx.fill();
    }
  } else if (a.type === "dog") {
    // floppy ear bases and chest patch
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(r * 0.25, 0, r * 0.26, r * 0.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = shadeColor(col, -18);
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(r * 0.55, side * r * 0.3, r * 0.16, r * 0.1, side * 0.35, 0, TAU); ctx.fill();
    }
  } else if (a.type === "cat") {
    // back stripes and lighter chest
    ctx.strokeStyle = dark; ctx.lineWidth = 1.7; ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.15 + i * r * 0.2, -r * 0.34);
      ctx.lineTo(-r * 0.02 + i * r * 0.2, -r * 0.08);
      ctx.stroke();
    }
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(r * 0.28, 0, r * 0.22, r * 0.16, 0, 0, TAU); ctx.fill();
  } else if (a.type === "bear") {
    // darker shoulders and lighter muzzle/belly helper patch
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-r * 0.18, 0, r * 0.4, r * 0.32, 0, 0, TAU); ctx.fill();
  } else if (a.type === "rabbit") {
    // chest puff
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.ellipse(r * 0.25, 0, r * 0.2, r * 0.16, 0, 0, TAU); ctx.fill();
  } else if (a.type === "deer") {
    // white belly/chest and thin legs
    ctx.fillStyle = "#efe0c6";
    ctx.beginPath(); ctx.ellipse(r * 0.18, 0, r * 0.34, r * 0.14, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#6f4c31"; ctx.lineWidth = 1.6;
    for (const py of [-r * 0.25, r * 0.25]) {
      ctx.beginPath(); ctx.moveTo(-r * 0.1, py); ctx.lineTo(-r * 0.22, py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.28, py); ctx.lineTo(r * 0.16, py); ctx.stroke();
    }
  } else if (a.type === "boar") {
    // shoulder hump and darker belly
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.42, r * 0.2, 0, 0, TAU); ctx.fill();
  } else if (a.type === "owl") {
    // facial disc and chest feather marks
    ctx.fillStyle = "rgba(245,236,210,0.65)";
    ctx.beginPath(); ctx.ellipse(r * 0.34, 0, r * 0.24, r * 0.34, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(r * 0.06, i * r * 0.14); ctx.lineTo(r * 0.24, i * r * 0.14); ctx.stroke();
    }
  } else if (a.type === "snake") {
    // Belly stripe along the single tail/body line.
    ctx.strokeStyle = light; ctx.lineWidth = r * 0.085; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-r * 1.90, snakeTailSwing * 0.95 + r * 0.03);
    ctx.quadraticCurveTo(-r * 1.18, snakeTailSwing + r * 0.03, -r * 0.48, snakeMidSwing + r * 0.04);
    ctx.quadraticCurveTo(r * 0.16, -snakeMidSwing * 0.72 + r * 0.04, r * 0.68, snakeHeadSwing * 0.28 + r * 0.03);
    ctx.stroke();
  } else if (a.type === "dragon") {
    // banding on lizard back
    ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.18 - r * 0.05, -r * 0.2);
      ctx.lineTo(i * r * 0.18 + r * 0.05, r * 0.2);
      ctx.stroke();
    }
  }

  // --- HEAD (front oval, overlapping body like reference) ---
  // babies = bigger heads (cute), bosses = bulkier
  const stageHead = a.stage === "baby" ? 1.18 : a.stage === "bigmomma" ? 1.16 : a.stage === "superboss" ? 1.12 : a.stage === "boss" ? 1.08 : 1;
  let hL = 0.55 * stageHead, hW = 0.52 * stageHead, hX = r * 0.85;
  if (a.type === "bear") { hL = 0.58 * stageHead; hW = 0.56 * stageHead; hX = r * 0.8; }
  else if (a.type === "rabbit") { hL = 0.48 * stageHead; hW = 0.48 * stageHead; hX = r * 0.82; }
  else if (a.type === "cat") { hL = 0.5 * stageHead; hW = 0.48 * stageHead; hX = r * 0.88; }
  else if (a.type === "fox") { hL = 0.62 * stageHead; hW = 0.55 * stageHead; hX = r * 0.88; }
  else if (a.type === "wolf") { hL = 0.55 * stageHead; hW = 0.45 * stageHead; hX = r * 0.92; }
  else if (a.type === "owl") { hL = 0.6 * stageHead; hW = 0.58 * stageHead; hX = r * 0.82; }
  else if (a.type === "deer") { hL = 0.5 * stageHead; hW = 0.45 * stageHead; hX = r * 0.9; }
  else if (a.type === "boar") { hL = 0.55 * stageHead; hW = 0.5 * stageHead; hX = r * 0.85; }
  else if (a.type === "snake") { hL = 0.28 * stageHead; hW = 0.26 * stageHead; hX = r * 0.95; }
  const biteT = (a.attackAnim || 0) > 0 ? Math.sin((1 - clamp(a.attackAnim / 0.18, 0, 1)) * Math.PI) : 0;
  let biteNudge = biteT * r * 0.14;
  let biteTilt = biteT * 0.18;
  let headLift = 0;
  if (a.type === "snake" && moveRatio > 0.03) {
    biteNudge += Math.max(0, snakeHeadSwing * 0.32);
    biteTilt += Math.sin(slitherT * snakeWaveSpeed + (a.tailPhase || 0) + 1.7) * (0.04 + moveRatio * 0.12);
    headLift += snakeHeadSwing * 0.42;
  }
  ctx.save();
  ctx.translate(biteNudge, headLift);
  ctx.rotate(biteTilt);

  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(hX, 0, r * hL, r * hW, 0, 0, TAU); ctx.fill();
  // head shading
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath(); ctx.ellipse(hX + r * 0.05, -r * 0.1, r * hL * 0.55, r * hW * 0.4, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = outline; ctx.lineWidth = 2.8;
  ctx.beginPath(); ctx.ellipse(hX, 0, r * hL, r * hW, 0, 0, TAU); ctx.stroke();

  // fox cheek fluff
  if (a.type === "fox") {
    ctx.fillStyle = col;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hX - r * 0.05, side * r * 0.38, r * 0.28, r * 0.22, side * 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke();
    }
    // cream inner cheek
    ctx.fillStyle = "#f5e6d0";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hX + r * 0.02, side * r * 0.32, r * 0.16, r * 0.12, side * 0.15, 0, TAU);
      ctx.fill();
    }
  }

  // --- EARS at neck junction (between body & head), like reference ---
  // Reference shows two triangles pointing outward at the head-body join
  const earBaseX = hX - r * 0.35; // behind head / neck area
  if (a.type === "rabbit") {
    // BIG long bunny ears
    const flop = Math.sin((a.tailPhase || 0) * 0.7) * 0.12;
    for (const side of [-1, 1]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(earBaseX + r * 0.05, side * r * 0.5 + flop * r * side, r * 0.2, r * 0.72, side * 0.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2.4; ctx.stroke();
      // pink inner
      ctx.fillStyle = "#f5c0c8";
      ctx.beginPath();
      ctx.ellipse(earBaseX + r * 0.05, side * r * 0.5 + flop * r * side, r * 0.09, r * 0.5, side * 0.4, 0, TAU);
      ctx.fill();
    }
  } else if (a.type === "bear") {
    // round ears + clear inner ear
    for (const side of [-1, 1]) {
      ctx.fillStyle = col;
      circ(earBaseX, side * r * 0.45, r * 0.28);
      ctx.strokeStyle = outline; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(earBaseX, side * r * 0.45, r * 0.28, 0, TAU); ctx.stroke();
      // darker ring then pinkish inner
      ctx.fillStyle = dark;
      circ(earBaseX, side * r * 0.45, r * 0.16);
      ctx.fillStyle = "#e8b090";
      circ(earBaseX, side * r * 0.45, r * 0.1);
    }
  } else if (a.type === "dragon") {
    // bearded dragon — spiky beard under/around head, not ear horns
    ctx.fillStyle = dark;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(earBaseX + r * 0.15 + i * r * 0.08, side * r * (0.2 + i * 0.08));
        ctx.lineTo(earBaseX + r * 0.1 + i * r * 0.08, side * r * (0.45 + i * 0.1));
        ctx.lineTo(earBaseX + r * 0.25 + i * r * 0.08, side * r * (0.28 + i * 0.08));
        ctx.closePath(); ctx.fill();
      }
    }
  } else if (a.type === "deer") {
    // antlers
    ctx.strokeStyle = "#8a6040"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(earBaseX + r * 0.1, side * r * 0.15);
      ctx.lineTo(earBaseX - r * 0.1, side * r * 0.55);
      ctx.lineTo(earBaseX - r * 0.25, side * r * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(earBaseX - r * 0.05, side * r * 0.4);
      ctx.lineTo(earBaseX + r * 0.1, side * r * 0.55);
      ctx.stroke();
    }
  } else if (a.type === "owl") {
    // ear tufts
    for (const side of [-1, 1]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(earBaseX, side * r * 0.2);
      ctx.lineTo(earBaseX - r * 0.05, side * r * 0.55);
      ctx.lineTo(earBaseX + r * 0.2, side * r * 0.25);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8; ctx.stroke();
    }
  } else if (a.type === "snake") {
    // no ears
  } else if (a.type === "boar") {
    for (const side of [-1, 1]) {
      ctx.fillStyle = col;
      circ(earBaseX, side * r * 0.35, r * 0.18);
      ctx.strokeStyle = outline; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(earBaseX, side * r * 0.35, r * 0.18, 0, TAU); ctx.stroke();
    }
  } else {
    // triangular ears at neck (cat, fox, dog, wolf) — matches reference
    const tall = (a.type === "cat" || a.type === "fox") ? 0.55 : 0.42;
    const inner = (a.type === "cat") ? "#f5c0c8" : (a.type === "fox") ? "#f5e6d0" : light;
    for (const side of [-1, 1]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(earBaseX - r * 0.05, side * r * 0.12);
      ctx.lineTo(earBaseX + r * 0.05, side * r * tall);
      ctx.lineTo(earBaseX + r * 0.35, side * r * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 2.2; ctx.stroke();
      // inner ear
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(earBaseX + r * 0.05, side * r * 0.14);
      ctx.lineTo(earBaseX + r * 0.1, side * r * (tall * 0.7));
      ctx.lineTo(earBaseX + r * 0.25, side * r * 0.12);
      ctx.closePath(); ctx.fill();
    }
  }

  // --- FACE details on head ---
  if (a.type === "fox") {
    ctx.fillStyle = "#f5e6d0";
    ctx.beginPath(); ctx.ellipse(hX + r * 0.3, 0, r * 0.32, r * 0.26, 0, 0, TAU); ctx.fill();
  }
  if (a.type === "boar") {
    // tusks
    ctx.fillStyle = "#f5e6d0";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hX + r * 0.25, side * r * 0.12);
      ctx.lineTo(hX + r * 0.55, side * r * 0.28);
      ctx.lineTo(hX + r * 0.35, side * r * 0.08);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }
  if (a.type === "owl") {
    // big round eyes already via generic; add beak
    ctx.fillStyle = "#e8a040";
    ctx.beginPath();
    ctx.moveTo(hX + r * hL * 0.5, 0);
    ctx.lineTo(hX + r * hL * 0.95, -r * 0.08);
    ctx.lineTo(hX + r * hL * 0.95, r * 0.08);
    ctx.closePath(); ctx.fill();
  }
  // nose
  if (a.type === "cat" || a.type === "rabbit") {
    ctx.fillStyle = "#e89aaa";
    ctx.beginPath();
    ctx.moveTo(hX + r * hL * 0.85, 0);
    ctx.lineTo(hX + r * hL * 0.55, -r * 0.07);
    ctx.lineTo(hX + r * hL * 0.55, r * 0.07);
    ctx.closePath(); ctx.fill();
  } else if (a.type === "fox") {
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.moveTo(hX + r * hL * 0.9, 0);
    ctx.lineTo(hX + r * hL * 0.55, -r * 0.06);
    ctx.lineTo(hX + r * hL * 0.55, r * 0.06);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = "#1a1a1a";
    circ(hX + r * hL * 0.7, 0, r * 0.08);
  }
  // eyes
  if (a.sleeping) {
    ctx.strokeStyle = "#222"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hX - r * 0.08, -r * 0.15); ctx.lineTo(hX + r * 0.12, -r * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hX - r * 0.08, r * 0.15); ctx.lineTo(hX + r * 0.12, r * 0.1); ctx.stroke();
  } else if (a.type === "cat") {
    ctx.fillStyle = "#7ec850";
    circ(hX + r * 0.05, -r * 0.14, r * 0.11);
    circ(hX + r * 0.05, r * 0.14, r * 0.11);
    ctx.fillStyle = "#111";
    ctx.fillRect(hX + r * 0.02, -r * 0.22, r * 0.06, r * 0.16);
    ctx.fillRect(hX + r * 0.02, r * 0.06, r * 0.06, r * 0.16);
  } else {
    ctx.fillStyle = "#1a1a1a";
    circ(hX + r * 0.05, -r * 0.14, r * 0.1);
    circ(hX + r * 0.05, r * 0.14, r * 0.1);
    ctx.fillStyle = "#fff";
    circ(hX + r * 0.08, -r * 0.16, r * 0.035);
    circ(hX + r * 0.08, r * 0.12, r * 0.035);
  }
  // extra face details per species
  if (a.type === "cat" || a.type === "fox" || a.type === "rabbit") {
    ctx.strokeStyle = a.type === "fox" ? "#3a2a20" : "#5e5a58";
    ctx.lineWidth = 1.2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hX + r * hL * 0.54, side * r * 0.05);
      ctx.lineTo(hX + r * hL * 0.25, side * r * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hX + r * hL * 0.54, side * r * 0.02);
      ctx.lineTo(hX + r * hL * 0.2, side * r * 0.04);
      ctx.stroke();
    }
  }
  if (a.type === "dog" || a.type === "wolf" || a.type === "bear" || a.type === "boar") {
    const muzzleCol = a.type === "bear" ? light : a.type === "boar" ? shadeColor(col, 18) : shadeColor(col, 20);
    const mx = a.type === "boar" ? hX + r * 0.34 : hX + r * hL * 0.54;
    const mw = a.type === "bear" ? r * 0.14 : a.type === "boar" ? r * 0.16 : r * 0.13;
    const mh = a.type === "bear" ? r * 0.11 : a.type === "boar" ? r * 0.13 : r * 0.10;
    ctx.fillStyle = muzzleCol;
    ctx.beginPath(); ctx.ellipse(mx, 0, mw, mh, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.ellipse(mx, 0, mw, mh, 0, 0, TAU); ctx.stroke();
  }
  if (a.type === "boar") {
    ctx.fillStyle = shadeColor(col, 22);
    ctx.beginPath(); ctx.ellipse(hX + r * 0.39, 0, r * 0.15, r * 0.12, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#47372a";
    circ(hX + r * 0.37, -r * 0.038, r * 0.026);
    circ(hX + r * 0.37, r * 0.038, r * 0.026);
  }
  if (a.type === "deer") {
    ctx.fillStyle = "#efe0c6";
    ctx.beginPath(); ctx.ellipse(hX + r * 0.18, 0, r * 0.18, r * 0.12, 0, 0, TAU); ctx.fill();
  }
  if (a.type === "owl") {
    ctx.fillStyle = "#f7efdd";
    circ(hX + r * 0.02, -r * 0.16, r * 0.13);
    circ(hX + r * 0.02, r * 0.16, r * 0.13);
    ctx.fillStyle = "#181818";
    circ(hX + r * 0.04, -r * 0.16, r * 0.065);
    circ(hX + r * 0.04, r * 0.16, r * 0.065);
  }
  if (a.type === "snake" && !a.sleeping) {
    ctx.strokeStyle = "#d95e6a"; ctx.lineWidth = 1.1; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hX + r * hL * 0.74, 0);
    ctx.lineTo(hX + r * hL * 0.95, 0);
    ctx.moveTo(hX + r * hL * 0.95, 0);
    ctx.lineTo(hX + r * hL * 1.04, -r * 0.04);
    ctx.moveTo(hX + r * hL * 0.95, 0);
    ctx.lineTo(hX + r * hL * 1.04, r * 0.04);
    ctx.stroke();
  }

  // quick bite line while snapping forward
  if (biteT > 0.04 && a.type !== "owl") {
    ctx.strokeStyle = "#1f1712";
    ctx.lineWidth = Math.max(1.3, r * 0.06);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(hX + r * hL * 0.36, r * 0.08);
    ctx.lineTo(hX + r * hL * 0.72, r * 0.16 + biteT * r * 0.05);
    ctx.stroke();
  }
  ctx.restore();
  }

  // No decorative stage/owned rings around animals. Rare stages stay readable through labels/health UI.

  ctx.filter = "none";
  ctx.restore();

  // health bar above animal (wildlife only; pets get a dedicated top overlay)
  if (!a.owned && !a.dead && a.stage !== "bigmomma" && a.hp < a.maxHp) {
    const bw = Math.max(30, a.r * 1.45);
    const ratio = clamp(a.hp / a.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(a.x - bw / 2, a.y - a.r - 14, bw, 5);
    ctx.fillStyle = ratio > 0.4 ? "#7be08a" : "#f2836a";
    ctx.fillRect(a.x - bw / 2, a.y - a.r - 14, bw * ratio, 5);
  }
  // elemental walk trail
  if (!a.sleeping && !a.dead && particles.length < 700 && (a._moved || Math.random() < 0.14)) {
    const col = ELEM_GLOW[(PET_TYPES[a.type] || {}).elem] || a.coat || "#efe6d2";
    particles.push({
      x: a.x + rand(-4, 4), y: a.y + rand(-4, 4),
      vx: rand(-8, 8), vy: rand(-8, 8),
      life: 2.4, maxLife: 2.4, size: rand(2.4, 4.8), color: col, trail: true,
    });
  }

  // labels (screen space)
  if (a.owned) {
    ctx.fillStyle = "#7be08a";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${petDisplayName(a)} ${stageDisplayName(a.stage)}`, a.x, a.y - r - 22);
  } else {
    // Every wild animal always shows its species/type. Special tiers keep the
    // tier name in the same label so rare encounters are obvious at a glance.
    const speciesName = (PET_TYPES[a.type] && PET_TYPES[a.type].name) || a.type;
    const tierName = stageDisplayName(a.stage);
    const wildName = `${tierName ? tierName + " " : ""}${speciesName}`;
    ctx.textAlign = "center";
    ctx.fillStyle = a.stage === "bigmomma" ? "#ff9a4d" :
                    a.stage === "superboss" ? "#ffe66d" :
                    a.stage === "boss" ? "#f2c94c" :
                    (!PET_TYPES[a.type].friendly ? "#f2a18f" : "#efe6d2");
    ctx.font = a.stage === "bigmomma" ? "bold 14px sans-serif" :
               a.stage === "superboss" ? "bold 12px sans-serif" :
               a.stage === "boss" ? "bold 11px sans-serif" : "10px sans-serif";
    ctx.fillText(wildName, a.x, a.y - r - 24);

    if (a.sleeping && a.stage === "baby") {
      ctx.fillStyle = "#efe6d2";
      ctx.font = "10px sans-serif";
      ctx.fillText("zzz  (Tame)", a.x, a.y - r - 10);
    } else if (a.sleeping) {
      ctx.fillStyle = "rgba(239,230,210,0.78)";
      ctx.font = "10px sans-serif";
      ctx.fillText("zzz", a.x, a.y - r - 10);
    }
  }
}

function weaponIcon(type) {
  if (type === "Axe") return '<path d="M0,-2 L24,-2 L24,2 L0,2 Z" fill="#9a5d31" stroke="#4f2f16" stroke-width="1"/><circle cx="2.5" cy="0" r="2.4" fill="#c8844b"/><path d="M9,-10 L19,-10 L24,-5.5 L24,5.5 L19,10 L9,10 Z" fill="#b7a46f" stroke="#4c4230" stroke-width="1.35"/><path d="M12,-7.2 L19,-7.2 L22,-4.2 L22,4.2 L19,7.2 L12,7.2 Z" fill="#d5c18b" opacity="0.45"/><path d="M13,-5 Q11.6 0 13 5" fill="none" stroke="#eadcb5" stroke-width="1" stroke-linecap="round" opacity="0.75"/>';
  if (type === "Pickaxe") return '<rect x="1" y="-2.7" width="39" height="5.4" rx="2.7" fill="#74461f" stroke="#3f2815" stroke-width="1"/><rect x="8" y="-3.2" width="13" height="6.4" rx="2" fill="#a46a35"/><path d="M34,-5 L42,-5 L46,-16 Q58,-14 67,-9 Q54,-8 45,-1 L45,1 Q54,8 67,9 Q58,14 46,16 L42,5 L34,5Z" fill="#9da8b2" stroke="#454d55" stroke-width="1.4"/><rect x="38" y="-6" width="8" height="12" rx="2" fill="#606b74"/><path d="M47,-12 Q56,-11 63,-9" fill="none" stroke="#e4edf3" stroke-width="1.2"/>';
  if (type === "Sword") return '<circle cx="3" cy="0" r="3" fill="#d8b23f" stroke="#7a5a16" stroke-width="1"/><rect x="4" y="-2.8" width="10" height="5.6" rx="1.6" fill="#5e3a22" stroke="#3a2416" stroke-width="1"/><path d="M13,-6 L19,-6 L23,-2.5 L23,2.5 L19,6 L13,6 Z" fill="#d8b23f" stroke="#8a6a20" stroke-width="1"/><path d="M23,-4.5 L42,0 L23,4.5 Z" fill="#d9dee3" stroke="#737981" stroke-width="1.1"/><path d="M24,-1.1 L35,-1.1 L35,1.1 L24,1.1 Z" fill="#f8fbff" opacity="0.8"/>';
  return "";
}

const weaponIconCache = {};
function drawHeldBerry(color, eatT) {
  // One hand holds the berry just ahead of the eyes; clicking pulls it toward the face.
  const bx = 25 - eatT * 10;
  const by = 4 - eatT * 4;
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(20, 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, -10); ctx.lineTo(17, -9); ctx.stroke();
  ctx.fillStyle = color;
  circ(20, 5, 5); circ(17, -9, 5);

  ctx.save();
  ctx.translate(bx, by);
  ctx.fillStyle = "#d83d68"; circ(-3.2, 1.5, 4.6);
  ctx.fillStyle = "#e65a80"; circ(3.2, 1.4, 4.6);
  ctx.fillStyle = "#c92e5c"; circ(0, -2.3, 4.2);
  ctx.fillStyle = "#6ab04c";
  ctx.beginPath();
  ctx.moveTo(0, -5); ctx.quadraticCurveTo(4, -10, 8, -7); ctx.quadraticCurveTo(4, -3, 0, -3); ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  ctx.save();
  ctx.translate(p.x, p.y);

  if (p.dead) {
    const t = p.splitT, ease = 1 - Math.pow(1 - t, 3);
    const deadFill = p.color;
    const deadOutline = shadeColor(p.color, -50);
    ctx.globalAlpha = 1 - t * 0.9;

    // Draw the same rounded player cube, but clip it into two diagonal halves.
    // This keeps the outer corners smooth and makes the split look like the
    // actual cube was cut at an angle.
    function drawSplitHalf(points, tx, ty, rot, cutA, cutB) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(rot);

      // Clip the rounded player cube into one 90-degree half.
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      ctx.closePath();
      ctx.clip();

      ctx.fillStyle = deadFill;
      ctx.strokeStyle = deadOutline;
      ctx.lineWidth = 3.5;
      ctx.lineJoin = "round";
      roundRect(-16, -16, 32, 32, 7);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Stroke the diagonal cut edge with the same width as the player outline.
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(rot);
      ctx.strokeStyle = deadOutline;
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cutA[0], cutA[1]);
      ctx.lineTo(cutB[0], cutB[1]);
      ctx.stroke();
      ctx.restore();
    }

    drawSplitHalf([[-16,-16],[16,-16],[-16,16]], -ease * 24, -ease * 4, ease * -0.7, [16,-16], [-16,16]);
    drawSplitHalf([[16,-16],[16,16],[-16,16]], ease * 24, ease * 4, ease * 0.7, [16,-16], [-16,16]);

    ctx.restore();
    return;
  }

  // if riding, draw slightly higher
  if (p.riding) ctx.translate(0, -12);

  // walk bob
  const moving = keys.has("w") || keys.has("a") || keys.has("s") || keys.has("d") ||
    keys.has("arrowup") || keys.has("arrowdown") || keys.has("arrowleft") || keys.has("arrowright") ||
    (mobileMode && typeof joyActive !== "undefined" && joyActive);
  const walkCycle = moving ? Math.sin(game.time * 12) : 0;
  const walkPhase = walkCycle * 2.2;
  const armWalk = walkCycle * 3.2;
  ctx.translate(0, walkPhase);

  ctx.rotate(p.angle);
  const bodyFill = p.hurtFlash > 0 ? "#ff5c4d" : p.color;
  const armFill = p.hurtFlash > 0 ? "#c23c30" : shadeColor(p.color, -30);

  const swingMax = (TOOLS[p.swingWeapon] && TOOLS[p.swingWeapon].swing) || 0.22;
  const swingEase = p.punchTimer > 0 ? Math.sin((1 - p.punchTimer / swingMax) * Math.PI) : 0;
  const holding = p.heldSpecial || p.tool || "Fist";
  if (holding === "Berry") {
    ctx.save();
    ctx.translate(0, armWalk * 0.35);
    drawHeldBerry(armFill, swingEase);
    ctx.restore();
  } else if (holding === "Fist") {
    drawArm(1, p.punchSide === 1 ? swingEase : 0, armFill, null, false, -armWalk);
    drawArm(-1, p.punchSide === -1 ? swingEase : 0, armFill, null, false, armWalk);
  } else {
    drawTwoHandWeapon(holding, armFill, swingEase, armWalk);
  }

  ctx.fillStyle = bodyFill; ctx.strokeStyle = shadeColor(p.color, -50); ctx.lineWidth = 3.5;
  roundRect(-16, -16, 32, 32, 7); ctx.fill(); ctx.stroke();

  ctx.fillStyle = "#12202b";
  circ(9, -6, 3.6); circ(9, 6, 3.6);
  ctx.fillStyle = "#fff";
  circ(10, -7, 1.1); circ(10, 5, 1.1);

  ctx.restore();
  ctx.fillStyle = "rgba(239,230,210,0.85)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(p.username, p.x, p.y - (p.riding ? 42 : 28));
}

function shadeColor(hex, percent) {
  const num = parseInt(hex.replace("#",""), 16);
  const r = clamp((num >> 16) + percent, 0, 255);
  const g = clamp(((num >> 8) & 0x00FF) + percent, 0, 255);
  const b = clamp((num & 0x0000FF) + percent, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawTwoHandWeapon(weapon, color, swing, walkArm = 0) {
  // Weapon grip tuned to keep the hands just ahead of the eyes without
  // fully extending the arms.
  let restAngle = 0.18;
  let swingAngle = 0;
  if (weapon === "Bow") {
    restAngle = 0.08;
    swingAngle = swing * -0.55;
  } else if (weapon === "Pickaxe") {
    // Pickaxe uses the same upright two-hand ready pose as the axe.
    restAngle = Math.PI / 2;
    swingAngle = swing * -1.34;
  } else if (weapon === "Axe") {
    // Axe sits at a true 90-degree ready angle and swings forward across the front
    // of the character, almost toward the other side.
    restAngle = Math.PI / 2;
    swingAngle = swing * -1.42;
  } else if (weapon === "Sword") {
    // Sword starts much farther back, then slashes fast across the player
    // to the other side before returning.
    restAngle = 2.12;
    swingAngle = swing * -2.18;
  }
  const rot = restAngle + swingAngle;

  // Move the held item slightly ahead of the face in space, but not far enough
  // to make the arms look almost straight.
  const tx = (weapon === "Axe" || weapon === "Pickaxe") ? 8.5 : weapon === "Sword" ? 6.5 : 0;
  const ty = (weapon === "Axe" || weapon === "Pickaxe") ? -1.2 : weapon === "Sword" ? -0.6 : 0;

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(rot);

  if (weapon === "Axe") {
    // handle
    ctx.strokeStyle = "#4f2f16"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(53, 0); ctx.stroke();
    ctx.strokeStyle = "#9a5d31"; ctx.lineWidth = 4.8;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(53, 0); ctx.stroke();
    // grip wrap
    ctx.strokeStyle = "#c8844b"; ctx.lineWidth = 2.1;
    for (const x of [19, 23, 27]) {
      ctx.beginPath(); ctx.moveTo(x, -2.8); ctx.lineTo(x, 2.8); ctx.stroke();
    }
    // handle cap
    ctx.fillStyle = "#c8844b";
    ctx.beginPath(); ctx.ellipse(9, 0, 3.4, 4.0, 0, 0, TAU); ctx.fill();
    // rectangular axe head flipped to the left side of the handle
    ctx.fillStyle = "#b7a46f"; ctx.strokeStyle = "#4c4230"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(35, -11.5);
    ctx.lineTo(47, -11.5);
    ctx.lineTo(53, -6);
    ctx.lineTo(53, 6);
    ctx.lineTo(47, 11.5);
    ctx.lineTo(35, 11.5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // lighter inner face
    ctx.fillStyle = "rgba(234,220,181,0.42)";
    ctx.beginPath();
    ctx.moveTo(38, -8.5);
    ctx.lineTo(45.5, -8.5);
    ctx.lineTo(49.5, -4.6);
    ctx.lineTo(49.5, 4.6);
    ctx.lineTo(45.5, 8.5);
    ctx.lineTo(38, 8.5);
    ctx.closePath();
    ctx.fill();
    // left-facing cutting edge highlight
    ctx.strokeStyle = "#eadcb5"; ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(37.5, -4.6);
    ctx.quadraticCurveTo(36, 0, 37.5, 4.6);
    ctx.stroke();
  } else if (weapon === "Pickaxe") {
    // Wooden shaft, same scale/grip language as the axe.
    ctx.strokeStyle = "#3f2815"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(54, 0); ctx.stroke();
    ctx.strokeStyle = "#9a5d31"; ctx.lineWidth = 4.8;
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(54, 0); ctx.stroke();
    ctx.strokeStyle = "#c8844b"; ctx.lineWidth = 2.0;
    for (const x of [19,23,27]) { ctx.beginPath(); ctx.moveTo(x,-2.8); ctx.lineTo(x,2.8); ctx.stroke(); }
    ctx.fillStyle = "#c8844b";
    ctx.beginPath(); ctx.ellipse(9, 0, 3.4, 4.0, 0, 0, TAU); ctx.fill();

    // Classic cross-head pickaxe: pointed pick on one side, broad adze on the other.
    ctx.fillStyle = "#606b74"; ctx.strokeStyle = "#30373d"; ctx.lineWidth = 1.4;
    roundRect(48, -7, 11, 14, 2.2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = "#aab4bd"; ctx.strokeStyle = "#454d55"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(50, -4);
    ctx.quadraticCurveTo(48, -13, 42, -20);
    ctx.lineTo(39, -25);
    ctx.lineTo(44, -23);
    ctx.quadraticCurveTo(54, -17, 57, -6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(51, 4);
    ctx.quadraticCurveTo(58, 12, 67, 16);
    ctx.lineTo(73, 18);
    ctx.lineTo(71, 22);
    ctx.quadraticCurveTo(59, 19, 53, 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.strokeStyle = "rgba(240,247,251,.9)"; ctx.lineWidth = 1.05;
    ctx.beginPath(); ctx.moveTo(45,-20); ctx.quadraticCurveTo(51,-15,54,-8); ctx.stroke();
  } else if (weapon === "Sword") {
    ctx.fillStyle = "#d8b23f"; ctx.strokeStyle = "#7a5a16"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(14, 0, 4, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#5e3a22"; ctx.strokeStyle = "#3a2416"; ctx.lineWidth = 1.1;
    roundRect(16, -3.8, 12.5, 7.6, 2.4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d8b23f"; ctx.strokeStyle = "#8a6a20"; ctx.lineWidth = 1.2;
    roundRect(27.5, -6.2, 9.5, 12.4, 3); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(28, -5.4); ctx.lineTo(35.2, -9.1); ctx.lineTo(39.8, -5.2); ctx.lineTo(34.7, -1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(28, 5.4); ctx.lineTo(35.2, 9.1); ctx.lineTo(39.8, 5.2); ctx.lineTo(34.7, 1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#d9dee3"; ctx.strokeStyle = "#71767c"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(37, -4.2);
    ctx.lineTo(64, -1.9);
    ctx.lineTo(69, 0);
    ctx.lineTo(64, 1.9);
    ctx.lineTo(37, 4.2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#f8fbff"; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.moveTo(40, -0.4); ctx.lineTo(62, -0.4); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(39, -2.5); ctx.lineTo(63, -0.9); ctx.stroke();
  } else if (weapon === "Bow") {
    ctx.strokeStyle = "#7a5327"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(24, 0, 22, -1.15, 1.15); ctx.stroke();
    ctx.strokeStyle = "#d9d9d9"; ctx.lineWidth = 1.5;
    const pull = 6 + swing * 7;
    ctx.beginPath(); ctx.moveTo(24, -20); ctx.lineTo(24 - pull, 0); ctx.lineTo(24, 20); ctx.stroke();
  }
  ctx.restore();

  // Two-hand grip. Left hand slightly higher than the right. Use the same
  // translate+rotate math as the weapon so the arms don't overextend.
  let hand1 = { x: 22, y: -5 };
  let hand2 = { x: 34, y: 5 };
  if (weapon === "Axe" || weapon === "Pickaxe") {
    hand1 = { x: 13.5, y: -4.3 };
    hand2 = { x: 18.7, y: 3.1 };
  } else if (weapon === "Sword") {
    hand1 = { x: 16.5, y: -4.8 };
    hand2 = { x: 22.8, y: 3.5 };
  }
  const c = Math.cos(rot), si = Math.sin(rot);
  const hx1 = tx + hand1.x * c - hand1.y * si, hy1 = ty + hand1.x * si + hand1.y * c;
  const hx2 = tx + hand2.x * c - hand2.y * si, hy2 = ty + hand2.x * si + hand2.y * c;
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = "round";
  // While walking, each shoulder moves in the opposite vertical direction.
  // Hands remain attached to the held item so tools do not visually disconnect.
  ctx.beginPath(); ctx.moveTo(9, -10 + walkArm); ctx.lineTo(hx1, hy1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, 10 - walkArm); ctx.lineTo(hx2, hy2); ctx.stroke();
  ctx.fillStyle = color;
  circ(hx1, hy1, 5); circ(hx2, hy2, 5);
}

function drawArm(side, extend, color, weapon, isMain, walkY = 0) {
  const baseX = 9, baseY = 10 * side + walkY;
  let restX = 18, restY = 14 * side + walkY;
  let outX = 36, outY = 4 * side + walkY;
  // weapon-specific swing arcs
  if (weapon === "Sword" || weapon === "Axe") {
    outX = 40; outY = -8 * side + (side > 0 ? -6 : 6);
  } else if (weapon === "Bow") {
    restX = 22; restY = 8 * side;
    outX = 28; outY = 2 * side;
  } else if (weapon === "Pickaxe") {
    outX = 38; outY = 0;
  }
  const tipX = lerp(restX, outX, extend);
  const tipY = lerp(restY, outY, extend);
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.fillStyle = color; circ(tipX, tipY, 5.0);
  // always show held tool on main hand
  if (weapon && weapon !== "Fist" && isMain) {
    ctx.save();
    ctx.translate(tipX, tipY);
    const swingRot = extend * (weapon === "Sword" || weapon === "Axe" ? -1.1 : weapon === "Bow" ? 0.15 : -0.5);
    ctx.rotate(side * swingRot + (weapon === "Bow" ? 0 : -0.3));
    if (weapon === "Bow") {
      // drawn bow shape
      ctx.strokeStyle = "#7a5327"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(8, 0, 12, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = "#d9d9d9"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(8, -11); ctx.lineTo(8 + extend * 6, 0); ctx.lineTo(8, 11); ctx.stroke();
    } else if (weapon === "Sword") {
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(-2, -3, 8, 6);
      ctx.fillStyle = "#d8b23f"; ctx.fillRect(5, -4, 4, 8);
      ctx.fillStyle = "#d9dee3";
      ctx.beginPath(); ctx.moveTo(9, -3); ctx.lineTo(28, -1.5); ctx.lineTo(28, 1.5); ctx.lineTo(9, 3); ctx.fill();
    } else if (weapon === "Axe") {
      ctx.fillStyle = "#8a5a2b"; ctx.fillRect(-2, -2, 16, 4);
      ctx.fillStyle = "#b9bec4";
      ctx.beginPath(); ctx.moveTo(12, -8); ctx.lineTo(24, -4); ctx.lineTo(24, 4); ctx.lineTo(12, 8); ctx.closePath(); ctx.fill();
    } else if (weapon === "Pickaxe") {
      ctx.fillStyle = "#74461f"; roundRect(-2,-2.5,18,5,2); ctx.fill();
      ctx.fillStyle = "#555f67"; roundRect(12,-5,6,10,1.5); ctx.fill();
      ctx.fillStyle = "#aab4bd";
      ctx.beginPath(); ctx.moveTo(15,-3); ctx.quadraticCurveTo(23,-12,31,-10); ctx.lineTo(18,1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(15,3); ctx.quadraticCurveTo(23,11,29,9); ctx.lineTo(18,-1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

function drawOrbitRing(fx, colors, particleShape) {
  const R = fx.r || 30;
  const phase = fx.phase || 0;
  const fade = clamp(fx.life / 5, 0, 1);
  ctx.globalAlpha = 0.35 * fade;
  ctx.strokeStyle = colors[0];
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(fx.x, fx.y, R, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.55 * fade;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const ang = phase + (i / n) * TAU;
    const px = fx.x + Math.cos(ang) * R;
    const py = fx.y + Math.sin(ang) * R;
    ctx.fillStyle = colors[i % colors.length];
    if (particleShape === "flame") {
      ctx.beginPath();
      ctx.moveTo(px, py - 5); ctx.lineTo(px + 4, py + 3); ctx.lineTo(px - 4, py + 3);
      ctx.closePath(); ctx.fill();
    } else if (particleShape === "shard") {
      ctx.beginPath();
      ctx.moveTo(px + 5, py); ctx.lineTo(px - 3, py - 3); ctx.lineTo(px - 3, py + 3);
      ctx.closePath(); ctx.fill();
    } else if (particleShape === "leaf") {
      ctx.beginPath(); ctx.ellipse(px, py, 5, 3, ang, 0, TAU); ctx.fill();
    } else {
      circ(px, py, 3.5 + Math.sin(phase * 2 + i) * 1.2);
    }
  }
}

function drawAbilityFx() {
  for (const fx of abilityFx) {
    ctx.save();
    if (fx.type === "cast") {
      const t = clamp(1 - fx.life / (fx.maxLife || 0.5), 0, 1);
      const rr = (fx.r || 24) + t * 28;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = fx.color || "#fff";
      ctx.lineWidth = 4 - t * 2;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, rr, 0, TAU); ctx.stroke();
      ctx.globalAlpha = (1 - t) * 0.45;
      ctx.fillStyle = fx.color || "#fff";
      circ(fx.x, fx.y, Math.max(3, rr * 0.22));
    } else if (fx.followPet) {
      if (fx.type === "fire") drawOrbitRing(fx, ["#ff6a2a", "#ffcc40", "#ff4020"], "flame");
      else if (fx.type === "sound") drawOrbitRing(fx, ["#a0e0ff", "#70c0ff", "#dff6ff"], "dot");
      else if (fx.type === "ice") drawOrbitRing(fx, ["#a8d8ff", "#e0f0ff", "#70b0e0"], "shard");
      else if (fx.type === "wind") drawOrbitRing(fx, ["#c0e8ff", "#e8f6ff", "#90d0f0"], "dot");
      else if (fx.type === "poison") drawOrbitRing(fx, ["#5cb85c", "#7ec850", "#3a8a40"], "dot");
      else if (fx.type === "light") drawOrbitRing(fx, ["#ffe66d", "#fff0a0", "#ffcc40"], "dot");
      else if (fx.type === "earth") drawOrbitRing(fx, ["#8a6040", "#c4a882", "#6b4423"], "dot");
      else drawOrbitRing(fx, ["#efe6d2", "#c0d8e8"], "dot");
    } else if (fx.type === "stone") {
      ctx.globalAlpha = clamp(fx.life * 2, 0, 0.7);
      ctx.fillStyle = "#a9b3bd"; circ(fx.x, fx.y, 12);
    } else if (fx.type === "lightning") {
      ctx.globalAlpha = clamp(fx.life * 2, 0, 0.8);
      ctx.strokeStyle = "#ffe66d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 28, 0, TAU); ctx.stroke();
    } else if (fx.type === "bolt") {
      ctx.globalAlpha = clamp(fx.life * 3, 0, 0.9);
      ctx.strokeStyle = "#ffe66d"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fx.fromX || fx.x, fx.fromY || fx.y);
      ctx.lineTo(fx.x, fx.y); ctx.stroke();
    } else if (fx.type === "water") {
      ctx.globalAlpha = clamp(fx.life * 2, 0, 0.7);
      ctx.strokeStyle = "#4aa3e0"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r || 14, 0, TAU); ctx.stroke();
    } else if (fx.type === "plant" || fx.type === "leaf") {
      ctx.globalAlpha = clamp(fx.life * 2, 0, 0.7);
      ctx.fillStyle = "#7be08a"; circ(fx.x, fx.y, 6);
    }
    ctx.restore();
  }
}

function drawTopHealthBar(x, y, w, h, ratio, fill, label = "") {
  const left = x - w / 2;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  roundRect(left - 2, y - 2, w + 4, h + 4, 4);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = 1.5;
  roundRect(left - 2, y - 2, w + 4, h + 4, 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(38,20,8,0.45)";
  roundRect(left, y, w, h, 3);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(left, y, Math.max(0, w * clamp(ratio, 0, 1)), h, 3);
  ctx.fill();
  if (label) {
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.strokeStyle = "rgba(0,0,0,0.72)";
    ctx.lineWidth = 3.5;
    ctx.strokeText(label, x, y - 3);
    ctx.fillStyle = "#fff7d6";
    ctx.fillText(label, x, y - 3);
  }
  ctx.restore();
}

function drawPetXpBar(p, y) {
  if (!p || p.dead || p.stage === "bigmomma") return;

  const shownAt = Number(p._xpBarShownAt) || 0;
  const age = performance.now() - shownAt;
  const holdMs = 1150;
  const fadeMs = 1450;
  if (!shownAt || age >= holdMs + fadeMs) return;
  const alpha = age <= holdMs ? 1 : clamp(1 - (age - holdMs) / fadeMs, 0, 1);

  const level = Math.max(1, Number(p.level) || 1);
  const need = Math.max(1, expToNext(p.stage, level));
  const exp = Math.max(0, Number(p.exp) || 0);
  const ratio = clamp(exp / need, 0, 1);

  // Large enough to read, but still compact over the pet.
  const w = Math.max(72, Math.min(156, (p.r || 20) * 2.15));
  const h = 10;
  const x = p.x - w / 2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Dark outline/backplate keeps XP readable over bright trees, pets and effects.
  ctx.fillStyle = "rgba(10,14,22,0.88)";
  roundRect(x - 2, y - 2, w + 4, h + 4, 5);
  ctx.fill();

  ctx.fillStyle = "rgba(30,39,55,0.96)";
  roundRect(x, y, w, h, 4);
  ctx.fill();

  // Bright XP fill.
  if (ratio > 0) {
    ctx.fillStyle = "#68c9ff";
    roundRect(x + 1, y + 1, Math.max(2, (w - 2) * ratio), h - 2, 3);
    ctx.fill();

    // Small highlight so the fill stays visible in dark/night scenes too.
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    roundRect(x + 2, y + 2, Math.max(1, (w - 4) * ratio), 2, 1);
    ctx.fill();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.font = "bold 10px -apple-system, sans-serif";

  const label = `Lv ${level}   XP ${Math.floor(exp)}/${need}`;

  // Text shadow/outline for maximum readability.
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.strokeText(label, p.x, y - 4);
  ctx.fillStyle = "#eaf7ff";
  ctx.fillText(label, p.x, y - 4);

  ctx.restore();
}

function drawChest(chest) {
  if (chest.opened) return;
  const s = 1 + (chest.pulse > 0 ? chest.pulse * 0.12 : 0);
  chest.shine = (chest.shine || 0) + 0.02;
  const dmg = chest.maxHp ? 1 - chest.hp / chest.maxHp : 0;
  ctx.save();
  ctx.translate(chest.x, chest.y);
  ctx.scale(s, s);
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath(); ctx.ellipse(0, 17, 22, 7, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.26 + Math.sin(chest.shine) * 0.05;
  ctx.fillStyle = "#ffd85f";
  ctx.beginPath(); ctx.ellipse(0, -7, 22, 12, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#8c5a2b";
  ctx.strokeStyle = "#4f2d12";
  ctx.lineWidth = 3;
  roundRect(-20, -6, 40, 24, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#a46a32";
  roundRect(-20, -16, 40, 16, 7); ctx.fill(); ctx.stroke();
  if (dmg > 0.01) {
    ctx.strokeStyle = `rgba(50,28,14,${0.35 + dmg * 0.55})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -11); ctx.lineTo(-2, -6); ctx.lineTo(-7, 0);
    ctx.moveTo(6, -13); ctx.lineTo(2, -8); ctx.lineTo(8, -3);
    if (dmg > 0.45) { ctx.moveTo(-1, -4); ctx.lineTo(3, 2); ctx.lineTo(-1, 8); }
    ctx.stroke();
  }
  ctx.fillStyle = "#d4aa3a";
  roundRect(-23, -8, 6, 28, 3); ctx.fill(); ctx.stroke();
  roundRect(17, -8, 6, 28, 3); ctx.fill(); ctx.stroke();
  roundRect(-5, -20, 10, 38, 3); ctx.fill(); ctx.stroke();
  roundRect(-6, -2, 12, 9, 3); ctx.fillStyle = "#f4d86b"; ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.26)";
  ctx.beginPath(); ctx.ellipse(-7, -9, 10, 3.5, -0.35, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawTopHealthOverlays(viewResources = resources, viewGold = goldChunks, viewChests = chests) {
  // All resource HP bars on top of all game visuals.
  for (const r of viewResources) {
    if (!r.alive || !inView(r.x, r.y, 120) || r.hp >= r.maxHp) continue;
    const sc = r.scale || 1;
    let y = r.y - 40 * sc;
    let w = Math.max(40, 34 * sc);
    let fill = "#f4c65f";
    let label = "";
    if (r.type === "tree") {
      y = r.y - 48 * sc;
      w = Math.max(44, 40 * sc);
      fill = "#9fe271";
      label = "TREE";
    } else if (r.type === "rock") {
      y = r.y - 40 * sc;
      w = Math.max(42, 36 * sc);
      fill = "#b8c0c8";
      label = "ROCK";
    } else if (r.type === "log") {
      y = r.y - 29 * sc;
      w = Math.max(42, 38 * sc);
      fill = "#c79255";
      label = "LOG";
    } else if (r.type === "bush") {
      y = r.y - 28 * sc;
      w = Math.max(40, 34 * sc);
      fill = "#7be08a";
      label = "BUSH";
    } else {
      continue;
    }
    drawTopHealthBar(r.x, y, w, 8, r.hp / r.maxHp, fill, label);
  }
  for (const g of viewGold) {
    // The giant center monument is infinite and intentionally has no HP bar.
    if (g.pure || g.infinite) continue;
    if (g.goldLeft <= 0 || !inView(g.x, g.y, 140)) continue;
    const maxHp = g.size === "huge" ? 40 : 6;
    if (g.goldLeft >= maxHp) continue;
    const y = g.y - g.r * 1.08;
    const w = g.size === "huge" ? Math.max(64, g.r * 1.35) : Math.max(46, g.r * 1.7);
    drawTopHealthBar(g.x, y, w, 8, g.goldLeft / maxHp, "#ffd54a", g.size === "huge" ? "BIG GOLD" : "GOLD");
  }
  for (const c of viewChests) {
    if (c.opened || !inView(c.x, c.y, 100) || c.hp >= c.maxHp) continue;
    drawTopHealthBar(c.x, c.y - 34, 42, 8, c.hp / c.maxHp, "#d8a45a", "CHEST");
  }
  // Big Mommas always show a health bar so their huge health pool is readable.
  for (const a of animals) {
    if (a.dead || a.stage !== "bigmomma" || !inView(a.x, a.y, Math.max(180, a.r * 2.2))) continue;
    const ratio = clamp(a.hp / Math.max(1, a.maxHp), 0, 1);
    const fill = ratio > 0.6 ? "#e6b85c" : ratio > 0.3 ? "#e58f4f" : "#e0563f";
    const w = Math.max(96, Math.min(170, a.r * 1.5));
    const y = a.y - a.r - 34;
    drawTopHealthBar(a.x, y, w, 10, ratio, fill, "BIG MOMMA");
  }

  // Every pet gets a health bar, including pets owned by other online players.
  // Use a larger view pad for Boss/Super Boss pets so the bar does not disappear
  // while part of a large pet is still visible at the edge of the screen.
  const petBars = [...player.pets];
  if (net.room) for (const p of net.remotePetVisuals.values()) petBars.push(p);
  const seenPetBars = new Set();
  for (const p of petBars) {
    if (!p || p.dead) continue;
    const key = p.netId || p;
    if (seenPetBars.has(key)) continue;
    seenPetBars.add(key);
    if (!inView(p.x, p.y, Math.max(100, p.r * 2.2))) continue;
    const ratio = clamp((p.hp || 0) / Math.max(1, p.maxHp || 1), 0, 1);
    const fill = ratio > 0.6 ? "#7be08a" : ratio > 0.3 ? "#f4c65f" : "#f2836a";
    const w = Math.max(46, Math.min(150, p.r * 1.9));
    const y = p.y - p.r - 26;
    drawTopHealthBar(p.x, y, w, 8, ratio, fill, petDisplayName(p));
  }

  // Your pets' leveling XP is drawn in this same LAST foreground overlay,
  // so trees, resources, wildlife and effects cannot cover it.
  const seenXpBars = new Set();
  for (const p of player.pets) {
    if (!p || p.dead || p.stage === "bigmomma") continue;
    const key = p.netId || p;
    if (seenXpBars.has(key)) continue;
    seenXpBars.add(key);
    if (!inView(p.x, p.y, Math.max(110, p.r * 2.3))) continue;

    // Stack XP just above the health bar with enough spacing to avoid overlap.
    const xpY = p.y - p.r - 64;
    drawPetXpBar(p, xpY);
  }
  // Player HP only appears while damaged. After healing back to full it
  // softly ghosts away instead of permanently occupying the screen.
  if (!player.dead && inView(player.x, player.y, 90)) {
    const ratio = clamp(player.health / Math.max(1, player.maxHealth), 0, 1);
    let alpha = 0;
    if (ratio < 0.999) {
      alpha = 1;
      player._healthBarShownAt = performance.now();
    } else {
      const healedAt = Number(player._healthBarHealedAt) || 0;
      const age = healedAt ? performance.now() - healedAt : 99999;
      if (age < 1000) alpha = 1 - age / 1000;
    }
    if (alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = alpha;
      drawTopHealthBar(player.x, player.y - (player.riding ? 58 : 46), 54, 8, ratio, "#f2836a", "HP");
      ctx.restore();
    }
  }
}

function drawFx() {
  for (const p of particles) {
    if (p.trail) continue;
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    circ(p.x, p.y, p.size);
  }
  ctx.globalAlpha = 1;
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = "bold 13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function inView(x, y, pad) {
  return x > game.camX - pad && x < game.camX + W + pad && y > game.camY - pad && y < game.camY + H + pad;
}

function drawMinimap() {
  const s = 140 / Math.max(WORLD_W, WORLD_H);
  mmCtx.fillStyle = "#1a2820";
  mmCtx.fillRect(0, 0, 140, 140);

  // Giant center gold monument.
  mmCtx.fillStyle = "#f2c94c";
  for (const g of goldChunks) {
    if (!g.pure) continue;
    const sz = 10;
    mmCtx.fillRect(g.x * s - sz / 2, g.y * s - sz / 2, sz, sz);
  }

  // Big Mommas are the only wildlife shown on the minimap.
  // Large amber diamonds make these rare roaming encounters easy to hunt down.
  mmCtx.fillStyle = "#ffb347";
  for (const a of animals) {
    if (a.dead || a.owned || a.stage !== "bigmomma") continue;
    const mx = a.x * s, my = a.y * s;
    mmCtx.save();
    mmCtx.translate(mx, my);
    mmCtx.rotate(Math.PI / 4);
    mmCtx.fillRect(-2.8, -2.8, 5.6, 5.6);
    mmCtx.restore();
  }

  // Hostile cubes.
  mmCtx.fillStyle = "#e0563f";
  for (const en of enemies) {
    if (en.dead) continue;
    mmCtx.fillRect(en.x * s - 1.5, en.y * s - 1.5, 3, 3);
  }

  // Other online players. Use each cube's color with a bright outline so they are easy to spot.
  if (net.room) {
    for (const v of net.remoteVisuals.values()) {
      if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || (Number(v.health) || 0) <= 0) continue;
      const mx = v.x * s, my = v.y * s;
      mmCtx.fillStyle = "rgba(255,255,255,0.92)";
      mmCtx.fillRect(mx - 2.8, my - 2.8, 5.6, 5.6);
      mmCtx.fillStyle = v.color || "#c77dff";
      mmCtx.fillRect(mx - 1.8, my - 1.8, 3.6, 3.6);
    }
  }

  // Player.
  mmCtx.fillStyle = "#6ec1ff";
  mmCtx.fillRect(player.x * s - 2, player.y * s - 2, 4, 4);

  // Pets as white dots.
  mmCtx.fillStyle = "#ffffff";
  for (const p of player.pets) {
    if (p.dead) continue;
    mmCtx.beginPath();
    mmCtx.arc(p.x * s, p.y * s, 1.7, 0, TAU);
    mmCtx.fill();
  }

  mmCtx.strokeStyle = "rgba(240,230,200,0.3)";
  mmCtx.strokeRect(0.5, 0.5, 139, 139);
}

function draw(menuMode = false) {
  // Defensive canvas reset: if any previous frame threw while a translated/rotated
  // drawing state was active, never allow that transform to leak into this frame.
  // IMPORTANT: restore the DPR-scaled transform, not identity, or the world only
  // renders into part of the screen and stale pixels remain around it.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  let sx = 0, sy = 0;
  if (game.shake > 0) {
    sx = rand(-game.shake, game.shake);
    sy = rand(-game.shake, game.shake);
    game.shake *= 0.85;
    if (game.shake < 0.3) game.shake = 0;
  }
  drawBackground();
  ctx.save();
  ctx.translate(-game.camX + sx, -game.camY + sy);

  const viewCx = game.camX + W * 0.5;
  const viewCy = game.camY + H * 0.5;
  const viewRange = Math.hypot(W, H) * 0.55 + 220;
  const viewResources = queryStaticNearby("resources", viewCx, viewCy, viewRange);
  const viewGold = queryStaticNearby("gold", viewCx, viewCy, viewRange);
  const viewChests = queryStaticNearby("chests", viewCx, viewCy, viewRange);
  const visibleTrees = [];
  for (const r of viewResources) {
    if (r.alive && r.type === "tree" && inView(r.x, r.y, 90)) visibleTrees.push(r);
  }
  visibleTrees.sort((a, b) => resourceDrawY(a) - resourceDrawY(b));

  // Rocks and every kind of gold chunk are low ground objects: draw them first
  // so the player can visually pass over them. Trees still remain above everyone.
  for (const r of viewResources) {
    if (r.alive && r.type === "rock" && inView(r.x, r.y, 70)) drawResource(r);
  }
  for (const g of viewGold) if (inView(g.x, g.y, g.pure ? g.r + 40 : 80)) drawGoldChunk(g);

  // On foot, draw the player after rocks/gold but before taller world objects.
  // When riding, delay the player until after the mount so the rider sits on top.
  if (!menuMode && !player.riding) {
    drawAbilityFx();
    drawPlayer();
  }
  if (!menuMode) drawRemotePlayers();

  // Taller world objects still sit over an on-foot player.
  for (const r of viewResources) {
    if (r.alive && r.type !== "tree" && r.type !== "rock" && inView(r.x, r.y, 70)) drawResource(r);
  }
  for (const c of viewChests) if (!c.opened && inView(c.x, c.y, 60)) drawChest(c);
  for (const w of walls) if (inView(w.x, w.y, 50)) drawWall(w);
  for (const t of towers) if (inView(t.x, t.y, 50)) drawTower(t);

  // Animal trails are a ground effect: draw them BEFORE wildlife and pets.
  for (const p of particles) {
    if (!p.trail || !inView(p.x, p.y, 20)) continue;
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * 0.7;
    ctx.fillStyle = p.color;
    circ(p.x, p.y, p.size);
  }
  ctx.globalAlpha = 1;
  for (const a of animals) if (!a.owned && inView(a.x, a.y, 50)) drawAnimal(a);
  for (const p of player.pets) if (inView(p.x, p.y, 50)) drawAnimal(p);
  if (!menuMode) drawRemotePets();
  for (const en of enemies) if (!en.dead && inView(en.x, en.y, 50)) drawEnemy(en);
  for (const p of projectiles) if (inView(p.x, p.y, 30)) drawProjectile(p);
  for (const b of petBlasts) {
    if (!inView(b.x, b.y, 30)) continue;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    ctx.fillStyle = b.color;
    if (b.kind === "fire") {
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ffcc40"; ctx.beginPath(); ctx.ellipse(2, 0, 6, 4, 0, 0, TAU); ctx.fill();
    } else if (b.kind === "lightning") {
      ctx.strokeStyle = "#ffe66d"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-2, -5); ctx.lineTo(2, 4); ctx.lineTo(8, 0); ctx.stroke();
    } else if (b.kind === "ice") {
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
    } else if (b.kind === "water") {
      ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, TAU); ctx.fill();
    } else if (b.kind === "leaf") {
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#3a8a40"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
    } else {
      circ(0, 0, b.r);
    }
    ctx.restore();
  }
  if (!menuMode && player.riding) {
    drawAbilityFx();
    drawPlayer();
  }
  // Top-down trees always sit above the player, pets, wildlife, and enemies.
  // Draw the full leafy tree after all creatures so you are always underneath it.
  for (const tr of visibleTrees) drawResource(tr);
  for (const tr of visibleTrees) drawTreeCanopy(tr);
  drawFx();
  // Important HP bars draw last so they stay in front of all in-game visuals.
  drawTopHealthOverlays(viewResources, viewGold, viewChests);

  ctx.restore();

  // day/night overlay
  const phase = TIME_PHASES[game.phaseIdx];
  if (!menuMode && phase.sky > 0.05) {
    ctx.fillStyle = `rgba(10,15,30,${phase.sky * 0.55})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Cached vignette: same look, no new gradient allocation every frame.
  if (vignetteGradient) {
    ctx.fillStyle = vignetteGradient;
    ctx.fillRect(0, 0, W, H);
  }

  if (!menuMode) drawMinimap();

  // Only a fully completed frame becomes the recovery frame.
  captureLastGoodFrame();
}

// ---------- main loop ----------
let last = performance.now();
let restartAllowedAt = 0;
function endGame() {
  game.over = true;
  // servs earned
  const earned = Math.floor(game.survivalTime * 0.4 + game.kills * 2 + game.wave * 3);
  game.earnedServs = earned;
  meta.servs += earned;
  saveMeta();
  el("finalTime").childNodes[0].nodeValue = fmtTime(game.survivalTime);
  el("finalKills").childNodes[0].nodeValue = String(game.kills);
  el("finalWave").childNodes[0].nodeValue = String(game.wave);
  el("finalServs").textContent = earned;
  restartAllowedAt = performance.now() + 650;
  el("overlay").classList.add("show");
}

function resetGame() {
  // Run-only gold gear never carries into a new attempt.
  runShop = freshRunShopState();
  game.tamePending = false;
  // Chat history is per-run for this local player only.
  resetChatForNewRun();
  const restartingAfterDeath = !!(game.over || player.dead);
  const previousRunX = player.x;
  const previousRunY = player.y;
  player.x = WORLD_W / 2 + 145; player.y = WORLD_H / 2; player.angle = 0;
  player.health = 100; player.maxHealth = 100;
  player.wood = meta.ownedStarters.wood50 ? 50 : 0;
  player.stone = meta.ownedStarters.stone20 ? 20 : 0;
  player.gold = meta.ownedStarters.gold5 ? 5 : 0;
  player.berries = 0;
  player.tool = "Fist";
  player.heldSpecial = null;
  player.owned = { Fist: true, Axe: !!meta.ownedStarters.startAxe, Pickaxe: false, Sword: false, Bow: false };
  if (meta.ownedStarters.startAxe) player.tool = "Axe";
  player.attackCd = 0; player.shootCd = 0; player.punchTimer = 0; player.punchSide = 1;
  player.hurtFlash = 0; player.dead = false; player.splitT = 0;
  player.color = meta.color;
  player.username = meta.username || "Cube";
  player.inventory = [];
  player.hasSaddle = !!meta.ownedStarters.saddle;
  player.pets = [];
  player.riding = null;

  // starting pet — species cards can permanently raise its starting stage.
  if (game.startPet && PET_TYPES[game.startPet]) {
    const type = game.startPet;
    const info = PET_TYPES[type];
    const stage = starterStageFor(type);
    const rr = animalRadius(type, stage);
    const maxHp = upgradedPetMaxHp(type, stage);
    const coats = PET_TYPES[type].coats || [PET_TYPES[type].color];
    const coat = coats[randi(0, coats.length - 1)];
    const hasSpots = type === "dog" && Math.random() < 0.5;
    player.pets.push({
      type, stage, x: player.x + 45, y: player.y,
      angle: 0, r: rr, hp: maxHp, maxHp, speed: upgradedPetSpeed(type, stage),
      coat, spots: hasSpots ? Array.from({ length: 4 }, () => ({ x: rand(-0.4, 0.4), y: rand(-0.3, 0.3), s: rand(0.12, 0.2) })) : [],
      spotCol: shadeColor(coat, -30),
      sleeping: false, owned: true, follow: true, orderMode: "follow", petName: info.name,
      abilityCd: 0, targetX: null, targetY: null,
      huntTarget: null, huntRetarget: 0, huntWanderT: 0,
      wanderT: 0, wanderA: 0, flash: 0, dead: false, tailPhase: 0,
      atkCd: 0, combat: 0, exp: 0, level: 1,
      recentHit: 0, attackAnim: 0,
    });
  }

  game.time = 0; game.survivalTime = 0; game.kills = 0; game.wave = 0; game.waveTimer = 4;
  el("finalTime").childNodes[0].nodeValue = "0:00";
  game.over = false; game.camX = 0; game.camY = 0; game.shake = 0;
  game.deathCamTarget = null; game.deathCamTargetKind = ""; game.deathCamTargetId = "";
  game.phaseIdx = 0; game.phaseTimer = TIME_PHASES[0].duration; game.dayCount = 1;
  game.earnedServs = 0;
  restartAllowedAt = 0;

  initWorld();

  // Every run begins at a safe random location. After death, force the new run
  // into a clearly different region so Try Again never feels like a same-spot revive.
  const spawn = chooseRandomPlayerSpawn(
    restartingAfterDeath ? previousRunX : null,
    restartingAfterDeath ? previousRunY : null,
    restartingAfterDeath ? 2400 : 0
  );
  player.x = spawn.x;
  player.y = spawn.y;
  player.angle = rand(-Math.PI, Math.PI);
  for (let i = 0; i < player.pets.length; i++) {
    const pet = player.pets[i];
    const a = i * 0.9 + 0.35;
    pet.x = clamp(player.x + Math.cos(a) * 46, 30, WORLD_W - 30);
    pet.y = clamp(player.y + Math.sin(a) * 46, 30, WORLD_H - 30);
    pet.angle = player.angle;
  }
  game.camX = clamp(player.x - W / 2, 0, Math.max(0, WORLD_W - W));
  game.camY = clamp(player.y - H / 2, 0, Math.max(0, WORLD_H - H));
  game.homeCamReady = false;
  if (net.room) {
    try {
      net.room.send("respawn", {
        avoidX: restartingAfterDeath ? previousRunX : null,
        avoidY: restartingAfterDeath ? previousRunY : null,
        minDistance: restartingAfterDeath ? 2400 : 0
      });
    } catch (_) {}
    syncNetworkWorldResources();
    syncNetworkFullWorld(true);
  }

  el("overlay").classList.remove("show");
  el("craftOverlay").classList.remove("show");
  el("invOverlay").classList.remove("show");
  el("runShopOverlay").classList.remove("show");
  closePetRename();
  document.getElementById("timeBanner").textContent = "Day 1";
  document.getElementById("timeBanner").style.background = "";
  buildHotbar();
  syncPetCards();
}

let lastFrameErrorLogAt = 0;
let recentFrameErrorCount = 0;
let frameErrorWindowAt = 0;
let hudSyncAccum = 0;

function frame(now) {
  // Schedule FIRST. If anything below throws, one bad frame cannot permanently
  // stop requestAnimationFrame and freeze the whole game.
  requestAnimationFrame(frame);

  let dt = (now - last) / 1000;
  last = now;

  // Ignore background-tab / debugger / device stalls instead of simulating a huge catch-up.
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 1 / 24);

  try {
    trimRuntimeLists();
    if (mobileMode) updateMobileInput(dt);

    if (game.started) {
      // Death only disables the player's actions. The world keeps simulating so
      // the transparent death screen can show the live killer-follow camera.
      if (!player.dead && !game.over) game.survivalTime += dt;

      if (net.room) {
        net.fullSyncAccum += dt;
        if (net.fullSyncAccum >= 1 / 10) {
          net.fullSyncAccum %= 1 / 10;
          syncNetworkFullWorld();
        }

        updateNetworkAnimalInterpolation(dt);
        updateNetworkPetInterpolation(dt);
        updateNetworkEnemyInterpolation(dt);
        updateNetworkProjectileMotion(dt);
        updatePlayer(dt);
        applyNetworkWildlifeMovementCarry();
        updateResources(dt);
        updateAbilityFx(dt);
        sendNetworkInput(dt);
        updateRemotePlayers(dt);
      } else {
        game.time += dt;
        updatePlayer(dt);
        updateEnemies(dt);
        updateProjectiles(dt);
        updatePetBlasts(dt);
        updateTowers(dt);
        updateResources(dt);
        updateWalls(dt);
        updateAnimals(dt);
        updateAbilityFx(dt);
        updateTime(dt);
        updateRemotePlayers(dt);
      }
    }

    updateFx(dt);

    if (game.started) {
      const cameraTarget = player.dead ? deathCameraFocus() : player;
      const targetX = Number(cameraTarget && cameraTarget.x);
      const targetY = Number(cameraTarget && cameraTarget.y);
      if (Number.isFinite(targetX) && Number.isFinite(targetY)) {
        game.camX = clamp(targetX - W / 2, 0, Math.max(0, WORLD_W - W));
        game.camY = clamp(targetY - H / 2, 0, Math.max(0, WORLD_H - H));
      } else {
        game.camX = clamp(Number(game.camX) || 0, 0, Math.max(0, WORLD_W - W));
        game.camY = clamp(Number(game.camY) || 0, 0, Math.max(0, WORLD_H - H));
      }
      draw(false);

      // DOM HUD work doesn't need to run 60 times per second.
      hudSyncAccum += dt;
      if (hudSyncAccum >= 0.08) {
        hudSyncAccum = 0;
        syncHud();
        updateTameBtn();
      }
    } else {
      updateHomeCamera(dt);
      updateHomeAnimals(dt);
      draw(true);
    }
  } catch (err) {
    // Keep the game alive even if one entity/effect produces a bad frame.
    const t = performance.now();
    if (t - frameErrorWindowAt > 5000) { frameErrorWindowAt = t; recentFrameErrorCount = 0; }
    recentFrameErrorCount++;
    if (t - lastFrameErrorLogAt > 2000) {
      lastFrameErrorLogAt = t;
      console.error("Cube Survival recovered from a frame error:", err);
    }

    // Never use ctx.reset() here: on browsers that implement it, reset() can
    // clear the backing buffer. Restore the last frame that completed correctly,
    // then re-establish the normal DPR transform for the next requestAnimationFrame.
    try {
      if (!net.room) restoreLastGoodFrame();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    } catch (_) {}

    // Clear the most disposable runtime effects, which are common sources of
    // malformed temporary objects, without deleting player progress/world state.
    particles.length = 0;
    floaters.length = 0;
    abilityFx.length = 0;
    projectiles = projectiles.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    petBlasts = petBlasts.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  }
}

el("tameBtn").addEventListener("click", (e) => { e.preventDefault(); tryTameNearby(); });
el("tameBtn").addEventListener("touchstart", (e) => { e.preventDefault(); tryTameNearby(); }, { passive: false });

// ---------- home screen ----------
function claimDailyServs() {
  const today = new Date().toISOString().slice(0, 10);
  if (meta.lastDaily === today) return false;
  meta.lastDaily = today;
  meta.servs = (meta.servs || 0) + 5;
  saveMeta();
  return true;
}
function isPetUnlocked(type) {
  if (PET_TYPES[type] && PET_TYPES[type].startUnlock) return true;
  return !!meta.ownedStarters["start_" + type];
}
function openPetShop() {
  if (game.started && !game.over) return;
  buildPetShop();
  el("petShopOverlay").classList.add("show");
}
function buildPetShop() {
  if (!meta.speciesCards) meta.speciesCards = {};
  if (!meta.petStages) meta.petStages = {};
  el("petShopServs").textContent = meta.servs;
  const grid = el("petShopGrid");
  grid.innerHTML = "";

  for (const type of Object.keys(PET_TYPES)) {
    const info = PET_TYPES[type];
    const unlock = PET_UNLOCK[type] || { cards: 50, servs: 500, rarity: "Common" };
    const cards = meta.speciesCards[type] || 0;
    const unlocked = isPetUnlocked(type);
    const stage = starterStageFor(type);

    const div = document.createElement("div");
    div.className = "pet-shop-item " + (unlocked ? "owned" : "locked");

    const status = unlocked
      ? `<span style="color:#8fe29a;font-weight:800">Owned</span> · ${cards} card${cards === 1 ? "" : "s"}`
      : `${cards}/${unlock.cards} cards · <span style="color:#f4c65f">${unlock.servs} Gold Cubits</span>`;

    div.innerHTML = `
      <div class="pet-shop-title-row">
        <b>${info.emoji} ${info.name}</b>
        ${unlocked ? `<span class="pet-shop-stage">${stageDisplayName(stage)}</span>` : ""}
      </div>
      <div style="font-size:11px;opacity:0.7;margin-top:4px">${info.elem} · ${unlock.rarity}</div>
      <div style="font-size:11px;margin-top:6px">${status}</div>
      <div class="pet-shop-actions"></div>
    `;

    const actions = div.querySelector(".pet-shop-actions");

    if (!unlocked) {
      const unlockBtn = document.createElement("button");
      unlockBtn.type = "button";
      unlockBtn.className = "pet-shop-action primary";
      unlockBtn.textContent = "Unlock";
      unlockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const currentCards = meta.speciesCards[type] || 0;
        if (currentCards >= unlock.cards) {
          meta.speciesCards[type] -= unlock.cards;
          meta.ownedStarters["start_" + type] = true;
          meta.petStages[type] = "baby";
          saveMeta();
          banner(`Unlocked ${info.name} with cards!`);
          buildPetShop();
          buildCardInventory();
          setupHome();
        } else if (meta.servs >= unlock.servs) {
          if (!confirm(`Unlock ${info.name} for ${unlock.servs} Gold Cubits?`)) return;
          meta.servs -= unlock.servs;
          meta.ownedStarters["start_" + type] = true;
          meta.petStages[type] = "baby";
          saveMeta();
          banner(`Unlocked ${info.name}!`);
          buildPetShop();
          buildCardInventory();
          setupHome();
        } else {
          alert(`Need ${unlock.cards} cards (have ${currentCards}) or ${unlock.servs} Gold Cubits (have ${meta.servs}).`);
        }
      });
      actions.appendChild(unlockBtn);
    } else {
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "pet-shop-action primary" + (game.startPet === type ? " selected" : "");
      useBtn.textContent = game.startPet === type ? "Selected Starter" : "Use as Starter";
      useBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        game.startPet = game.startPet === type ? null : type;
        updateSelectedStarterPetLabel();
        setupHome();
        buildPetShop();
      });
      actions.appendChild(useBtn);
    }

    const cardsBtn = document.createElement("button");
    cardsBtn.type = "button";
    cardsBtn.className = "pet-shop-action cards";
    cardsBtn.textContent = unlocked ? "Cards / Upgrade" : "View Cards";
    cardsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCardInventory(type);
    });
    actions.appendChild(cardsBtn);

    grid.appendChild(div);
  }
}

function buildCardInventory() {
  const list = el("cardInventoryList"), page = el("petUpgradePage"), lead = el("cardInventoryLead");
  if (!list || !page) return;
  if (!meta.speciesCards) meta.speciesCards = {};
  if (!meta.petStages) meta.petStages = {};
  if (!meta.petStatUpgrades) meta.petStatUpgrades = {};

  if (cardInventoryFocus && PET_TYPES[cardInventoryFocus]) {
    list.style.display = "none";
    page.classList.add("show");
    if (lead) lead.textContent = "Upgrade this pet permanently with its species cards.";
    buildPetUpgradePage(cardInventoryFocus);
    return;
  }

  page.classList.remove("show");
  list.style.display = "";
  if (lead) lead.textContent = "Click a pet to open its upgrade page. Spend that species' cards on stats or its permanent starting stage.";
  list.innerHTML = "";

  for (const type of Object.keys(PET_TYPES)) {
    const info = PET_TYPES[type], count = meta.speciesCards[type] || 0, unlocked = isPetUnlocked(type);
    const stage = starterStageFor(type), levels = ensurePetStatUpgrades(type);
    const spentLevels = Object.values(levels).reduce((a,b) => a + (Number(b)||0), 0);
    const row = document.createElement("div");
    row.className = "card-inventory-row pet-page-link";
    row.dataset.petType = type;
    row.innerHTML = `
      <div>
        <div class="card-prog-name">${info.emoji} ${info.name}</div>
        <div class="card-prog-meta">${unlocked ? `Owned · ${stageDisplayName(stage)} · ${spentLevels} stat upgrade level${spentLevels===1?"":"s"}` : "Locked · View its card page"}</div>
      </div>
      <div class="card-prog-count">${count} card${count===1?"":"s"} ›</div>`;
    row.addEventListener("click", () => { cardInventoryFocus = type; buildCardInventory(); });
    list.appendChild(row);
  }
}
function petStatBonusText(type, stat) {
  const level = petStatLevel(type, stat);
  if (!level) return "Base";
  if (stat === "defense") return `${Math.round((1 - petUpgradeMultiplier(type, stat)) * 100)}% less damage`;
  return `+${Math.round((petUpgradeMultiplier(type, stat) - 1) * 100)}%`;
}
function buildPetUpgradePage(type) {
  const root = el("petUpgradePageContent");
  if (!root || !PET_TYPES[type]) return;
  ensurePetStatUpgrades(type);
  const info = PET_TYPES[type], cards = meta.speciesCards[type] || 0, unlocked = isPetUnlocked(type);
  const stage = starterStageFor(type), nextStage = unlocked ? nextPetCardStage(stage) : null;
  const stageCost = nextStage ? petStageUpgradeCost(nextStage) : 0;

  root.innerHTML = `
    <div class="pet-upgrade-hero">
      <div><div class="pet-upgrade-title">${info.emoji} ${info.name}</div>
      <div class="card-prog-meta">${unlocked ? `Owned · Starting stage: ${stageDisplayName(stage)}` : "This pet is locked."}</div></div>
      <div class="pet-upgrade-cards">${cards} ${info.name} Card${cards===1?"":"s"}</div>
    </div>
    <div class="pet-upgrade-stage" id="petUpgradeStageBox"></div>
    <div class="pet-stat-upgrade-grid" id="petStatUpgradeGrid"></div>`;

  const stageBox = el("petUpgradeStageBox");
  if (!unlocked) {
    stageBox.innerHTML = `<b>Unlock required</b><div class="card-prog-meta" style="margin-top:4px">You can view this page, but you can only spend stat cards after you own this pet.</div>`;
    const b=document.createElement("button"); b.className="card-locked-btn"; b.type="button"; b.textContent="Open Pets"; b.style.marginTop="8px";
    b.addEventListener("click",()=>{closeCardInventory();openPetShop();}); stageBox.appendChild(b);
  } else if (nextStage) {
    stageBox.innerHTML = `<b>Starting Stage</b><div class="card-prog-meta" style="margin:4px 0 8px">${stageDisplayName(stage)} → ${stageDisplayName(nextStage)}</div>`;
    const b=document.createElement("button"); b.className="card-upgrade-btn"; b.type="button"; b.disabled=cards<stageCost;
    b.textContent=cards>=stageCost?`Upgrade Starting Stage — ${stageCost} Cards`:`Need ${stageCost} Cards`;
    b.addEventListener("click",()=>upgradePetCardStage(type)); stageBox.appendChild(b);
  } else {
    stageBox.innerHTML = `<b>Starting Stage</b><div class="card-prog-meta" style="margin-top:4px">Max Card Stage — Super Boss</div>`;
  }

  const grid=el("petStatUpgradeGrid");
  for (const [stat,sInfo] of Object.entries(PET_STAT_UPGRADE_INFO)) {
    const level=petStatLevel(type,stat), cost=petStatUpgradeCost(type,stat);
    const box=document.createElement("div"); box.className="pet-stat-upgrade";
    box.innerHTML=`<div class="pet-stat-head"><div class="pet-stat-name">${sInfo.icon} ${sInfo.name}</div><div class="pet-stat-level">Lv ${level}/${PET_STAT_UPGRADE_MAX}</div></div>
      <div class="pet-stat-desc">${sInfo.desc}</div><div class="pet-stat-bonus">${petStatBonusText(type,stat)}</div>
      <div class="pet-stat-track"><div class="pet-stat-fill" style="width:${(level/PET_STAT_UPGRADE_MAX)*100}%"></div></div>`;
    const b=document.createElement("button"); b.type="button"; b.className="card-upgrade-btn";
    if(!unlocked){b.disabled=true;b.textContent="Own this pet first";}
    else if(level>=PET_STAT_UPGRADE_MAX){b.disabled=true;b.textContent="MAX";}
    else{b.disabled=cards<cost;b.textContent=cards>=cost?`Upgrade — ${cost} Cards`:`Need ${cost} Cards`;b.addEventListener("click",()=>upgradePetStat(type,stat));}
    box.appendChild(b);grid.appendChild(box);
  }
}
function upgradePetStat(type, stat) {
  if (!PET_TYPES[type] || !PET_STAT_UPGRADE_INFO[stat] || !isPetUnlocked(type)) return;
  const levels=ensurePetStatUpgrades(type), level=Number(levels[stat])||0;
  if(level>=PET_STAT_UPGRADE_MAX)return;
  const cost=petStatUpgradeCost(type,stat), cards=meta.speciesCards[type]||0;
  if(cards<cost){alert(`Need ${cost} ${PET_TYPES[type].name} cards. You have ${cards}.`);return;}
  meta.speciesCards[type]=cards-cost; levels[stat]=level+1; saveMeta();
  for(const p of player.pets||[])if(p&&p.type===type&&p.owned)applyOwnedPetCardStats(p,false);
  banner(`${PET_TYPES[type].name} ${PET_STAT_UPGRADE_INFO[stat].name} upgraded to Lv ${level+1}!`);
  buildCardInventory(); buildPetShop(); setupHome();
}
let cardInventoryFocus = null;
function openCardInventory(type = null) {
  if (game.started && !game.over) return;
  cardInventoryFocus = type && PET_TYPES[type] ? type : null;
  el("petShopOverlay").classList.remove("show");
  buildCardInventory();
  el("cardInventoryOverlay").classList.add("show");
}
function upgradePetCardStage(type) {
  if (!PET_TYPES[type] || !isPetUnlocked(type)) return;
  if (!meta.petStages) meta.petStages = {};
  if (!meta.speciesCards) meta.speciesCards = {};

  const current = starterStageFor(type);
  const nextStage = nextPetCardStage(current);
  if (!nextStage) return;

  const cost = petStageUpgradeCost(nextStage);
  const cards = meta.speciesCards[type] || 0;
  if (cards < cost) {
    alert(`Need ${cost} ${PET_TYPES[type].name} cards. You have ${cards}.`);
    return;
  }

  meta.speciesCards[type] = cards - cost;
  meta.petStages[type] = nextStage;
  saveMeta();

  banner(`${PET_TYPES[type].name} card stage upgraded to ${stageDisplayName(nextStage)}!`);
  buildCardInventory();
  buildPetShop();
  setupHome();
}
function closeCardInventory() {
  cardInventoryFocus = null;
  el("cardInventoryOverlay").classList.remove("show");
}

function setHomeControlsEnabled(enabled) {
  const selectors = [
    "#home button",
    "#home input",
    "#home .shop-item",
    "#home .pet-opt",
    "#home .swatch",
    "#homeCardsBtn",
    "#openStarterShop",
    "#starterShopOverlay button",
    "#starterShopOverlay .shop-item",
    "#petShopOverlay button",
    "#petShopOverlay .pet-shop-item",
    "#cardInventoryOverlay button",
    "#chooseStarterPetOverlay button",
    "#playerDesignOverlay button",
    "#playerDesignOverlay .swatch",
    "#homeThemeOverlay button"
  ].join(",");
  document.querySelectorAll(selectors).forEach(node => {
    if ("disabled" in node) node.disabled = !enabled;
    node.style.pointerEvents = enabled ? "" : "none";
  });
  const home = el("home");
  if (home) home.style.pointerEvents = enabled ? "auto" : "none";
}

function drawHomePreview() {
  const c = document.getElementById("homePreview");
  if (!c) return;
  const x = c.getContext("2d");
  const w = c.width || 96;
  const h = c.height || 96;
  const s = Math.min(w, h) / 48;

  x.clearRect(0, 0, w, h);
  x.fillStyle = meta.color || COLORS[0];
  x.strokeStyle = "rgba(0,0,0,0.35)";
  x.lineWidth = 2 * s;
  x.beginPath();
  x.roundRect(8*s, 8*s, 32*s, 32*s, 6*s);
  x.fill(); x.stroke();

  x.fillStyle = "#12202b";
  x.beginPath(); x.arc(28*s, 18*s, 3*s, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(28*s, 28*s, 3*s, 0, Math.PI * 2); x.fill();
}
function setupHome() {
  const home = el("home");
  applyHomeTheme(currentHomeTheme, false);
  if (home) {
    home.style.display = "flex";
    home.style.pointerEvents = "auto";
  }
  syncHomeWorldThemeState();
  setHomeControlsEnabled(true);
  el("username").value = meta.username || "Cube";
  const preferredServer = preferredMultiplayerServerUrl();
  if (el("serverUrl")) el("serverUrl").value = preferredServer;
  updateOnlineModeUI();
  drawHomePreview();
  if (!meta.ownedStarters) meta.ownedStarters = {};
  if (!meta.speciesCards) meta.speciesCards = {};
  if (!meta.petStages) meta.petStages = {};
  for (const k of Object.keys(PET_TYPES)) {
    if (meta.speciesCards[k] == null) meta.speciesCards[k] = 0;
    if (!PET_CARD_STAGE_ORDER.includes(meta.petStages[k])) meta.petStages[k] = "baby";
  }
  buildCardInventory();

  // daily +5 servs
  const gotDaily = claimDailyServs();
  el("homeServs").textContent = meta.servs;
  const dailyEl = el("dailyServsHint");
  if (dailyEl) {
    dailyEl.textContent = gotDaily
      ? "+5 daily Gold Cubits"
      : "Daily bonus already claimed";
  }

  // colors
  const sw = el("colorSwatches");
  sw.innerHTML = "";
  COLORS.forEach(c => {
    const d = document.createElement("div");
    d.className = "swatch" + (meta.color === c ? " selected" : "");
    d.style.background = c;
    d.addEventListener("click", () => {
      meta.color = c;
      saveMeta();
      sw.querySelectorAll(".swatch").forEach(x => x.classList.remove("selected"));
      d.classList.add("selected");
      drawHomePreview();
    });
    sw.appendChild(d);
  });

  // starter resource shop (not pet cards — those are in Other Pets)
  const shopItems = [
    { id: "wood50", name: "Start with 50 Wood", price: 80 },
    { id: "stone20", name: "Start with 20 Stone", price: 70 },
    { id: "gold5", name: "Start with 5 Gold", price: 100 },
    { id: "startAxe", name: "Start with Axe", price: 150 },
    { id: "saddle", name: "Start with Saddle", price: 220 },
  ];
  const grid = el("shopGrid");
  if (el("starterShopServs")) el("starterShopServs").textContent = meta.servs;
  grid.innerHTML = "";
  shopItems.forEach(item => {
    const owned = !!meta.ownedStarters[item.id];
    const div = document.createElement("div");
    div.className = "shop-item" + (owned ? " owned" : "");
    div.innerHTML = `<b>${item.name}</b><div class="price">${owned ? "Owned" : item.price + " Gold Cubits"}</div>`;
    div.addEventListener("click", () => {
      if (owned) return;
      if (meta.servs < item.price) { alert("Not enough Gold Cubits!"); return; }
      meta.servs -= item.price;
      meta.ownedStarters[item.id] = true;
      saveMeta();
      setupHome();
    });
    grid.appendChild(div);
  });

  updateSelectedStarterPetLabel();
}

function updateSelectedStarterPetLabel() {
  const box = el("selectedStarterPet");
  if (!box) return;

  if (!game.startPet || !PET_TYPES[game.startPet] || !isPetUnlocked(game.startPet)) {
    game.startPet = null;
    box.innerHTML = `<span>Starter Pet:</span> <b>None</b>`;
    return;
  }

  const info = PET_TYPES[game.startPet];
  const stage = starterStageFor(game.startPet);
  box.innerHTML = `<span>Starter Pet:</span> <b>${info.emoji} ${info.name}</b> <span class="starter-stage">· ${stageDisplayName(stage)}</span>`;
}

function buildOwnedStarterPetList() {
  const list = el("ownedStarterPetList");
  if (!list) return;
  list.innerHTML = "";

  const addCard = (type) => {
    const isNone = type == null;
    const selected = isNone ? !game.startPet : game.startPet === type;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "owned-starter-card" + (selected ? " selected" : "");

    if (isNone) {
      btn.innerHTML = `
        <span class="pet-ico">🚫</span>
        <span class="pet-name">None</span>
        <span class="pet-stage">No Starter Pet</span>
        <span class="pet-note">Start on your own</span>
      `;
    } else {
      const info = PET_TYPES[type];
      const stage = starterStageFor(type);
      btn.innerHTML = `
        <span class="pet-ico">${info.emoji}</span>
        <span class="pet-name">${info.name}</span>
        <span class="pet-stage">${stageDisplayName(stage)}</span>
        <span class="pet-note">${selected ? "Selected" : "Click to start with this pet"}</span>
      `;
    }

    btn.addEventListener("click", () => {
      game.startPet = type;
      updateSelectedStarterPetLabel();
      buildOwnedStarterPetList();
      setTimeout(closeChooseStarterPet, 90);
    });

    list.appendChild(btn);
  };

  addCard(null);
  for (const type of Object.keys(PET_TYPES)) {
    if (isPetUnlocked(type)) addCard(type);
  }
}

function openChooseStarterPet() {
  if (game.started && !game.over) return;
  buildOwnedStarterPetList();
  el("chooseStarterPetOverlay").classList.add("show");
}

function closeChooseStarterPet() {
  el("chooseStarterPetOverlay").classList.remove("show");
}

function openPlayerDesign() {
  if (game.started && !game.over) return;
  drawHomePreview();
  el("playerDesignOverlay").classList.add("show");
}

function closePlayerDesign() {
  el("playerDesignOverlay").classList.remove("show");
}

function openStarterShop() {
  if (game.started && !game.over) return;
  if (el("starterShopServs")) el("starterShopServs").textContent = meta.servs;
  el("starterShopOverlay").classList.add("show");
}
function closeStarterShop() {
  el("starterShopOverlay").classList.remove("show");
}

document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
  });
  btn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
});

el("chooseStarterPetBtn").addEventListener("click", openChooseStarterPet);
el("closeChooseStarterPet").addEventListener("click", closeChooseStarterPet);
el("chooseStarterPetOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("chooseStarterPetOverlay")) closeChooseStarterPet();
});

el("choosePlayerDesignBtn").addEventListener("click", openPlayerDesign);
el("closePlayerDesign").addEventListener("click", closePlayerDesign);
el("playerDesignOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("playerDesignOverlay")) closePlayerDesign();
});

el("homeThemeEffectsToggle").addEventListener("change", (e) => {
  setHomeThemeEffectsEnabled(e.target.checked, true);
});

el("homeBackgroundEffectsToggle").addEventListener("change", (e) => {
  setHomeBackgroundEffectsEnabled(e.target.checked, true);
});

el("homeThemesBtn").addEventListener("click", openHomeThemes);
el("closeHomeThemes").addEventListener("click", closeHomeThemes);
el("homeThemeOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("homeThemeOverlay")) closeHomeThemes();
});

el("openStarterShop").addEventListener("click", openStarterShop);
el("closeStarterShop").addEventListener("click", closeStarterShop);
el("starterShopOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("starterShopOverlay")) closeStarterShop();
});

el("otherPetsBtn").addEventListener("click", openPetShop);
el("closePetShop").addEventListener("click", () => el("petShopOverlay").classList.remove("show"));
el("petShopCardsBtn").addEventListener("click", () => openCardInventory());
el("homeCardsBtn").addEventListener("click", () => openCardInventory());
el("closeCardInventory").addEventListener("click", closeCardInventory);
el("petUpgradeBack").addEventListener("click", () => { cardInventoryFocus = null; buildCardInventory(); });
el("closeLootPopup").addEventListener("click", hideLootPopup);
el("cardInventoryOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("cardInventoryOverlay")) closeCardInventory();
});
el("petShopOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("petShopOverlay")) el("petShopOverlay").classList.remove("show");
});

el("chatToggle").addEventListener("click", () => setChatOpen(!el("chatBox").classList.contains("show")));
el("chatInput").addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  } else if (e.key === "Escape") {
    e.preventDefault();
    setChatOpen(false);
  }
});
el("chatInput").addEventListener("focus", () => { keys.clear(); mouse.down = false; mouse.rdown = false; });

el("savePetName").addEventListener("click", savePetRename);
el("cancelPetName").addEventListener("click", closePetRename);
el("renamePetInput").addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") { e.preventDefault(); savePetRename(); }
  else if (e.key === "Escape") { e.preventDefault(); closePetRename(); }
});
el("renamePetOverlay").addEventListener("mousedown", (e) => {
  if (e.target === el("renamePetOverlay")) closePetRename();
});
el("lootPopup").addEventListener("mousedown", (e) => {
  if (e.target === el("lootPopup")) hideLootPopup();
});

el("username").addEventListener("change", () => {
  meta.username = (el("username").value || "Cube").slice(0, 14);
  saveMeta();
});

el("offlineModeBtn").addEventListener("click", () => {
  net.enabled = false;
  localStorage.setItem("cubeOnlineMode", "offline");
  disconnectMultiplayer();
  updateOnlineModeUI();
});
el("onlineModeBtn").addEventListener("click", () => {
  net.enabled = true;
  localStorage.setItem("cubeOnlineMode", "online");
  saveMultiplayerServerInput();
  updateOnlineModeUI();
});
el("serverUrl").addEventListener("change", saveMultiplayerServerInput);
el("serverUrl").addEventListener("blur", saveMultiplayerServerInput);
net.enabled = localStorage.getItem("cubeOnlineMode") === "online";
updateOnlineModeUI();

el("playBtn").addEventListener("click", async () => {
  if (game.started && !game.over) return; // already playing
  setLoadingScreen(net.enabled ? "Connecting to the world…" : "Entering the world…", 28, true);
  await waitOneFrame();
  closeCardInventory();
  closeStarterShop();
  closeChooseStarterPet();
  closePlayerDesign();
  closeHomeThemes();
  el("petShopOverlay").classList.remove("show");
  meta.username = (el("username").value || "Cube").slice(0, 14);
  saveMeta();
  mobileMode = el("mobileMode").checked;
  document.getElementById("mobileControls").classList.toggle("on", mobileMode);
  resize();
  setHomeControlsEnabled(false);
  const home = document.getElementById("home");
  home.style.display = "none";
  home.style.pointerEvents = "none";
  syncHomeWorldThemeState();
  document.getElementById("hud").style.display = "block";
  game.started = true;
  game.over = false;
  resetGame();
  setLoadingScreen(net.enabled ? "Joining multiplayer…" : "Finishing world setup…", 72, !!net.enabled);
  await waitOneFrame();
  if (net.enabled) {
    const ok = await connectMultiplayer();
    if (!ok) {
      // Keep the run playable even if the multiplayer server is not running.
      net.enabled = false;
      localStorage.setItem("cubeOnlineMode", "offline");
    }
  }
  last = performance.now();
  hideLoadingScreen();
});
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0 && window._petSetTarget) {
    const pet = window._petSetTarget;
    const wx = e.clientX + game.camX, wy = e.clientY + game.camY;
    pet.targetX = wx; pet.targetY = wy; pet.follow = false; pet.orderMode = "set";
    if (net.room && pet.netId) { try { net.room.send("petOrder", { id:pet.netId, mode:"set", x:wx, y:wy }); } catch (_) {} }
    banner(petDisplayName(pet) + " heading out");
    window._petSetTarget = null;
  }
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".pet-card")) {
    document.querySelectorAll(".pet-menu").forEach((m) => m.classList.remove("show"));
  }
});

el("restartBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  // Restart only from a genuinely visible death screen, never from an invisible hit target
  // or the same click that happened to be in this screen position during gameplay.
  if (!game.over || !el("overlay").classList.contains("show")) return;
  if (performance.now() < restartAllowedAt) return;
  resetGame();
});
el("homeBtn").addEventListener("click", () => {
  disconnectMultiplayer();
  game.started = false;
  game.over = false;
  game.survivalTime = 0;
  el("finalTime").childNodes[0].nodeValue = "0:00";
  mouse.down = false;
  mouse.rdown = false;
  keys.clear();
  window._petSetTarget = null;

  // Close every gameplay modal so no invisible overlay can block the Home screen.
  hideLootPopup();
  el("overlay").classList.remove("show");
  el("craftOverlay").classList.remove("show");
  el("invOverlay").classList.remove("show");
  el("petShopOverlay").classList.remove("show");
  closeStarterShop();
  closeChooseStarterPet();
  closePlayerDesign();
  closeHomeThemes();
  closeCardInventory();
  closePetRename();
  setChatOpen(false, false);

  document.getElementById("hud").style.display = "none";
  const home = document.getElementById("home");
  home.style.display = "flex";
  home.style.pointerEvents = "auto";
  syncHomeWorldThemeState();
  setHomeControlsEnabled(true);
  document.getElementById("mobileControls").classList.remove("on");
  mouse.down = false;
  joyActive = false; joyTouchId = null;
  joyRawDX = joyRawDY = joyDX = joyDY = 0;
  if (joyKnob) joyKnob.style.transform = "translate(-50%,-50%)";
  game.homeCamReady = false;
  setupHome();
});

// boot
setLoadingScreen("Building the world…", 18, false);
initWorld();
setLoadingScreen("Choosing a home view…", 42, false);
game.homeCamReady = false;
pickHomeCameraTarget(true);
setLoadingScreen("Preparing menus and gear…", 66, false);
buildHotbar();
setupHome();
setLoadingScreen("Finishing touches…", 90, false);
requestAnimationFrame(frame);
hideLoadingScreen();

})();
