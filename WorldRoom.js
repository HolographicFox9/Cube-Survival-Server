// WorldRoom.js
// Cube Survival full multiplayer room.
// Server-authoritative shared world: resources, gold, chests, wildlife, pets,
// hostile cubes, walls, towers, projectiles, combat, taming, and day/night.

import { Room } from "@colyseus/core";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

const WORLD_W = 14400;
const WORLD_H = 14400;
const PLAYER_R = 18;
const GRID_CELL = 192;
const TAU = Math.PI * 2;

// ---------- Game 366 multiplayer chat safety ----------
const CHAT_MAX_LENGTH = 120;
const CHAT_COOLDOWN_MS = 650;
const CHAT_BLOCKED_WORDS = [
  "fuck","fucker","fucking","shit","bullshit","bitch","bitches","asshole",
  "dick","cock","pussy","cunt","motherfucker","nigger","nigga","faggot",
  "retard","whore","slut"
];

function cleanChatText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}
function normalizeChatForFilter(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function compactChatForFilter(value) {
  return normalizeChatForFilter(value).replace(/\s+/g, "");
}
function chatHasBlockedWord(value) {
  const spaced = normalizeChatForFilter(value);
  const compact = compactChatForFilter(value);
  return CHAT_BLOCKED_WORDS.some(word => {
    const w = word.toLowerCase();
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(spaced) || compact.includes(w);
  });
}
function chatHasLink(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const squashed = raw.replace(/\s+/g, "");
  if (/\b(?:https?|ftp):\/\//i.test(raw)) return true;
  if (/\bwww\s*\./i.test(raw)) return true;
  if (/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(raw)) return true;
  if (/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?\b/.test(raw)) return true;
  if (/\b(?:discord\.gg|discord\.com\/invite|t\.me|youtu\.be)\b/i.test(squashed)) return true;
  if (/\b[a-z0-9][a-z0-9-]{0,62}\s*\.\s*(?:com|net|org|gg|io|co|app|dev|me|tv|xyz|us|uk|ca|edu|gov)\b/i.test(raw)) return true;
  if (/\b(?:dot)\s*(?:com|net|org|gg|io|co|app|dev|me|tv|xyz)\b/i.test(raw)) return true;
  return false;
}
function safeChatUsername(value) {
  const name = cleanChatText(value).slice(0, 14) || "Cube";
  return (chatHasBlockedWord(name) || chatHasLink(name)) ? "Cube" : name;
}


const TIME_PHASES = [
  { name: "Day", duration: 72, safe: true, spawn: false, strong: false },
  { name: "Dawn", duration: 18, safe: true, spawn: false, strong: false },
  { name: "Night", duration: 56, safe: false, spawn: true, strong: false },
  { name: "Midnight", duration: 36, safe: false, spawn: true, strong: true },
  { name: "Morning", duration: 18, safe: true, spawn: false, strong: false },
];

const PET_TYPES = {
  dog:    { baseSpeed: 78, friendly: true,  flee: false, sizeMul: 1.15, color: "#c9a06a", abilityCd: 14, elem: "Stone", coats:["#c9a06a","#8b6914","#e8d5b7","#5c4033","#d2b48c"] },
  cat:    { baseSpeed: 72, friendly: true,  flee: true,  sizeMul: 1.00, color: "#e8b8a0", abilityCd: 12, elem: "Sound", coats:["#e8b8a0","#f5d0a9","#c4a882","#8b7355","#f0e6d2"] },
  dragon: { baseSpeed: 38, friendly: true,  flee: true,  sizeMul: 1.05, color: "#d4a050", abilityCd: 16, elem: "Fire", coats:["#d4a050","#c4783a","#e8b86d","#a06030"] },
  fox:    { baseSpeed: 92, friendly: true,  flee: false, sizeMul: 1.08, color: "#e07a40", abilityCd: 13, elem: "Lightning", coats:["#e07a40","#d4652a","#f09550","#c85820"] },
  wolf:   { baseSpeed: 88, friendly: false, flee: false, sizeMul: 1.35, color: "#7a8a9a", abilityCd: 15, elem: "Ice", coats:["#7a8a9a","#9aa8b5","#5a6a7a","#b0bcc8","#4a5560"] },
  bear:   { baseSpeed: 48, friendly: false, flee: false, sizeMul: 1.55, color: "#8a6040", abilityCd: 17, elem: "Water", coats:["#8a6040","#6b4423","#a07850","#5c3a1e","#c4a882"] },
  rabbit: { baseSpeed: 95, friendly: true,  flee: true,  sizeMul: 0.85, color: "#e8e0d4", abilityCd: 11, elem: "Plant", coats:["#e8e0d4","#f5f0e8","#d4c8b8","#c9b8a0","#fff8f0"] },
  owl:    { baseSpeed: 70, friendly: true,  flee: true,  sizeMul: 1.05, color: "#c4a882", abilityCd: 13, elem: "Wind", coats:["#c4a882","#a89070","#e8d5b7","#8b7355"] },
  snake:  { baseSpeed: 68, friendly: false, flee: false, sizeMul: 1.10, color: "#5cb85c", abilityCd: 14, elem: "Poison", coats:["#5cb85c","#3a8a40","#7ec850","#2d6a30"] },
  deer:   { baseSpeed: 85, friendly: true,  flee: true,  sizeMul: 1.20, color: "#c9a06a", abilityCd: 15, elem: "Light", coats:["#c9a06a","#a07850","#e8d5b7","#8b6914"] },
  boar:   { baseSpeed: 55, friendly: false, flee: false, sizeMul: 1.40, color: "#6b4423", abilityCd: 16, elem: "Earth", coats:["#6b4423","#8a6040","#5c3a1e","#a07850"] },
  saber:  { baseSpeed:100, friendly: false, flee: false, sizeMul: 1.45, color: "#d4a060", abilityCd: 11, elem: "Combat", coats:["#d4a060","#c49050","#e8c080","#a07040","#f0d0a0"] },
};

const ANIMAL_BALANCE = {
  dog:    { hpMul:1.15, damageTaken:0.88, attack:6.5 },
  cat:    { hpMul:0.90, damageTaken:1.05, attack:7.2 },
  dragon: { hpMul:1.05, damageTaken:0.93, attack:6.2 },
  fox:    { hpMul:0.92, damageTaken:1.05, attack:8.5 },
  wolf:   { hpMul:1.20, damageTaken:0.82, attack:9.5 },
  bear:   { hpMul:1.45, damageTaken:0.72, attack:8.5 },
  rabbit: { hpMul:0.72, damageTaken:1.15, attack:5.0 },
  owl:    { hpMul:0.88, damageTaken:1.02, attack:6.0 },
  snake:  { hpMul:0.84, damageTaken:1.10, attack:9.0 },
  deer:   { hpMul:1.08, damageTaken:0.94, attack:6.0 },
  boar:   { hpMul:1.30, damageTaken:0.80, attack:9.0 },
  saber:  { hpMul:1.00, babyHpMul:1.78, damageTaken:0.98, attack:12.0 },
};
const ANIMAL_STAGE_HP = { baby:28, adult:100, boss:320, superboss:900, bigmomma:1900 };
const ANIMAL_STAGE_ATTACK = { baby:0.55, adult:1.15, boss:1.80, superboss:2.45, bigmomma:3.00 };
const ANIMAL_STAGE_DAMAGE_TAKEN = { baby:1.04, adult:1.00, boss:0.96, superboss:0.92, bigmomma:0.88 };
function animalBalance(type){ return ANIMAL_BALANCE[type]||{hpMul:1,babyHpMul:1,damageTaken:1,attack:7}; }
function animalDamageTaken(type,stage,raw){raw=Math.max(0,Number(raw)||0);if(raw<=0)return 0;return Math.max(.1,raw*animalBalance(type).damageTaken*(ANIMAL_STAGE_DAMAGE_TAKEN[stage]??1));}
function dogWallStats(stage){if(stage==="baby")return{hp:90,spikeDmg:4};if(stage==="adult")return{hp:120,spikeDmg:6};if(stage==="boss")return{hp:165,spikeDmg:8.5};if(stage==="superboss")return{hp:220,spikeDmg:11.5};return{hp:280,spikeDmg:14};}
function wallDamageForTool(toolName,w){const t=TOOL[toolName]||TOOL.Fist;return w?.kind==="stoneSpike"?(t.stoneWall||.5):(t.woodWall||1);}

const WILD_SPECIES = Object.keys(PET_TYPES);

const TOOL = {
  Fist:    { dmg: 1.0, range: 42, cadence: 0.50, gather: 0.06, resourcePower: 0.08, woodWall:1.0, stoneWall:0.45 },
  Axe:     { dmg: 7.0, range: 50, cadence: 0.55, gather: 3.2,  resourcePower: 1.20, woodWall:12.0, stoneWall:3.5 },
  Pickaxe: { dmg: 5.0, range: 50, cadence: 0.50, gather: 2.5,  resourcePower: 1.15, woodWall:4.0, stoneWall:14.0 },
  Sword:   { dmg:12.0, range: 56, cadence: 0.38, gather: 0.08, resourcePower: 0.12, woodWall:5.0, stoneWall:2.5 },
  Bow:     { dmg: 9.0, range: 46, cadence: 0.55, gather: 0.12, resourcePower: 0.18, woodWall:2.0, stoneWall:1.5 },
};

class PlayerState extends Schema {
  constructor() {
    super();
    this.id = ""; this.username = "Cube";
    this.x = WORLD_W / 2; this.y = WORLD_H / 2; this.angle = 0;
    this.health = 100; this.maxHealth = 100; this.dead = false;
    this.color = "#3fa7ff"; this.tool = "Fist"; this.ridingPetId = "";
    this.moveX = 0; this.moveY = 0; this.moving = false; this.animalCarryT = 0;
  }
}
defineTypes(PlayerState, {
  id:"string", username:"string", x:"number", y:"number", angle:"number",
  health:"number", maxHealth:"number", dead:"boolean", color:"string", tool:"string", ridingPetId:"string",
  moveX:"number", moveY:"number", moving:"boolean", animalCarryT:"number"
});

class ResourceState extends Schema {
  constructor() {
    super();
    this.type="rock"; this.x=0; this.y=0; this.hp=1; this.maxHp=1; this.alive=true;
    this.solidR=12; this.canopyR=0; this.scale=1; this.rot=0;
  }
}
defineTypes(ResourceState, { type:"string", x:"number", y:"number", hp:"number", maxHp:"number", alive:"boolean", solidR:"number", canopyR:"number", scale:"number", rot:"number" });

class GoldState extends Schema {
  constructor() { super(); this.x=0; this.y=0; this.size="small"; this.r=16; this.goldLeft=6; this.infinite=false; this.pure=false; }
}
defineTypes(GoldState, { x:"number", y:"number", size:"string", r:"number", goldLeft:"number", infinite:"boolean", pure:"boolean" });

class ChestState extends Schema {
  constructor() { super(); this.x=0; this.y=0; this.r=18; this.hp=4; this.maxHp=4; this.opened=false; this.pulse=0; this.shine=0; this.chipSide="wood"; }
}
defineTypes(ChestState, { x:"number", y:"number", r:"number", hp:"number", maxHp:"number", opened:"boolean", pulse:"number", shine:"number", chipSide:"string" });

class AnimalState extends Schema {
  constructor() {
    super();
    this.type="dog"; this.stage="baby"; this.x=0; this.y=0; this.angle=0; this.r=18;
    this.hp=26; this.maxHp=26; this.coat="#c9a06a"; this.spotCol="#8b6a45"; this.spotsJson="[]";
    this.speed=60; this.sleeping=false; this.tailPhase=0; this.attackAnim=0; this.flash=0;
    this.atkCd=0; this.abilityCd=0; this.combat=0; this.recentHit=0; this.wanderT=1; this.wanderA=0;
    this.fleeUntil=0; this.enraged=false; this.tameFailedAggro=false; this.desperateAggro=false;
    this.releasedWild=false; this.level=1; this.exp=0; this.petName="";
  }
}
defineTypes(AnimalState, {
  type:"string", stage:"string", x:"number", y:"number", angle:"number", r:"number",
  hp:"number", maxHp:"number", coat:"string", spotCol:"string", spotsJson:"string", speed:"number",
  sleeping:"boolean", tailPhase:"number", attackAnim:"number", flash:"number", atkCd:"number", abilityCd:"number",
  combat:"number", recentHit:"number", wanderT:"number", wanderA:"number", fleeUntil:"number", enraged:"boolean",
  tameFailedAggro:"boolean", desperateAggro:"boolean", releasedWild:"boolean", level:"number", exp:"number", petName:"string"
});

class PetState extends Schema {
  constructor() {
    super();
    this.ownerId=""; this.type="dog"; this.stage="baby"; this.x=0; this.y=0; this.angle=0; this.r=18;
    this.hp=26; this.maxHp=26; this.coat="#c9a06a"; this.spotCol="#8b6a45"; this.spotsJson="[]";
    this.speed=80; this.sleeping=false; this.tailPhase=0; this.attackAnim=0; this.flash=0;
    this.abilityCd=0; this.atkCd=0; this.combat=0; this.level=1; this.exp=0; this.petName="Pet";
    this.orderMode="follow"; this.targetX=-1; this.targetY=-1; this.dead=false;
    this.wanderT=rand(.6,2.2); this.wanderA=rand(0,TAU);
  }
}
defineTypes(PetState, {
  ownerId:"string", type:"string", stage:"string", x:"number", y:"number", angle:"number", r:"number",
  hp:"number", maxHp:"number", coat:"string", spotCol:"string", spotsJson:"string", speed:"number", sleeping:"boolean",
  tailPhase:"number", attackAnim:"number", flash:"number", abilityCd:"number", atkCd:"number", combat:"number",
  level:"number", exp:"number", petName:"string", orderMode:"string", targetX:"number", targetY:"number", dead:"boolean",
  wanderT:"number", wanderA:"number"
});

class EnemyState extends Schema {
  constructor() {
    super();
    this.x=0; this.y=0; this.angle=0; this.r=17; this.speed=60; this.weapon="Fist";
    this.dmg=6; this.hp=18; this.maxHp=18; this.strong=false; this.armed=false; this.ranged=false;
    this.hue="#e0563f"; this.attackAnim=0; this.flash=0; this.atkCd=0; this.wanderA=0; this.wanderT=1;
    this.strafeDir=1; this.strafeT=1; this.dead=false;
    this.guardPetId=""; this.ridingPetId=""; this.hasGuard=false;
  }
}
defineTypes(EnemyState, {
  x:"number", y:"number", angle:"number", r:"number", speed:"number", weapon:"string", dmg:"number", hp:"number", maxHp:"number",
  strong:"boolean", armed:"boolean", ranged:"boolean", hue:"string", attackAnim:"number", flash:"number", atkCd:"number",
  wanderA:"number", wanderT:"number", strafeDir:"number", strafeT:"number", dead:"boolean",
  guardPetId:"string", ridingPetId:"string", hasGuard:"boolean"
});

class WallState extends Schema {
  constructor() {
    super();
    this.x=0; this.y=0; this.r=20; this.ttl=-1; this.ownerId="";
    this.hp=72; this.maxHp=72; this.kind="wood"; this.spiked=false; this.spikeDmg=0; this.sourcePetId="";
  }
}
defineTypes(WallState, {
  x:"number", y:"number", r:"number", ttl:"number", ownerId:"string",
  hp:"number", maxHp:"number", kind:"string", spiked:"boolean", spikeDmg:"number", sourcePetId:"string"
});

class TowerState extends Schema {
  constructor() { super(); this.x=0; this.y=0; this.cd=0.5; this.ownerId=""; }
}
defineTypes(TowerState, { x:"number", y:"number", cd:"number", ownerId:"string" });

class ProjectileState extends Schema {
  constructor() {
    super(); this.x=0; this.y=0; this.vx=0; this.vy=0; this.life=1; this.r=5; this.hostile=false;
    this.kind="arrow"; this.color="#7ec0ee"; this.dmg=10; this.ownerId=""; this.petBlast=false; this.knock=0;
  }
}
defineTypes(ProjectileState, { x:"number", y:"number", vx:"number", vy:"number", life:"number", r:"number", hostile:"boolean", kind:"string", color:"string", dmg:"number", ownerId:"string", petBlast:"boolean", knock:"number" });

class WorldState extends Schema {
  constructor() {
    super();
    this.players=new MapSchema(); this.resources=new MapSchema(); this.gold=new MapSchema(); this.chests=new MapSchema();
    this.animals=new MapSchema(); this.pets=new MapSchema(); this.enemies=new MapSchema(); this.walls=new MapSchema();
    this.towers=new MapSchema(); this.projectiles=new MapSchema();
    this.dayPhase=0; this.phaseTimer=TIME_PHASES[0].duration; this.dayCount=1; this.wave=0; this.worldTime=0;
  }
}
defineTypes(WorldState, {
  players:{map:PlayerState}, resources:{map:ResourceState}, gold:{map:GoldState}, chests:{map:ChestState},
  animals:{map:AnimalState}, pets:{map:PetState}, enemies:{map:EnemyState}, walls:{map:WallState}, towers:{map:TowerState}, projectiles:{map:ProjectileState},
  dayPhase:"number", phaseTimer:"number", dayCount:"number", wave:"number", worldTime:"number"
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function randi(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function angTo(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); }
function angleDiff(a,b) { return Math.atan2(Math.sin(b-a), Math.cos(b-a)); }
function smoothTurn(obj, target, dt, speed=8) { obj.angle += clamp(angleDiff(obj.angle, target), -speed*dt, speed*dt); }
function facing(px,py,pa,tx,ty,max=0.95) { return Math.abs(angleDiff(pa, angTo(px,py,tx,ty))) < max; }
function segmentCircleT(x0,y0,x1,y1,cx,cy,r){
  const dx=x1-x0,dy=y1-y0,len2=dx*dx+dy*dy;
  let t=len2>1e-8?((cx-x0)*dx+(cy-y0)*dy)/len2:0;
  t=clamp(t,0,1);
  const qx=x0+dx*t,qy=y0+dy*t;
  return dist(qx,qy,cx,cy)<=r?t:null;
}
function animalProjectileSegmentT(a,x0,y0,x1,y1,radius=0){
  let best=null;
  for(const h of animalHitCircles(a)){
    const t=segmentCircleT(x0,y0,x1,y1,h.x,h.y,radius+h.r);
    if(t!=null&&(best==null||t<best))best=t;
  }
  return best;
}
function pick(list) { return list[Math.floor(Math.random()*list.length)]; }
function weighted(list) { const total=list.reduce((s,x)=>s+x.w,0); let n=rand(0,total); for(const x of list){ if((n-=x.w)<=0) return x.v; } return list[list.length-1].v; }
function shadeHex(hex, amt) {
  try { const n=parseInt(hex.replace("#",""),16); const r=clamp((n>>16)+amt,0,255), g=clamp(((n>>8)&255)+amt,0,255), b=clamp((n&255)+amt,0,255); return `#${((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}`; } catch { return hex; }
}

function animalRadius(type, stage) {
  const mul=(PET_TYPES[type]?.sizeMul)||1; let base=18;
  if(stage==="adult") base=36; else if(stage==="boss") base=52; else if(stage==="superboss") base=68; else if(stage==="bigmomma") base=92;
  let extra=1; if(["boss","superboss","bigmomma"].includes(stage)) extra=(type==="bear"||type==="saber")?1.28:(type==="wolf"||type==="boar")?1.18:1.1;
  return base*mul*extra;
}

function animalHitCircles(a) {
  const r=a?.r||18, ang=a?.angle||0, ca=Math.cos(ang), sa=Math.sin(ang);
  let parts;
  if(a.type==="dragon") parts=[[-.88,.40],[-.62,.56],[-.08,.72],[.55,.60],[1.00,.50],[1.34,.38],[1.55,.25]];
  else if(a.type==="snake") parts=[[-.98,.30],[-.75,.40],[-.25,.48],[.28,.46],[.72,.39],[1.02,.31],[1.24,.22]];
  else if(a.type==="bear") parts=[[-.68,.58],[-.42,.82],[.12,.90],[.68,.70],[1.00,.50],[1.30,.38],[1.48,.25]];
  else if(a.type==="boar"||a.type==="saber") parts=[[-.72,.52],[-.48,.72],[.05,.82],[.62,.66],[.98,.46],[1.30,.35],[1.50,.24]];
  else if(a.type==="deer") parts=[[-.72,.48],[-.48,.65],[.02,.73],[.58,.56],[.94,.40],[1.22,.31],[1.40,.22]];
  else if(a.type==="rabbit") parts=[[-.52,.42],[-.30,.61],[.22,.66],[.67,.48],[.96,.34],[1.18,.26],[1.32,.19]];
  else if(a.type==="owl") parts=[[-.42,.46],[-.20,.68],[.25,.70],[.62,.52],[.90,.38],[1.12,.28],[1.25,.20]];
  else if(a.type==="cat") parts=[[-.72,.46],[-.48,.65],[.05,.74],[.62,.58],[1.00,.41],[1.34,.34],[1.55,.23]];
  else if(a.type==="dog"||a.type==="fox"||a.type==="wolf") parts=[[-.76,.48],[-.50,.68],[.04,.77],[.62,.60],[1.02,.43],[1.36,.35],[1.58,.23]];
  else parts=[[-.64,.46],[-.40,.68],[.08,.76],[.58,.58],[.94,.40],[1.26,.32],[1.45,.22]];
  let sm=1;if(a.stage==="boss")sm=1.04;else if(a.stage==="superboss")sm=1.07;else if(a.stage==="bigmomma")sm=1.10;
  return parts.map(([f,rad],i)=>{
    const fromEnd=parts.length-1-i;
    const side=fromEnd===0?.12:fromEnd===1?.09:fromEnd===2?.05:0;
    return{
      x:a.x+ca*f*r-sa*side*r,
      y:a.y+sa*f*r+ca*side*r,
      r:Math.max(8,r*rad*sm)
    };
  });
}
function animalPhysicalCircles(a){
  // Full geometry is still used for attacks and weapon hits.
  // Movement collision includes the body + neck and excludes only the final
  // two face/snout circles, so the snout remains touchable without making the
  // whole front of the animal non-solid.
  const hits=animalHitCircles(a);
  return hits.length>2?hits.slice(0,hits.length-2):hits;
}

function animalMeleeTouch(a,px,py,range,angle,maxFacing=1.05){
  for(const h of animalHitCircles(a)){
    if(dist(px,py,h.x,h.y)<range+h.r&&facing(px,py,angle,h.x,h.y,maxFacing))return true;
  }
  return false;
}
function animalProjectileTouch(a,x,y,radius=0){
  for(const h of animalHitCircles(a))if(dist(x,y,h.x,h.y)<radius+h.r)return true;
  return false;
}
function animalFaceGeometry(a){
  const r=a?.r||18;
  let forward=1.14,radiusMul=.46;
  if(a.type==="bear"){forward=1.08;radiusMul=.49;}
  else if(a.type==="rabbit"){forward=1.12;radiusMul=.42;}
  else if(a.type==="cat"){forward=1.17;radiusMul=.43;}
  else if(a.type==="fox"){forward=1.20;radiusMul=.44;}
  else if(a.type==="wolf"||a.type==="dog"){forward=1.20;radiusMul=.44;}
  else if(a.type==="owl"){forward=1.05;radiusMul=.49;}
  else if(a.type==="deer"){forward=1.18;radiusMul=.40;}
  else if(a.type==="boar"||a.type==="saber"){forward=1.18;radiusMul=.45;}
  else if(a.type==="snake"){forward=1.26;radiusMul=.29;}
  else if(a.type==="dragon"){forward=1.22;radiusMul=.40;}

  const stageMul=a.stage==="baby"?1.04:a.stage==="boss"?1.05:a.stage==="superboss"?1.07:a.stage==="bigmomma"?1.09:1;
  const angle=a.angle||0,ca=Math.cos(angle),sa=Math.sin(angle),side=.10;
  return{
    x:a.x+ca*r*forward-sa*r*side,
    y:a.y+sa*r*forward+ca*r*side,
    r:Math.max(8,r*radiusMul*stageMul)
  };
}
function animalAttackContact(a,ref,target){
  if(!a||!target)return false;
  if(ref?.kind==="player"&&(target.dead||target.health<=0))return false;
  if(ref?.kind==="pet"&&(target.dead||target.hp<=0))return false;

  // Victim must actually be in front of the face.
  const toward=angTo(a.x,a.y,target.x,target.y);
  if(Math.abs(angleDiff(a.angle||0,toward))>1.20)return false;

  const h=animalFaceGeometry(a);
  // Bite contact is deliberately smaller than physical body collision.
  // Damage requires the visible face/head to genuinely reach the victim.
  const tr=ref?.kind==="player"?PLAYER_R*.72:Math.max(6,(target.r||16)*.70);
  return dist(h.x,h.y,target.x,target.y)<=h.r+tr+3;
}
function animalTargetOverlap(a,ref,target){
  if(!a||!target)return 0;
  const tr=ref?.kind==="player"?PLAYER_R:Math.max(8,(target.r||16)*.82);
  let deepest=0;
  for(const h of animalPhysicalCircles(a)){
    const d=dist(h.x,h.y,target.x,target.y);
    // +3 is only contact tolerance for network sampling. The target still moves
    // by the animal's exact delta; there is no knockback/extra force.
    deepest=Math.max(deepest,h.r+tr+3-d);
  }
  return Math.max(0,deepest);
}
function typeHp(type, stage) {
  const base=ANIMAL_STAGE_HP[stage]??ANIMAL_STAGE_HP.adult;
  const b=animalBalance(type);
  const babyMul=stage==="baby"?(b.babyHpMul||1):1;
  return Math.max(12,Math.round(base*b.hpMul*babyMul));
}
function typeDmg(type, stage) {
  return animalBalance(type).attack*(ANIMAL_STAGE_ATTACK[stage]??1);
}
function animalSpeed(type, stage, owned=false) {
  const base=PET_TYPES[type]?.baseSpeed||60; let m=1.08;
  if(stage==="adult")m=.95; else if(stage==="boss")m=.72; else if(stage==="superboss")m=.62; else if(stage==="bigmomma")m=.72;
  return base*m*(owned?1.55:1);
}
function petAtkDmg(p) {
  const m=p.stage==="baby"?.55:p.stage==="adult"?1:p.stage==="boss"?1.65:p.stage==="superboss"?2.25:2.6;
  const speciesMul=Math.max(.72,Math.min(1.55,animalBalance(p.type).attack/7.5));
  return (6+(p.r||15)*.15)*m*(1+(p.level||1)*.12)*speciesMul;
}
function expNeed(stage, level) { return stage==="baby"?40+level*8:stage==="adult"?70+level*12:stage==="boss"?160+level*26:stage==="superboss"?420+level*45:9999; }

export class WorldRoom extends Room {
  maxClients=12;

  onCreate() {
    this.setState(new WorldState());
    this.nextResourceId=1; this.nextGoldId=1; this.nextChestId=1; this.nextAnimalId=1; this.nextPetId=1;
    this.nextEnemyId=1; this.nextWallId=1; this.nextTowerId=1; this.nextProjectileId=1;
    this.resourceRespawns=new Map(); this.harvestCredits=new Map(); this.goldHandCredits=new Map();
    this.playerAttackCd=new Map(); this.playerShootCd=new Map(); this.enemyAggro=new Map(); this.animalAggro=new Map();
    this.playerCarryUntil=new Map(); this.playerCarryAnimal=new Map();
    this.wallSpikeNext=new Map(); this.wallEnemyNext=new Map();
    this.enemyPetByEnemy=new Map(); this.enemyOwnerByPet=new Map(); this.ownerThreat=new Map();
    this.fxQueue=[]; this.fxFlushAccum=0; this.pendingPlayerHits=new Map(); this.hitFlushAccum=0;
    this.pendingAnimalPushes=new Map(); this.pushFlushAccum=0;
    this.petDeathTimers=new Map(); this.solidGrid=new Map(); this.dynamicGrid=new Map(); this.chestRewards=new Map(); this.chatLastSent=new Map(); this.waveTimer=4;
    this.generateWorld();
    this.rebuildDynamicGrid();

    // Keep combat/physics at 20 TPS, but send state patches at 10 Hz. The client
    // interpolates moving entities, cutting multiplayer bandwidth substantially.
    if (typeof this.setPatchRate === "function") this.setPatchRate(100);
    else this.patchRate = 100;
    this.setSimulationInterval((delta)=>this.update(delta/1000),1000/20);

    this.onMessage("input",(client,input={})=>this.handleInput(client,input));
    this.onMessage("resourceHit",(client,data={})=>this.handleResourceHit(client,data));
    this.onMessage("goldHit",(client,data={})=>this.handleGoldHit(client,data));
    this.onMessage("attack",(client,data={})=>this.handleAttack(client,data));
    this.onMessage("shoot",(client,data={})=>this.handleShoot(client,data));
    this.onMessage("tame",(client,data={})=>this.handleTame(client,data));
    this.onMessage("build",(client,data={})=>this.handleBuild(client,data));
    this.onMessage("heal",(client,data={})=>this.handleHeal(client,data));
    this.onMessage("respawn",(client)=>this.handleRespawn(client));
    this.onMessage("petOrder",(client,data={})=>this.handlePetOrder(client,data));
    this.onMessage("petAbility",(client,data={})=>this.handlePetAbility(client,data));
    this.onMessage("petRelease",(client,data={})=>this.handlePetRelease(client,data));
    this.onMessage("petRename",(client,data={})=>this.handlePetRename(client,data));
    this.onMessage("ensureStarterPet",(client,data={})=>this.handleEnsureStarterPet(client,data));
    this.onMessage("chat",(client,data={})=>this.handleChat(client,data));
  }


  handleChat(client,data={}) {
    const player=this.state.players.get(client.sessionId);
    if(!player)return;

    const now=Date.now();
    const last=this.chatLastSent.get(client.sessionId)||0;
    if(now-last<CHAT_COOLDOWN_MS)return;

    const message=cleanChatText(data?.message ?? data?.text ?? "");
    if(!message || chatHasLink(message) || chatHasBlockedWord(message))return;

    this.chatLastSent.set(client.sessionId,now);
    const payload={username:safeChatUsername(player.username),message};

    // The sender already renders its own message instantly in Game 366.
    // Broadcast to everyone else so it does not appear twice for the sender.
    this.broadcast("chat",payload,{except:client});
  }

  gridKey(cx,cy){return `${cx},${cy}`;}
  addSolid(x,y,r,kind="static",id="") {
    const key=this.gridKey(Math.floor(x/GRID_CELL),Math.floor(y/GRID_CELL));
    let b=this.solidGrid.get(key); if(!b){b=[];this.solidGrid.set(key,b);} b.push({x,y,r,kind,id});
  }
  nearbySolids(x,y,range) {
    const out=[]; const a=Math.floor((x-range)/GRID_CELL),b=Math.floor((x+range)/GRID_CELL),c=Math.floor((y-range)/GRID_CELL),d=Math.floor((y+range)/GRID_CELL);
    for(let cy=c;cy<=d;cy++)for(let cx=a;cx<=b;cx++){const bucket=this.solidGrid.get(this.gridKey(cx,cy));if(bucket)out.push(...bucket);} return out;
  }
  addDynamic(kind,id,obj){
    if(!obj)return;
    const key=this.gridKey(Math.floor(obj.x/GRID_CELL),Math.floor(obj.y/GRID_CELL));
    let b=this.dynamicGrid.get(key);if(!b){b=[];this.dynamicGrid.set(key,b);}b.push({kind,id,obj});
  }
  rebuildDynamicGrid(){
    this.dynamicGrid.clear();
    for(const[id,a]of this.state.animals)if(a&&a.hp>0)this.addDynamic("animal",id,a);
    for(const[id,p]of this.state.pets)if(p&&!p.dead&&p.hp>0)this.addDynamic("pet",id,p);
    for(const[id,en]of this.state.enemies)if(en&&!en.dead&&en.hp>0)this.addDynamic("enemy",id,en);
  }
  nearbyDynamic(x,y,range,kinds=null){
    const out=[];const minX=Math.floor((x-range)/GRID_CELL),maxX=Math.floor((x+range)/GRID_CELL),minY=Math.floor((y-range)/GRID_CELL),maxY=Math.floor((y+range)/GRID_CELL);
    for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++){
      const bucket=this.dynamicGrid.get(this.gridKey(cx,cy));if(!bucket)continue;
      for(const rec of bucket){if(!kinds||kinds.has(rec.kind))out.push(rec);}
    }
    return out;
  }
  canPlace(x,y,r,minCenter=0) {
    if(x<120+r||x>WORLD_W-120-r||y<120+r||y>WORLD_H-120-r)return false;
    if(minCenter&&dist(x,y,WORLD_W/2,WORLD_H/2)<minCenter)return false;
    for(const s of this.nearbySolids(x,y,r+150)) if(dist(x,y,s.x,s.y)<r+s.r+6) return false;
    return true;
  }
  resolveStatic(obj,radius) {
    for(const s of this.nearbySolids(obj.x,obj.y,radius+100)) {
      if(s.kind==="resource") { const r=this.state.resources.get(s.id); if(r && !r.alive) continue; }
      if(s.kind==="gold") { const g=this.state.gold.get(s.id); if(g&&!g.infinite&&g.goldLeft<=0) continue; }
      if(s.kind==="chest") { const c=this.state.chests.get(s.id); if(c?.opened) continue; }
      const d=dist(obj.x,obj.y,s.x,s.y), min=radius+s.r;
      if(d<min){const a=d>.01?angTo(s.x,s.y,obj.x,obj.y):(obj.angle||0);obj.x=s.x+Math.cos(a)*min;obj.y=s.y+Math.sin(a)*min;}
    }
    for(const [,w] of this.state.walls){const d=dist(obj.x,obj.y,w.x,w.y),min=radius+w.r;if(d<min){const a=d>.01?angTo(w.x,w.y,obj.x,obj.y):(obj.angle||0);obj.x=w.x+Math.cos(a)*min;obj.y=w.y+Math.sin(a)*min;}}
    obj.x=clamp(obj.x,20,WORLD_W-20); obj.y=clamp(obj.y,20,WORLD_H-20);
  }

  spawnClearOfCreatures(x,y) {
    for(const [,a] of this.state.animals){
      if(!a||a.hp<=0)continue;
      const extra=a.stage==="bigmomma"?460:a.stage==="superboss"?380:a.stage==="boss"?330:a.stage==="adult"?180:140;
      if(dist(x,y,a.x,a.y)<PLAYER_R+(a.r||18)+extra)return false;
    }
    for(const [,en] of this.state.enemies){
      if(!en||en.dead||en.hp<=0)continue;
      if(dist(x,y,en.x,en.y)<PLAYER_R+(en.r||18)+320)return false;
    }
    for(const [,pet] of this.state.pets){
      if(!pet||pet.dead)continue;
      if(dist(x,y,pet.x,pet.y)<PLAYER_R+(pet.r||16)+90)return false;
    }
    for(const [,p] of this.state.players){
      if(!p||p.dead)continue;
      if(dist(x,y,p.x,p.y)<PLAYER_R*2+90)return false;
    }
    for(const [,w] of this.state.walls){if(dist(x,y,w.x,w.y)<PLAYER_R+w.r+35)return false;}
    return true;
  }

  isSafePlayerSpawn(x,y) {
    if(dist(x,y,WORLD_W/2,WORLD_H/2)<700)return false;
    if(!this.canPlace(x,y,PLAYER_R+55,0))return false;
    return this.spawnClearOfCreatures(x,y);
  }

  safeSpawn(avoidX=null,avoidY=null,minDistance=0) {
    // Random attempts first, then a deterministic grid fallback. Never return an
    // unchecked random point: a joining/respawning player cannot appear in a boss.
    const hasAvoid=Number.isFinite(avoidX)&&Number.isFinite(avoidY)&&minDistance>0;
    for(let i=0;i<520;i++){
      const x=rand(650,WORLD_W-650),y=rand(650,WORLD_H-650);
      if(hasAvoid&&dist(x,y,avoidX,avoidY)<minDistance)continue;
      if(this.isSafePlayerSpawn(x,y))return{x,y};
    }
    for(let y=700;y<WORLD_H-700;y+=420){
      for(let x=700;x<WORLD_W-700;x+=420){
        if(hasAvoid&&dist(x,y,avoidX,avoidY)<minDistance*.75)continue;
        if(this.isSafePlayerSpawn(x,y))return{x,y};
      }
    }
    // The world is far too large for this to normally run. Keep the final point
    // static-safe and relocate nearby creatures before use as a last-resort guard.
    let x=900,y=900;
    if(hasAvoid&&dist(x,y,avoidX,avoidY)<minDistance*.6){x=WORLD_W-900;y=WORLD_H-900;}
    for(const [id,a] of this.state.animals){
      if(a&&dist(x,y,a.x,a.y)<650){a.x=clamp(a.x+900,40,WORLD_W-40);a.y=clamp(a.y+900,40,WORLD_H-40);}
    }
    for(const [id,en] of this.state.enemies){
      if(en&&dist(x,y,en.x,en.y)<650){en.x=clamp(en.x+900,40,WORLD_W-40);en.y=clamp(en.y+900,40,WORLD_H-40);}
    }
    return{x,y};
  }

  safePetSpawnNear(x,y,r=18) {
    const radii=[58,76,96,118];
    for(const rr of radii){
      for(let i=0;i<12;i++){
        const a=(i/12)*TAU;
        const px=clamp(x+Math.cos(a)*rr,40,WORLD_W-40),py=clamp(y+Math.sin(a)*rr,40,WORLD_H-40);
        if(!this.canPlace(px,py,r+8,0))continue;
        let blocked=false;
        for(const [,wild] of this.state.animals){if(wild&&wild.hp>0&&dist(px,py,wild.x,wild.y)<r+(wild.r||18)+35){blocked=true;break;}}
        if(!blocked)return{x:px,y:py};
      }
    }
    return{x:clamp(x+70,40,WORLD_W-40),y};
  }

  addResource(type,x,y,hp,solidR,canopyR,scale,rot){const r=new ResourceState();Object.assign(r,{type,x,y,hp,maxHp:hp,alive:true,solidR,canopyR,scale,rot});const id=`r${this.nextResourceId++}`;this.state.resources.set(id,r);this.addSolid(x,y,type==="log"?solidR*1.35:solidR,"resource",id);}
  addGold(x,y,size,r,goldLeft,infinite=false,pure=false){const g=new GoldState();Object.assign(g,{x,y,size,r,goldLeft:infinite?999999999:goldLeft,infinite,pure});const id=`g${this.nextGoldId++}`;this.state.gold.set(id,g);this.addSolid(x,y+(pure?r*.06:r*.03),r*(pure?.78:size==="huge"?.75:.72),"gold",id);}
  addChest(x,y){const c=new ChestState();Object.assign(c,{x,y,r:18,hp:4,maxHp:4,opened:false,pulse:0,shine:rand(0,TAU),chipSide:Math.random()<.5?"wood":"stone"});const id=`c${this.nextChestId++}`;this.state.chests.set(id,c);this.chestRewards.set(id,this.makeChestReward());this.addSolid(x,y+8,18,"chest",id);}
  addAnimal(type,stage,x,y,opts={}) {
    const a=new AnimalState(); const info=PET_TYPES[type]; const r=animalRadius(type,stage),hp=typeHp(type,stage); const coat=pick(info.coats||[info.color]);
    const hasSpots=(type==="dog"&&Math.random()<.55)||(type==="cat"&&Math.random()<.35)||(type==="rabbit"&&Math.random()<.25);
    const spots=hasSpots?Array.from({length:randi(3,7)},()=>({x:rand(-.5,.5),y:rand(-.4,.4),s:rand(.12,.22)})):[];
    const sleeping=opts.sleeping??(stage==="bigmomma"?Math.random()<.96:stage==="superboss"?Math.random()<.88:stage==="boss"?Math.random()<.75:stage==="baby"?Math.random()<.65:false);
    Object.assign(a,{type,stage,x,y,angle:rand(0,TAU),r,hp,maxHp:hp,coat,spotCol:shadeHex(coat,Math.random()<.5?-35:30),spotsJson:JSON.stringify(spots),speed:animalSpeed(type,stage,false),sleeping,tailPhase:rand(0,TAU),abilityCd:rand(3,info.abilityCd),wanderT:rand(1,3),wanderA:rand(0,TAU),releasedWild:!!opts.releasedWild,level:opts.level||1,exp:opts.exp||0,petName:opts.petName||""});
    if(opts.hp!=null)a.hp=clamp(opts.hp,1,a.maxHp); if(opts.enraged)a.enraged=true; if(opts.tameFailedAggro)a.tameFailedAggro=true; if(opts.desperateAggro)a.desperateAggro=true;
    const id=`a${this.nextAnimalId++}`;this.state.animals.set(id,a);return id;
  }
  addPet(ownerId,type,stage,x,y,opts={}) {
    const info=PET_TYPES[type];if(!info)return null; const p=new PetState(); const r=animalRadius(type,stage),hp=typeHp(type,stage);const coat=opts.coat||pick(info.coats||[info.color]);
    Object.assign(p,{ownerId,type,stage,x,y,angle:opts.angle||0,r,hp:opts.hp??hp,maxHp:hp,coat,spotCol:opts.spotCol||shadeHex(coat,-30),spotsJson:opts.spotsJson||"[]",speed:animalSpeed(type,stage,true),sleeping:false,tailPhase:rand(0,TAU),abilityCd:0,atkCd:0,combat:0,level:opts.level||1,exp:opts.exp||0,petName:String(opts.petName||type).slice(0,14),orderMode:"follow",targetX:-1,targetY:-1,dead:false});
    const id=`p${this.nextPetId++}`;this.state.pets.set(id,p);return id;
  }
  enemySpawnPoint(anchor=null) {
    // Most night enemies are spread around the actual land instead of orbiting players.
    // Some still spawn near players so night-time encounters do not become empty.
    const scatter=!anchor&&Math.random()<.64;
    if(scatter){
      for(let tries=0;tries<36;tries++){
        const x=rand(100,WORLD_W-100),y=rand(100,WORLD_H-100);
        if(!this.canPlace(x,y,24,260))continue;
        let blocked=false;
        for(const[,pl]of this.state.players){if(!pl.dead&&dist(x,y,pl.x,pl.y)<280){blocked=true;break;}}
        if(blocked)continue;
        for(const[,a]of this.state.animals){if(a.hp>0&&dist(x,y,a.x,a.y)<(a.r||18)+52){blocked=true;break;}}
        if(!blocked)return{x,y};
      }
    }
    const base=anchor||this.randomPlayerPosition();
    for(let tries=0;tries<28;tries++){
      const ang=rand(0,TAU),d=rand(620,1100);
      const x=clamp(base.x+Math.cos(ang)*d,60,WORLD_W-60),y=clamp(base.y+Math.sin(ang)*d,60,WORLD_H-60);
      if(this.canPlace(x,y,24,220))return{x,y};
    }
    return{x:clamp(base.x+720,60,WORLD_W-60),y:clamp(base.y,60,WORLD_H-60)};
  }

  spawnEnemyGuardPet(enemyId,en,strong=false,rider=false){
    if(!enemyId||!en||this.enemyPetByEnemy.has(enemyId))return null;
    const type=pick(rider?(strong?["wolf","boar","bear","saber"]:["wolf","boar","dog","saber"]):(strong?["wolf","dog","boar","fox","bear"]:["dog","fox","wolf","cat","boar"]));
    const stage=rider?(strong&&Math.random()<.30?"boss":"adult"):(strong&&Math.random()<.24?"boss":"adult");
    const rr=animalRadius(type,stage);
    const pos=rider?{x:en.x,y:en.y}:this.safePetSpawnNear(en.x,en.y,rr);
    const aid=this.addAnimal(type,stage,pos.x,pos.y,{sleeping:false,enraged:true,petName:`Raider ${PET_TYPES[type]?.name||type}`});
    const a=this.state.animals.get(aid);
    if(a){a.sleeping=false;a.enraged=true;a.combat=9999;a.wanderT=rand(.5,1.5);}
    this.enemyPetByEnemy.set(enemyId,aid);
    this.enemyOwnerByPet.set(aid,enemyId);
    en.guardPetId=aid; en.hasGuard=true; en.ridingPetId=rider?aid:"";
    return aid;
  }

  detachEnemyGuard(enemyId,attackerId="",remove=false){
    const en=this.state.enemies.get(enemyId);
    if(en){en.guardPetId="";en.ridingPetId="";en.hasGuard=false;}
    const aid=this.enemyPetByEnemy.get(enemyId);
    if(!aid)return;
    this.enemyPetByEnemy.delete(enemyId);
    this.enemyOwnerByPet.delete(aid);
    const a=this.state.animals.get(aid);
    if(!a)return;
    if(remove){this.state.animals.delete(aid);this.animalAggro.delete(aid);return;}
    a.enraged=true;a.sleeping=false;a.combat=10;a.tameFailedAggro=true;
    if(attackerId)this.animalAggro.set(aid,{kind:"player",id:attackerId});
  }

  addEnemy(strong=false,anchor=null) {
    if(this.state.enemies.size>=70)return null;
    const en=new EnemyState();
    const pos=this.enemySpawnPoint(anchor),x=pos.x,y=pos.y;
    const roll=Math.random();let weapon="Fist";if(strong){weapon=roll<.38?"Bow":roll<.68?"Staff":"Sword";}else{weapon=roll<.18?"Bow":roll<.28?"Staff":roll<.57?"Sword":"Fist";}
    let ranged=weapon==="Bow"||weapon==="Staff",armed=weapon!=="Fist";const speedBase=strong?rand(54,96):rand(48,92);let speed=speedBase*(weapon==="Staff"?.94:weapon==="Bow"?.98:weapon==="Sword"?1.03:1);
    let dmg=weapon==="Bow"?(strong?rand(11,16):rand(8,12)):weapon==="Staff"?(strong?rand(13,18):rand(9,13)):weapon==="Sword"?(strong?rand(14,20):rand(9,14)):(strong?rand(8,12):rand(4,8));
    const hpBase=weapon==="Bow"?(strong?40:24):weapon==="Staff"?(strong?48:28):weapon==="Sword"?(strong?44:28):(strong?34:18);let hp=hpBase+this.state.wave*(strong?3.9:3.2);
    let hue=strong?(weapon==="Bow"?"#4b5dcf":weapon==="Staff"?"#6b1a8f":"#6b1a4a"):(weapon==="Bow"?"#3f76b5":weapon==="Staff"?"#7c47a8":weapon==="Sword"?"#8f2e6b":"#e0563f");
    const hasGuard=Math.random()<(strong?.26:.30);
    const rider=hasGuard&&Math.random()<(strong?.36:.28);
    if(hasGuard){hp*=.64;dmg*=.72;hue=strong?"#5d596d":"#786060";}
    if(rider){hp*=.58;dmg*=.48;weapon="Fist";ranged=false;armed=false;speed*=.82;hue=strong?"#434858":"#595451";}
    Object.assign(en,{x,y,angle:0,r:strong?20:17,speed,weapon,dmg,hp,maxHp:hp,strong,armed,ranged,hue,atkCd:rand(.15,.9),wanderA:rand(0,TAU),wanderT:rand(.6,2),strafeDir:Math.random()<.5?-1:1,strafeT:rand(.6,1.5),hasGuard,guardPetId:"",ridingPetId:""});
    const id=`e${this.nextEnemyId++}`;this.state.enemies.set(id,en);
    if(hasGuard)this.spawnEnemyGuardPet(id,en,strong,rider);
    return id;
  }
  addWall(x,y,r=20,ttl=-1,ownerId="",opts={}){const w=new WallState();const hp=Math.max(1,Number(opts.hp)||72);Object.assign(w,{x,y,r,ttl,ownerId,hp,maxHp:Math.max(hp,Number(opts.maxHp)||hp),kind:String(opts.kind||"wood"),spiked:!!opts.spiked,spikeDmg:Math.max(0,Number(opts.spikeDmg)||0),sourcePetId:String(opts.sourcePetId||"")});const id=`w${this.nextWallId++}`;this.state.walls.set(id,w);return id;}
  addTower(x,y,ownerId=""){const t=new TowerState();Object.assign(t,{x,y,cd:.5,ownerId});const id=`t${this.nextTowerId++}`;this.state.towers.set(id,t);return id;}
  addProjectile(data){const p=new ProjectileState();Object.assign(p,data);const id=`q${this.nextProjectileId++}`;this.state.projectiles.set(id,p);return id;}

  scatter(type,count,hp,minCenter){for(let i=0;i<count;i++){for(let tries=0;tries<90;tries++){let scale=1,solid=12,canopy=0;if(type==="tree"){scale=rand(1.2,2.3);solid=8.8*scale;canopy=46*scale;}else if(type==="rock"){scale=rand(1,2.1);solid=26.5*scale;}else if(type==="log"){scale=rand(1,1.6);solid=17.5*scale;}else if(type==="bush"){scale=rand(1.08,1.7);solid=10.8*scale;canopy=24*scale;}const x=rand(120,WORLD_W-120),y=rand(120,WORLD_H-120);if(!this.canPlace(x,y,solid,minCenter))continue;this.addResource(type,x,y,hp,solid,canopy,scale,type==="log"?rand(0,TAU):0);break;}}}
  generateWorld(){
    this.addGold(WORLD_W/2,WORLD_H/2,"pure",176,999999999,true,true);
    this.scatter("tree",980,9,240);this.scatter("rock",680,4,240);this.scatter("log",420,2.4,180);this.scatter("bush",560,8,180);
    for(let i=0;i<14;i++)for(let t=0;t<80;t++){const x=rand(400,WORLD_W-400),y=rand(400,WORLD_H-400);if(this.canPlace(x,y,48,500)){this.addGold(x,y,"huge",48,40);break;}}
    for(let i=0;i<120;i++)for(let t=0;t<70;t++){const x=rand(120,WORLD_W-120),y=rand(120,WORLD_H-120);if(this.canPlace(x,y,16)){this.addGold(x,y,"small",16,6);break;}}
    for(let i=0;i<72;i++)for(let t=0;t<80;t++){const x=rand(130,WORLD_W-130),y=rand(130,WORLD_H-130);if(dist(x,y,WORLD_W/2,WORLD_H/2)<280||!this.canPlace(x,y,20))continue;this.addChest(x,y);break;}
    const spawnWild=(forced=null)=>{for(let t=0;t<30;t++){const x=rand(120,WORLD_W-120),y=rand(120,WORLD_H-120);if(!this.canPlace(x,y,20,0))continue;let stage=forced;if(!stage){const r=Math.random();stage=r<.46?"baby":r<.84?"adult":r<.95?"boss":"superboss";}this.addAnimal(pick(WILD_SPECIES),stage,x,y);return;}};
    for(let i=0;i<330;i++)spawnWild();for(let i=0;i<14;i++)spawnWild("superboss");for(let i=0;i<5;i++)spawnWild("bigmomma");
    console.log(`Full world generated: ${this.state.resources.size} resources, ${this.state.gold.size} gold, ${this.state.chests.size} chests, ${this.state.animals.size} wildlife`);
  }

  randomPlayerPosition(){const vals=Array.from(this.state.players.values()).filter(p=>!p.dead);return vals.length?pick(vals):{x:WORLD_W/2,y:WORLD_H/2};}
  validTool(name){return TOOL[name]?name:"Fist";}
  playerCanReach(client,x,y,extra=0){const p=this.state.players.get(client.sessionId);return !!p&&!p.dead&&dist(p.x,p.y,x,y)<=105+extra;}
  clientById(id){return this.clients.find(c=>c.sessionId===id)||null;}
  sendReward(ownerId,reward,source={}){const c=this.clientById(ownerId);if(c)c.send("worldReward",{...reward,...source});}
  broadcastFx(data){
    if(!data)return;
    // Queue effects instead of broadcasting one message per hit. They are also
    // distance-filtered per client during flush so fights across the map cost nothing.
    if(this.fxQueue.length<128)this.fxQueue.push(data);
  }
  queuePlayerHit(playerId,data){
    if(!playerId||!data)return;
    const prev=this.pendingPlayerHits.get(playerId);
    if(prev){
      prev.dmg=(prev.dmg||0)+(data.dmg||0);
      prev.health=data.health;prev.maxHealth=data.maxHealth;prev.dead=data.dead;prev.attackerKind=data.attackerKind;prev.attackerId=data.attackerId;
    }else this.pendingPlayerHits.set(playerId,{...data});
  }
  queueAnimalPush(playerId,data){
    if(!playerId||!data)return;
    const prev=this.pendingAnimalPushes.get(playerId);
    if(prev){
      prev.dx=(prev.dx||0)+(data.dx||0);prev.dy=(prev.dy||0)+(data.dy||0);
      prev.x=data.x;prev.y=data.y;prev.animalId=data.animalId||prev.animalId;
    }else this.pendingAnimalPushes.set(playerId,{...data});
  }
  flushNetworkEvents(dt){
    this.fxFlushAccum+=dt;this.hitFlushAccum+=dt;this.pushFlushAccum+=dt;
    if(this.fxFlushAccum>=.08){
      this.fxFlushAccum%=.08;
      if(this.fxQueue.length){
        const batch=this.fxQueue.splice(0,48);
        for(const c of this.clients){
          const p=this.state.players.get(c.sessionId);if(!p)continue;
          const local=[];
          for(const fx of batch){
            const x=Number(fx?.x),y=Number(fx?.y);
            if(!Number.isFinite(x)||!Number.isFinite(y)||((x-p.x)*(x-p.x)+(y-p.y)*(y-p.y)<=1250*1250)){
              local.push(fx);if(local.length>=28)break;
            }
          }
          if(local.length)c.send("worldFxBatch",local);
        }
        if(this.fxQueue.length>128)this.fxQueue.splice(0,this.fxQueue.length-128);
      }
    }
    if(this.hitFlushAccum>=.08){
      this.hitFlushAccum%=.08;
      for(const[playerId,data]of this.pendingPlayerHits){const c=this.clientById(playerId);if(c)c.send("playerHit",data);}
      this.pendingPlayerHits.clear();
    }
    if(this.pushFlushAccum>=.05){
      this.pushFlushAccum%=.05;
      for(const[playerId,data]of this.pendingAnimalPushes){const c=this.clientById(playerId);if(c)c.send("animalPush",data);}
      this.pendingAnimalPushes.clear();
    }
  }

  handleInput(client,input){
    const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;
    if(Number.isFinite(+input.moveX))p.moveX=clamp(+input.moveX,-1,1);
    if(Number.isFinite(+input.moveY))p.moveY=clamp(+input.moveY,-1,1);
    p.moving=typeof input.moving==="boolean"?input.moving:Math.hypot(p.moveX,p.moveY)>.05;
    if(Number.isFinite(+input.angle))p.angle=+input.angle;
    if(typeof input.color==="string"&&input.color.length<32)p.color=input.color;
    if(typeof input.tool==="string"&&input.tool.length<24)p.tool=this.validTool(input.tool);
    if(typeof input.ridingPetId==="string")p.ridingPetId=input.ridingPetId.slice(0,32);

    // Escape input wins immediately over a stale carry window. This is the key
    // anti-hook rule: pressing away from the animal can never be ignored for a frame.
    const carriedById=this.playerCarryAnimal.get(client.sessionId)||"";
    const carriedAnimal=carriedById?this.state.animals.get(carriedById):null;
    if(carriedAnimal&&this.playerEscapingAnimal(p,carriedAnimal)){
      p.animalCarryT=0;this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);
    }

    const carryUntil=this.playerCarryUntil.get(client.sessionId)||0;
    const carried=p.animalCarryT>0||this.state.worldTime<carryUntil;
    if(!carried&&Number.isFinite(+input.x)&&Number.isFinite(+input.y)){
      let tx=clamp(+input.x,PLAYER_R,WORLD_W-PLAYER_R),ty=clamp(+input.y,PLAYER_R,WORLD_H-PLAYER_R);
      // Bound correction distance so lag spikes cannot tunnel a player straight
      // through a creature or wall in a single network packet.
      let dx=tx-p.x,dy=ty-p.y;const len=Math.hypot(dx,dy),maxStep=p.ridingPetId?52:34;
      if(len>maxStep){dx=dx/len*maxStep;dy=dy/len*maxStep;tx=p.x+dx;ty=p.y+dy;}
      p.x=tx;p.y=ty;this.resolveStatic(p,PLAYER_R*.82);
    }
  }
  handleHeal(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const amount=clamp(+data.amount||0,0,40);p.health=clamp(p.health+amount,0,p.maxHealth);}
  handleRespawn(client,data={}){const p=this.state.players.get(client.sessionId);if(!p)return;const oldX=p.x,oldY=p.y;const requested=Math.max(0,Math.min(3200,Number(data?.minDistance)||2400));const s=this.safeSpawn(oldX,oldY,requested);p.x=s.x;p.y=s.y;p.angle=rand(-Math.PI,Math.PI);p.health=p.maxHealth;p.dead=false;p.ridingPetId="";p.animalCarryT=0;this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);let i=0;for(const[id,pet]of this.state.pets){if(!pet||pet.ownerId!==client.sessionId)continue;const pos=this.safePetSpawnNear(p.x,p.y,pet.r||18);pet.x=pos.x;pet.y=pos.y;pet.angle=p.angle;pet.targetX=0;pet.targetY=0;pet.follow=true;pet.orderMode="follow";if(pet.dead){pet.dead=false;pet.hp=pet.maxHp;this.petDeathTimers.delete(id);}i++;}client.send("respawned",{x:p.x,y:p.y,movedFrom:{x:oldX,y:oldY}});}

  ensureStarterPetFor(client,type,stage){
    if(!client||!PET_TYPES[type])return null;
    const validStage=["baby","adult","boss","superboss"].includes(stage)?stage:"baby";
    for(const [id,p] of this.state.pets){
      if(p&&p.ownerId===client.sessionId&&!p.dead){client.send("starterPetEnsured",{id,type:p.type,existing:true});return id;}
    }
    const owner=this.state.players.get(client.sessionId);if(!owner)return null;
    const rr=animalRadius(type,validStage),pos=this.safePetSpawnNear(owner.x,owner.y,rr);
    const id=this.addPet(client.sessionId,type,validStage,pos.x,pos.y,{petName:PET_TYPES[type].name||type});
    if(id)client.send("starterPetEnsured",{id,type,stage:validStage,existing:false});
    return id;
  }

  handleEnsureStarterPet(client,data={}){
    const type=String(data.type||"");
    const stage=String(data.stage||"baby");
    this.ensureStarterPetFor(client,type,stage);
  }

  handleResourceHit(client,data){const id=String(data.id||""),r=this.state.resources.get(id);if(!r||!r.alive||!this.playerCanReach(client,r.x,r.y,Math.min(80,r.solidR)))return;const toolName=this.validTool(String(data.tool||"Fist")),t=TOOL[toolName];if(r.type==="bush"){r.hp=Math.max(0,r.hp-Math.max(.5,t.gather*.9));client.send("resourceReward",{id,kind:"berries",amount:randi(1,2)});}else{const isWood=r.type==="tree"||r.type==="log",correctAxe=toolName==="Axe"&&isWood,correctPick=toolName==="Pickaxe"&&r.type==="rock";let damage=t.resourcePower;if(r.type==="log")damage*=1.35;if(toolName==="Fist")damage*=r.type==="log"?1.25:.82;if(toolName==="Axe"&&!correctAxe)damage*=.32;if(toolName==="Pickaxe"&&!correctPick)damage*=.32;r.hp=Math.max(0,r.hp-damage);let y=1;if(r.type==="log")y=toolName==="Fist"?2:correctAxe?6:toolName==="Sword"?1:2;else if(correctAxe||correctPick)y=t.gather;else if(toolName==="Fist")y=t.gather;else if(toolName==="Sword")y=.12;else if(toolName==="Bow")y=.35;else y=.45;const key=`${client.sessionId}:${id}`,credit=(this.harvestCredits.get(key)||0)+y,whole=Math.floor(credit+1e-6);this.harvestCredits.set(key,credit-whole);if(whole>0)client.send("resourceReward",{id,kind:isWood?"wood":"stone",amount:whole});else if(toolName==="Sword")client.send("resourceReward",{id,kind:isWood?"wood":"stone",amount:0,tiny:true});}if(r.hp<=0){r.hp=0;r.alive=false;this.resourceRespawns.set(id,rand(12,22));}}
  handleGoldHit(client,data){const id=String(data.id||""),g=this.state.gold.get(id);if(!g||(!g.infinite&&g.goldLeft<=0)||!this.playerCanReach(client,g.x,g.y,Math.min(150,g.r)))return;const tool=this.validTool(String(data.tool||"Fist"));let take=0,tiny=false;if(tool==="Fist"){const key=`${client.sessionId}:${id}`;let c=(this.goldHandCredits.get(key)||0)+.12;if(c>=1){take=1;c-=1;}else tiny=true;this.goldHandCredits.set(key,c);}else take=g.pure?3:g.size==="huge"?randi(2,4):1;if(!g.infinite)take=Math.min(take,Math.max(0,g.goldLeft));if(take>0){if(!g.infinite)g.goldLeft=Math.max(0,g.goldLeft-take);client.send("resourceReward",{id,kind:"gold",amount:take,pure:!!g.pure});}else client.send("resourceReward",{id,kind:"gold",amount:0,tiny});}

  hitWild(id,a,dmg,attackerId,crit=false){
    if(!a||a.hp<=0)return;
    dmg=animalDamageTaken(a.type,a.stage,dmg);a.hp=Math.max(0,a.hp-dmg);a.flash=.12;a.recentHit=4.2;a.sleeping=false;a.enraged=true;a.combat=8;
    const guardOwner=this.enemyOwnerByPet.get(id);
    if(guardOwner){a.fleeUntil=0;a.tameFailedAggro=true;this.animalAggro.set(id,{kind:"player",id:attackerId});}
    else{const info=PET_TYPES[a.type],fleeFirst=a.stage==="baby"||((!!info?.flee)&&a.type!=="fox"),low=fleeFirst&&a.hp>0&&a.hp/a.maxHp<=.32;if(low){a.desperateAggro=true;a.fleeUntil=0;this.animalAggro.set(id,{kind:"player",id:attackerId});}else if(fleeFirst&&!a.tameFailedAggro){a.fleeUntil=this.state.worldTime+4;this.animalAggro.delete(id);const p=this.state.players.get(attackerId);if(p)a.wanderA=angTo(p.x,p.y,a.x,a.y);}else{a.fleeUntil=0;this.animalAggro.set(id,{kind:"player",id:attackerId});}}
    this.broadcastFx({kind:"hit",x:a.x,y:a.y,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});
    if(a.hp<=0){if(guardOwner){this.enemyOwnerByPet.delete(id);if(this.enemyPetByEnemy.get(guardOwner)===id)this.enemyPetByEnemy.delete(guardOwner);const owner=this.state.enemies.get(guardOwner);if(owner){owner.guardPetId="";owner.ridingPetId="";owner.hasGuard=false;}}this.state.animals.delete(id);this.animalAggro.delete(id);this.rewardKill(attackerId,"animal",a.x,a.y,a.type);}
  }
  hitEnemy(id,en,dmg,attackerId,crit=false){
    if(!en||en.hp<=0)return;
    en.hp=Math.max(0,en.hp-dmg);en.flash=.12;this.enemyAggro.set(id,{kind:"player",id:attackerId});
    const guardId=this.enemyPetByEnemy.get(id),guard=guardId&&this.state.animals.get(guardId);
    if(guard){guard.sleeping=false;guard.enraged=true;guard.combat=10;guard.tameFailedAggro=true;this.animalAggro.set(guardId,{kind:"player",id:attackerId});}
    this.broadcastFx({kind:"hit",x:en.x,y:en.y,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});
    if(en.hp<=0){this.state.enemies.delete(id);this.enemyAggro.delete(id);this.detachEnemyGuard(id,attackerId,false);this.rewardKill(attackerId,"enemy",en.x,en.y);}
  }
  rewardKill(ownerId,kind,x,y,species=""){const drop=weighted([{v:"wood",w:3},{v:"stone",w:2},{v:"gold",w:1}]),amount=drop==="gold"?1:2;this.sendReward(ownerId,{kind:"resource",resource:drop,amount},{x,y,kill:true});if(kind==="enemy"&&Math.random()<.1){const sp=weighted([{v:"dog",w:2},{v:"cat",w:2},{v:"rabbit",w:2},{v:"fox",w:2},{v:"dragon",w:1},{v:"wolf",w:1},{v:"bear",w:1}]);this.sendReward(ownerId,{kind:"cards",species:sp,amount:1},{x,y});}}

  handleAttack(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const now=this.state.worldTime,next=this.playerAttackCd.get(client.sessionId)||0;if(now<next)return;const tool=this.validTool(String(data.tool||p.tool||"Fist")),t=TOOL[tool];this.playerAttackCd.set(client.sessionId,now+(t.cadence||.3));const angle=Number.isFinite(+data.angle)?+data.angle:p.angle;p.angle=angle;
    // PvP is at most 11 targets, so keep it direct.
    for(const [pid,target] of this.state.players){if(pid===client.sessionId||target.dead)continue;if(dist(p.x,p.y,target.x,target.y)<t.range+PLAYER_R&&facing(p.x,p.y,angle,target.x,target.y,.95)){const crit=Math.random()<.12,dmg=t.dmg*(crit?2:1);this.damageTarget({kind:"player",id:pid},dmg,"player",client.sessionId);this.broadcastFx({kind:"hit",x:target.x,y:target.y-8,text:(crit?"CRIT ":"")+Math.round(dmg),color:crit?"#ffe08a":"#f2836a"});}}

    // Creature/enemy melee now queries only nearby dynamic buckets instead of
    // scanning every animal and enemy in the 14,400 x 14,400 world per swing.
    const attackKinds=new Set(["enemy","animal"]),nearby=this.nearbyDynamic(p.x,p.y,t.range+165,attackKinds);
    for(const rec of nearby){if(rec.kind!=="enemy")continue;const en=rec.obj;if(en&&dist(p.x,p.y,en.x,en.y)<t.range+en.r&&facing(p.x,p.y,angle,en.x,en.y,.9)){const crit=Math.random()<.15;this.hitEnemy(rec.id,en,t.dmg*(crit?2:1),client.sessionId,crit);}}

    // If the client identified the exact animal under this swing, validate it
    // server-side and hit it whether it is asleep or awake.
    const aimedId=String(data.animalId||"");let aimedHit=false;
    if(aimedId){const a=this.state.animals.get(aimedId);if(a&&animalMeleeTouch(a,p.x,p.y,t.range+10,angle,1.18)){const crit=Math.random()<.12;this.hitWild(aimedId,a,t.dmg*(crit?2:1),client.sessionId,crit);aimedHit=true;}}
    for(const rec of nearby){if(rec.kind!=="animal"||(aimedHit&&rec.id===aimedId))continue;const a=rec.obj;if(a&&animalMeleeTouch(a,p.x,p.y,t.range,angle,1.05)){const crit=Math.random()<.12;this.hitWild(rec.id,a,t.dmg*(crit?2:1),client.sessionId,crit);}}

    let wallBest=null,wallBestD=Infinity;for(const [wid,w] of this.state.walls){if(w.hp<=0)continue;const d=dist(p.x,p.y,w.x,w.y);if(d<t.range+w.r+4&&facing(p.x,p.y,angle,w.x,w.y,1.12)&&d<wallBestD){wallBest={wid,w};wallBestD=d;}}if(wallBest){const wd=wallDamageForTool(tool,wallBest.w);wallBest.w.hp=Math.max(0,wallBest.w.hp-wd);this.broadcastFx({kind:"hit",x:wallBest.w.x,y:wallBest.w.y,text:Math.round(wd),color:wallBest.w.kind==="stoneSpike"?"#d9e0e6":"#c99a5b"});if(wallBest.w.hp<=0){this.state.walls.delete(wallBest.wid);}}

    let best=null,bestD=Infinity;for(const [id,c] of this.state.chests){if(c.opened)continue;const d=dist(p.x,p.y,c.x,c.y+8);if(d<t.range+c.r+8&&facing(p.x,p.y,angle,c.x,c.y+8,1.15)&&d<bestD){best={id,c};bestD=d;}}if(best)this.hitChest(client,best.id,best.c);
  }
  hitChest(client,id,c){if(!c||c.opened)return;c.hp=Math.max(0,c.hp-1);c.pulse=1;if(c.hp<=0){c.opened=true;const reward=this.chestRewards.get(id)||this.makeChestReward();this.chestRewards.delete(id);client.send("chestReward",{id,reward});this.broadcastFx({kind:"chest",x:c.x,y:c.y});}else{const first=c.chipSide||"wood",second=first==="wood"?"stone":"wood",bonus=Math.random()<.45;c.chipSide=second;client.send("worldReward",{kind:"resource",resource:first,amount:1,x:c.x,y:c.y});if(bonus)client.send("worldReward",{kind:"resource",resource:second,amount:1,x:c.x,y:c.y});}}
  makeChestReward(){const roll=Math.random();if(roll<.34)return{kind:"cubits",amount:Math.random()<.1?randi(12,18):randi(5,10)};if(roll<.52)return{kind:"cards",species:weighted(WILD_SPECIES.map(v=>({v,w:v==="dog"||v==="cat"?2.2:v==="dragon"?.55:1}))),amount:Math.random()<.14?25:10};const res=weighted([{v:"wood",w:2.8},{v:"stone",w:2.3},{v:"berries",w:1.8},{v:"gold",w:1.1}]);const amount=res==="wood"?randi(16,28):res==="stone"?randi(12,22):res==="berries"?randi(6,12):randi(3,6);return{kind:"resource",resource:res,amount};}

  handleShoot(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const now=this.state.worldTime,next=this.playerShootCd.get(client.sessionId)||0;if(now<next)return;this.playerShootCd.set(client.sessionId,now+.45);const a=Number.isFinite(+data.angle)?+data.angle:p.angle;this.addProjectile({x:p.x+Math.cos(a)*26,y:p.y+Math.sin(a)*26,vx:Math.cos(a)*640,vy:Math.sin(a)*640,life:1.15,r:5,hostile:false,kind:"arrow",color:"#7ec0ee",dmg:TOOL.Bow.dmg,ownerId:client.sessionId,petBlast:false,knock:0});}

  handleTame(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const id=String(data.id||"");const a=this.state.animals.get(id);if(!a||a.stage!=="baby"||!a.sleeping||dist(p.x,p.y,a.x,a.y)>78)return;let count=0;for(const [,pet]of this.state.pets)if(pet.ownerId===client.sessionId&&!pet.dead)count++;if(count>=4){client.send("tameResult",{success:false,reason:"max"});return;}client.send("tameResult",{pending:true,type:a.type});this.clock.setTimeout(()=>{const current=this.state.animals.get(id),owner=this.state.players.get(client.sessionId);if(!current||!owner||current.stage!=="baby"||dist(owner.x,owner.y,current.x,current.y)>100)return;if(Math.random()<.5){this.state.animals.delete(id);this.animalAggro.delete(id);const petId=this.addPet(client.sessionId,current.type,current.stage,current.x,current.y,{hp:current.maxHp,coat:current.coat,spotCol:current.spotCol,spotsJson:current.spotsJson,petName:current.type});client.send("tameResult",{success:true,type:current.type,petId});this.sendReward(client.sessionId,{kind:"cards",species:current.type,amount:1},{x:current.x,y:current.y,tame:true});}else{current.sleeping=false;current.enraged=true;current.tameFailedAggro=true;current.desperateAggro=false;current.fleeUntil=0;current.combat=9999;this.animalAggro.set(id,{kind:"player",id:client.sessionId});client.send("tameResult",{success:false,type:current.type});}},600);}

  handleBuild(client,data){const p=this.state.players.get(client.sessionId);if(!p||p.dead)return;const kind=String(data.kind||"");const angle=Number.isFinite(+data.angle)?+data.angle:p.angle;if(kind==="wall")this.addWall(p.x+Math.cos(angle)*48,p.y+Math.sin(angle)*48,20,-1,client.sessionId,{hp:72,kind:"wood"});else if(kind==="tower")this.addTower(p.x+Math.cos(angle)*55,p.y+Math.sin(angle)*55,client.sessionId);}
  ownedPet(client,id){const p=this.state.pets.get(String(id||""));return p&&p.ownerId===client.sessionId?p:null;}
  handlePetOrder(client,data){const id=String(data.id||""),p=this.ownedPet(client,id);if(!p||p.dead)return;const mode=String(data.mode||"follow");if(["follow","defend","combat","set"].includes(mode))p.orderMode=mode;if(Number.isFinite(+data.x)&&Number.isFinite(+data.y)){p.targetX=clamp(+data.x,20,WORLD_W-20);p.targetY=clamp(+data.y,20,WORLD_H-20);}else if(mode!=="set"){p.targetX=-1;p.targetY=-1;}}
  handlePetRename(client,data){const p=this.ownedPet(client,data.id);if(!p)return;const name=String(data.name||"").replace(/[<>]/g,"").trim().slice(0,14);if(name)p.petName=name;}
  handlePetRelease(client,data){const id=String(data.id||""),p=this.ownedPet(client,id);if(!p)return;const aid=this.addAnimal(p.type,p.stage,p.x,p.y,{releasedWild:true,hp:p.hp,level:p.level,exp:p.exp,petName:p.petName,enraged:true,tameFailedAggro:true,desperateAggro:true});const a=this.state.animals.get(aid);a.coat=p.coat;a.spotCol=p.spotCol;a.spotsJson=p.spotsJson;a.sleeping=false;this.animalAggro.set(aid,{kind:"player",id:client.sessionId});this.state.pets.delete(id);const owner=this.state.players.get(client.sessionId);if(owner?.ridingPetId===id)owner.ridingPetId="";client.send("petReleased",{id,animalId:aid,name:p.petName});}

  handlePetAbility(client,data){const id=String(data.id||""),p=this.ownedPet(client,id);if(!p||p.dead||p.abilityCd>0)return;const info=PET_TYPES[p.type];p.abilityCd=info.abilityCd;const owner=this.state.players.get(client.sessionId);const angle=owner?.angle||p.angle;const elem=info.elem;this.broadcast("abilityEvent",{petId:id,ownerId:client.sessionId,elem,x:p.x,y:p.y,r:p.r});
    const areaKinds=new Set(["enemy","animal"]);
    const area=(damage,range,knock=0)=>{for(const rec of this.nearbyDynamic(p.x,p.y,range+120,areaKinds)){const o=rec.obj;if(!o)continue;const d=dist(p.x,p.y,o.x,o.y);if(d>range)continue;if(rec.kind==="enemy"){this.hitEnemy(rec.id,o,damage,client.sessionId,false);if(knock&&this.state.enemies.has(rec.id)){const a=angTo(p.x,p.y,o.x,o.y);o.x+=Math.cos(a)*knock;o.y+=Math.sin(a)*knock;}}else{this.hitWild(rec.id,o,damage,client.sessionId,false);if(this.state.animals.has(rec.id))this.animalAggro.set(rec.id,{kind:"pet",id});if(knock&&this.state.animals.has(rec.id)){const q=angTo(p.x,p.y,o.x,o.y);o.x+=Math.cos(q)*knock;o.y+=Math.sin(q)*knock;}}}};
    if(elem==="Stone"){const ws=dogWallStats(p.stage);this.addWall(p.x+Math.cos(angle)*44,p.y+Math.sin(angle)*44,27,34,client.sessionId,{hp:ws.hp,kind:"stoneSpike",spiked:true,spikeDmg:ws.spikeDmg,sourcePetId:id});}
    else if(elem==="Sound")area(10,p.r+90,20);
    else if(elem==="Fire")area(18,p.r+92,0);
    else if(elem==="Ice")area(12,p.r+95,0);
    else if(elem==="Wind")area(8,p.r+100,34);
    else if(elem==="Poison")area(16,p.r+86,0);
    else if(elem==="Earth")area(18,p.r+100,12);
    else if(elem==="Light"){area(8,p.r+90,0);if(owner&&!owner.dead)owner.health=clamp(owner.health+12,0,owner.maxHealth);}
    else if(elem==="Lightning"){let targets=[];for(const rec of this.nearbyDynamic(p.x,p.y,430,areaKinds)){const d=dist(p.x,p.y,rec.obj.x,rec.obj.y);if(d<=320)targets.push({kind:rec.kind,id:rec.id,obj:rec.obj,d});}targets.sort((a,b)=>a.d-b.d);for(const t of targets.slice(0,4)){if(t.kind==="enemy")this.hitEnemy(t.id,t.obj,20,client.sessionId);else this.hitWild(t.id,t.obj,20,client.sessionId);}}
    else if(elem==="Water")this.addProjectile({x:p.x,y:p.y,vx:Math.cos(angle)*360,vy:Math.sin(angle)*360,life:1.15,r:12,hostile:false,kind:"water",color:"#4aa3e0",dmg:15,ownerId:client.sessionId,petBlast:true,knock:26});
    else if(elem==="Plant"){this.addProjectile({x:p.x,y:p.y,vx:Math.cos(angle)*400,vy:Math.sin(angle)*400,life:1,r:7,hostile:false,kind:"leaf",color:"#5cb85c",dmg:14,ownerId:client.sessionId,petBlast:true,knock:0});if(owner&&!owner.dead)owner.health=clamp(owner.health+22,0,owner.maxHealth);for(const[,mate]of this.state.pets)if(mate.ownerId===client.sessionId&&!mate.dead)mate.hp=clamp(mate.hp+18,0,mate.maxHp);}
    else if(elem==="Combat"){const t=this.nearestHostile(p.x,p.y,300);if(t){const a=angTo(p.x,p.y,t.obj.x,t.obj.y),dd=Math.min(150,Math.max(0,t.d-(p.r+t.obj.r)*.7));p.x=clamp(p.x+Math.cos(a)*dd,20,WORLD_W-20);p.y=clamp(p.y+Math.sin(a)*dd,20,WORLD_H-20);p.angle=a;if(dist(p.x,p.y,t.obj.x,t.obj.y)<p.r+t.obj.r+20){if(t.kind==="enemy")this.hitEnemy(t.id,t.obj,34+p.level*4,client.sessionId);else this.hitWild(t.id,t.obj,34+p.level*4,client.sessionId);}}}
  }

  nearestHostile(x,y,range=Infinity){
    let best=null,bestD=range;
    if(Number.isFinite(range)){
      const kinds=new Set(["enemy","animal"]);
      for(const rec of this.nearbyDynamic(x,y,range+120,kinds)){
        const o=rec.obj;if(!o||o.dead||o.hp<=0)continue;const d=dist(x,y,o.x,o.y);if(d<bestD){best={kind:rec.kind,id:rec.id,obj:o,d};bestD=d;}
      }
      return best;
    }
    for(const[id,en]of this.state.enemies){const d=dist(x,y,en.x,en.y);if(d<bestD){best={kind:"enemy",id,obj:en,d};bestD=d;}}
    for(const[id,a]of this.state.animals){const d=dist(x,y,a.x,a.y);if(d<bestD){best={kind:"animal",id,obj:a,d};bestD=d;}}
    return best;
  }
  targetObject(ref){if(!ref)return null;if(ref.kind==="player")return this.state.players.get(ref.id)||null;if(ref.kind==="pet")return this.state.pets.get(ref.id)||null;return null;}
  targetRadius(ref,obj){return ref?.kind==="player"?PLAYER_R:(obj?.r||16);}
  nearestPlayerOrPet(x,y,range=Infinity){let best=null,bestD=range;for(const[id,p]of this.state.players){if(p.dead)continue;const d=dist(x,y,p.x,p.y);if(d<bestD){best={kind:"player",id,obj:p,d};bestD=d;}}for(const[id,p]of this.state.pets){if(p.dead)continue;const d=dist(x,y,p.x,p.y);if(d<bestD){best={kind:"pet",id,obj:p,d};bestD=d;}}return best;}
  touchingPlayerForAnimal(a,preferredId=""){
    if(preferredId){
      const p=this.state.players.get(preferredId);
      if(p&&animalAttackContact(a,{kind:"player",id:preferredId},p))return{kind:"player",id:preferredId,obj:p};
    }
    for(const[id,p]of this.state.players){
      if(animalAttackContact(a,{kind:"player",id},p))return{kind:"player",id,obj:p};
    }
    return null;
  }

  animalBiteVictim(a,preferredRef){
    const preferred=this.targetObject(preferredRef);

    if(preferredRef?.kind==="player"&&preferred&&animalAttackContact(a,preferredRef,preferred)){
      return{ref:preferredRef,obj:preferred};
    }

    // A player physically in front of a pet-targeted animal can take the bite.
    for(const[id,p]of this.state.players){
      const ref={kind:"player",id};
      if(animalAttackContact(a,ref,p))return{ref,obj:p};
    }

    if(preferred&&animalAttackContact(a,preferredRef,preferred)){
      return{ref:preferredRef,obj:preferred};
    }
    return null;
  }

  animalAttackCooldown(a){
    return a.stage==="bigmomma"?1.25:a.stage==="superboss"?.95:a.stage==="boss"?.80:1.05;
  }

  playerEscapingAnimal(player,a){
    if(!player||!a)return false;
    let mx=player.moveX||0,my=player.moveY||0;const ml=Math.hypot(mx,my);if(ml<.08)return false;
    mx/=ml;my/=ml;let ax=player.x-a.x,ay=player.y-a.y;const al=Math.hypot(ax,ay)||1;ax/=al;ay/=al;
    return mx*ax+my*ay>.02;
  }

  pushTargetWithAnimal(animalId,a,ref,target,moveDx,moveDy){
    if(!a||!ref||!target)return false;
    if(Math.hypot(moveDx,moveDy)<.001)return false;
    if(animalTargetOverlap(a,ref,target)<=0)return false;

    // Exact movement transfer only.
    const dx=moveDx,dy=moveDy;

    if(ref.kind==="player"){
      if(target.dead)return false;

      // A player deliberately moving away always escapes. This threshold is
      // intentionally forgiving so latency cannot turn body contact into a hook.
      if(this.playerEscapingAnimal(target,a)){
        target.animalCarryT=0;this.playerCarryUntil.delete(ref.id);this.playerCarryAnimal.delete(ref.id);
        return false;
      }

      target.x=clamp(target.x+dx,PLAYER_R,WORLD_W-PLAYER_R);
      target.y=clamp(target.y+dy,PLAYER_R,WORLD_H-PLAYER_R);
      this.resolveStatic(target,PLAYER_R*.82);

      // One short authoritative carry window prevents stale position packets from
      // cancelling real body movement, but is short enough to release instantly.
      target.animalCarryT=.08;
      this.playerCarryUntil.set(ref.id,this.state.worldTime+.08);
      this.playerCarryAnimal.set(ref.id,animalId);
      this.queueAnimalPush(ref.id,{animalId,dx,dy,x:target.x,y:target.y});
      return true;
    }

    if(ref.kind==="pet"){
      if(target.dead)return false;
      target.x=clamp(target.x+dx,20,WORLD_W-20);
      target.y=clamp(target.y+dy,20,WORLD_H-20);
      this.resolveStatic(target,(target.r||18)*.72);
      return true;
    }
    return false;
  }

  carryEverythingTouchedByAnimal(animalId,a,moveDx,moveDy){
    if(!a||Math.hypot(moveDx,moveDy)<.001)return;

    // Any player touched by the MOVING BODY gets carried, regardless of who
    // the animal is attacking.
    for(const[id,p]of this.state.players){
      if(p.dead)continue;
      const ref={kind:"player",id};
      if(animalTargetOverlap(a,ref,p)>0)this.pushTargetWithAnimal(animalId,a,ref,p,moveDx,moveDy);
    }

    // Pets behave the same way.
    for(const[id,p]of this.state.pets){
      if(p.dead)continue;
      const ref={kind:"pet",id};
      if(animalTargetOverlap(a,ref,p)>0)this.pushTargetWithAnimal(animalId,a,ref,p,moveDx,moveDy);
    }
  }

  performAnimalBite(id,a,victim){
    if(!victim||a.atkCd>0)return false;
    const base=Math.max(1,typeDmg(a.type,a.stage)||6);
    const dmg=rand(base*.82,base*1.16);
    if(!this.damageTarget(victim.ref,dmg,"animal",id))return false;

    // IMPORTANT: animation means a REAL bite happened.
    a.atkCd=this.animalAttackCooldown(a);
    a.attackAnim=.30;
    a.flash=.07;
    a.combat=8;
    a.enraged=true;
    a.sleeping=false;

    if(victim.ref.kind==="player"){
      this.animalAggro.set(id,{kind:"player",id:victim.ref.id});
    }

    this.broadcastFx({
      kind:"hit",
      x:victim.obj.x,
      y:victim.obj.y-(victim.ref.kind==="player"?8:Math.max(8,(victim.obj.r||16)*.7)),
      text:Math.round(dmg),
      color:"#f2836a"
    });
    return true;
  }

  hasNearbyPlayerOrPet(x,y,range=1600){
    const r2=range*range;
    for(const [,p] of this.state.players){if(p&&!p.dead){const dx=p.x-x,dy=p.y-y;if(dx*dx+dy*dy<=r2)return true;}}
    for(const [,p] of this.state.pets){if(p&&!p.dead){const dx=p.x-x,dy=p.y-y;if(dx*dx+dy*dy<=r2)return true;}}
    return false;
  }

  updateEnemyGuardPet(id,a,enemyId,en,dt){
    if(!a||!en)return false;
    const rider=en.ridingPetId===id;
    a.sleeping=false;a.enraged=true;a.combat=Math.max(a.combat||0,2);
    let ref=this.animalAggro.get(id)||null,target=this.targetObject(ref);
    if(ref&&(!target||(ref.kind==="player"?(target.dead||target.health<=0):(target.dead||target.hp<=0)))){this.animalAggro.delete(id);ref=null;target=null;}
    if(!target){const near=this.nearestPlayerOrPet(a.x,a.y,rider?330:250);if(near){ref={kind:near.kind,id:near.id};target=near.obj;this.animalAggro.set(id,ref);}}
    if(target){
      const face=angTo(a.x,a.y,target.x,target.y);smoothTurn(a,face,dt,rider?8.2:7.4);
      const step=(a.speed||60)*(rider?1.18:1.10);const bx=a.x,by=a.y;
      a.x+=Math.cos(a.angle)*step*dt;a.y+=Math.sin(a.angle)*step*dt;this.resolveStatic(a,(a.r||18)*.68);
      const victim=this.animalBiteVictim(a,ref);if(victim&&a.atkCd<=0)this.performAnimalBite(id,a,victim);
      if(!rider&&dist(a.x,a.y,en.x,en.y)>540&&!a.tameFailedAggro)this.animalAggro.delete(id);
      this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);
    }else if(rider){
      a.wanderT=(a.wanderT||0)-dt;
      if(a.wanderT<=0){a.wanderA=rand(0,TAU);a.wanderT=rand(1.1,2.6);}
      smoothTurn(a,a.wanderA,dt,4.2);const bx=a.x,by=a.y;
      a.x+=Math.cos(a.angle)*(a.speed||60)*.42*dt;a.y+=Math.sin(a.angle)*(a.speed||60)*.42*dt;this.resolveStatic(a,(a.r||18)*.68);
      this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);
    }else{
      const d=dist(a.x,a.y,en.x,en.y);
      const standOff=en.r+Math.max(18,(a.r||18)*.72)+18;
      if(d>standOff+8){const face=angTo(a.x,a.y,en.x,en.y);smoothTurn(a,face,dt,6.2);const mul=d>210?1.56:d>125?1.30:.94;const bx=a.x,by=a.y;a.x+=Math.cos(a.angle)*(a.speed||60)*mul*dt;a.y+=Math.sin(a.angle)*(a.speed||60)*mul*dt;this.resolveStatic(a,(a.r||18)*.68);this.carryEverythingTouchedByAnimal(id,a,a.x-bx,a.y-by);}
      else if(d<standOff){const away=angTo(en.x,en.y,a.x,a.y);const push=standOff-d+1;a.x+=Math.cos(away)*push;a.y+=Math.sin(away)*push;this.resolveStatic(a,(a.r||18)*.68);}
      else a.angle+=dt*.28;
    }
    a.x=clamp(a.x,20,WORLD_W-20);a.y=clamp(a.y,20,WORLD_H-20);
    if(rider){en.x=a.x;en.y=a.y;en.angle=a.angle;}
    return true;
  }

  updateAnimals(dt){
    for(const[id,a]of this.state.animals){
      if(!a)continue;
      const forcedActive=this.enemyOwnerByPet.has(id)||this.animalAggro.has(id)||a.tameFailedAggro||a.desperateAggro||(a.recentHit||0)>0;
      if(!forcedActive&&!this.hasNearbyPlayerOrPet(a.x,a.y,1600))continue;
      const moveStartX=a.x,moveStartY=a.y;

      a.flash=Math.max(0,(a.flash||0)-dt);
      a.atkCd=Math.max(0,(a.atkCd||0)-dt);
      a.abilityCd=Math.max(0,(a.abilityCd||0)-dt);
      a.combat=Math.max(0,(a.combat||0)-dt);
      a.recentHit=Math.max(0,(a.recentHit||0)-dt);
      a.attackAnim=Math.max(0,(a.attackAnim||0)-dt);
      a.tailPhase=(a.tailPhase||0)+dt*(2.2+(a.speed||60)*.02);

      const enemyOwnerId=this.enemyOwnerByPet.get(id);
      if(enemyOwnerId){
        const ownerEnemy=this.state.enemies.get(enemyOwnerId);
        if(!ownerEnemy){this.enemyOwnerByPet.delete(id);this.enemyPetByEnemy.delete(enemyOwnerId);this.state.animals.delete(id);this.animalAggro.delete(id);continue;}
        this.updateEnemyGuardPet(id,a,enemyOwnerId,ownerEnemy,dt);
        continue;
      }

      if(a.recentHit<=0&&a.hp<a.maxHp){
        a.hp=Math.min(a.maxHp,a.hp+Math.max(.8,a.maxHp*.018)*dt);
      }

      let ref=this.animalAggro.get(id)||null;
      let target=this.targetObject(ref);
      if(ref&&(!target||(ref.kind==="player"?(target.dead||target.health<=0):(target.dead||target.hp<=0)))){
        this.animalAggro.delete(id);
        ref=null;
        target=null;
      }

      if(a.tameFailedAggro||a.desperateAggro){
        a.enraged=true;
        a.sleeping=false;
        a.fleeUntil=0;
      }

      const babyFleeing=a.stage==="baby"&&!a.tameFailedAggro&&!a.desperateAggro&&a.hp/a.maxHp>.32;

      if(ref&&target){
        a.sleeping=false;
        a.enraged=true;
        a.combat=Math.max(a.combat,2);

        if(babyFleeing){
          const away=angTo(target.x,target.y,a.x,a.y);
          smoothTurn(a,away,dt,5.2);
          a.x+=Math.cos(a.angle)*a.speed*1.24*dt;
          a.y+=Math.sin(a.angle)*a.speed*1.24*dt;
          if(dist(a.x,a.y,target.x,target.y)>390&&!a.tameFailedAggro){
            this.animalAggro.delete(id);
            a.enraged=false;
          }
        }else{
          const face=angTo(a.x,a.y,target.x,target.y);
          smoothTurn(a,face,dt,7.2);

          // Chase continuously. If the moving animal overlaps its target,
          // that target is carried by the animal's actual movement delta.
          let victim=this.animalBiteVictim(a,ref);

          // A fighting animal NEVER stops just because it reached bite distance.
          // It keeps walking toward its target every tick. Once its physical body
          // reaches the target, that same movement carries the target with it.
          // Bite/contact range never changes movement speed.
          const chaseMul=a.tameFailedAggro?1.15:1.08;
          const stepSpeed=(a.speed||60)*chaseMul;
          const beforeX=a.x,beforeY=a.y;

          a.x+=Math.cos(a.angle)*stepSpeed*dt;
          a.y+=Math.sin(a.angle)*stepSpeed*dt;
          this.resolveStatic(a,(a.r||18)*.68);

          let moveDx=a.x-beforeX,moveDy=a.y-beforeY;

          // Only obstacle collision is allowed to redirect/stop the animal.
          if(!victim&&Math.hypot(moveDx,moveDy)<stepSpeed*dt*.10){
            const side=face+(Math.random()<.5?1:-1)*Math.PI*.48;
            const sx=a.x,sy=a.y;
            a.x+=Math.cos(side)*stepSpeed*.62*dt;
            a.y+=Math.sin(side)*stepSpeed*.62*dt;
            this.resolveStatic(a,(a.r||18)*.68);
            moveDx=a.x-sx;moveDy=a.y-sy;
          }

          // Re-check after movement for a real face-contact bite.
          victim=this.animalBiteVictim(a,ref);

          if(victim&&a.atkCd<=0){
            this.performAnimalBite(id,a,victim);
          }

          const leash=a.stage==="bigmomma"?760:a.stage==="superboss"?620:a.stage==="boss"?520:470;
          if(dist(a.x,a.y,target.x,target.y)>leash&&!a.tameFailedAggro&&!a.desperateAggro){
            this.animalAggro.delete(id);
            a.enraged=false;
            a.combat=0;
            if(["boss","superboss","bigmomma"].includes(a.stage))a.sleeping=true;
          }
        }
      }else{
        const info=PET_TYPES[a.type]||{};
        const nearest=this.nearestPlayerOrPet(a.x,a.y,320);

        if(a.sleeping){
          // Sleeping wildlife only wakes from an actual hit/tame failure.
        }else if(babyFleeing&&nearest&&nearest.kind==="player"&&nearest.d<185){
          const away=angTo(nearest.obj.x,nearest.obj.y,a.x,a.y);
          smoothTurn(a,away,dt,4.8);
          a.x+=Math.cos(a.angle)*a.speed*1.24*dt;
          a.y+=Math.sin(a.angle)*a.speed*1.24*dt;
        }else{
          // Adult foxes/friendly animals do not start fights by proximity.
          const autoHostile=a.stage!=="baby"&&a.type!=="fox"&&!info.friendly;
          const aggroRange=a.type==="bear"?195:215;

          if(autoHostile&&nearest&&nearest.d<aggroRange){
            this.animalAggro.set(id,{kind:nearest.kind,id:nearest.id});
            a.enraged=true;
            a.sleeping=false;
          }else{
            a.wanderT=(a.wanderT||0)-dt;
            if(a.wanderT<=0){
              a.wanderA=rand(0,TAU);
              a.wanderT=rand(1.2,3.2);
              if(a.stage==="baby"&&Math.random()<.10)a.sleeping=true;
              if(["boss","superboss","bigmomma"].includes(a.stage)&&!a.enraged&&Math.random()<(a.stage==="bigmomma"?.22:.08)){
                a.sleeping=true;
              }
            }
            smoothTurn(a,a.wanderA||0,dt,3.6);
            a.x+=Math.cos(a.angle)*a.speed*.50*dt;
            a.y+=Math.sin(a.angle)*a.speed*.50*dt;
          }
        }
      }

      a.x=clamp(a.x,20,WORLD_W-20);
      a.y=clamp(a.y,20,WORLD_H-20);
      this.resolveStatic(a,(a.r||18)*.68);

      const actualMoveX=a.x-moveStartX,actualMoveY=a.y-moveStartY;
      this.carryEverythingTouchedByAnimal(id,a,actualMoveX,actualMoveY);
    }
  }

  applyPlayerCreaturePushes(){
    const kinds=new Set(["animal","pet"]);
    const pushOne=(player,obj,isPet=false)=>{
      if(!obj||obj.dead)return;
      const circles=animalPhysicalCircles(obj);let best=0;
      for(const h of circles){const d=dist(player.x,player.y,h.x,h.y);best=Math.max(best,PLAYER_R+h.r+4-d);}
      if(best<=0)return;

      let mx=player.moveX||0,my=player.moveY||0;const ml=Math.hypot(mx,my);
      if(ml<.05)return;mx/=ml;my/=ml;

      // Moving away is never resisted: no radial shove, no sticky correction.
      let ax=player.x-obj.x,ay=player.y-obj.y;const al=Math.hypot(ax,ay)||1;ax/=al;ay/=al;
      if(mx*ax+my*ay>.02)return;

      // Player movement transfers into the animal, scaled by animal mass/stage.
      const weight=obj.stage==="bigmomma"?.24:obj.stage==="superboss"?.38:obj.stage==="boss"?.52:obj.stage==="adult"?.80:1;
      const amount=clamp(best*.50+1.8,1.5,12)*weight;
      obj.x+=mx*amount;obj.y+=my*amount;this.resolveStatic(obj,(obj.r||18)*(isPet?.72:.68));

      // If a heavy animal could not move enough, stop only the part of the
      // player's movement that penetrated it. This is collision resolution,
      // not knockback, and it is along the player's own movement axis.
      let remaining=0;
      for(const h of animalPhysicalCircles(obj)){const d=dist(player.x,player.y,h.x,h.y);remaining=Math.max(remaining,PLAYER_R+h.r+2-d);}
      if(remaining>0){const back=Math.min(remaining+0.5,12);player.x-=mx*back;player.y-=my*back;this.resolveStatic(player,PLAYER_R*.82);}
    };

    for(const[id,p]of this.state.players){
      if(p.dead||!p.moving)continue;
      for(const rec of this.nearbyDynamic(p.x,p.y,180,kinds)){
        const obj=rec.obj;if(!obj)continue;
        if(rec.kind==="pet"&&p.ridingPetId===rec.id)continue;
        const rr=(obj.r||18)*2.3+70,dx=p.x-obj.x,dy=p.y-obj.y;if(dx*dx+dy*dy>rr*rr)continue;
        pushOne(p,obj,rec.kind==="pet");
      }
    }
  }

  damageTarget(ref,dmg,attackerKind="world",attackerId=""){
    const obj=this.targetObject(ref);if(!obj)return false;
    if(ref.kind==="player"){
      if(obj.dead)return false;const amount=Math.max(0,Number(dmg)||0);if(amount<=0)return false;
      obj.health=Math.max(0,obj.health-amount);if(obj.health<=0){obj.health=0;obj.dead=true;obj.ridingPetId="";}
      if(attackerId&&!obj.dead){
        let threat=null;
        if(this.state.animals.has(attackerId))threat={kind:"animal",id:attackerId};
        else if(this.state.enemies.has(attackerId))threat={kind:"enemy",id:attackerId};
        if(threat)this.ownerThreat.set(ref.id,{...threat,until:this.state.worldTime+7});
      }
      const hit={dmg:amount,health:obj.health,maxHealth:obj.maxHealth,dead:obj.dead,attackerKind,attackerId};
      if(obj.dead){const c=this.clientById(ref.id);if(c)c.send("playerHit",hit);this.pendingPlayerHits.delete(ref.id);}
      else this.queuePlayerHit(ref.id,hit);
      return true;
    }
    if(ref.kind==="pet"){if(obj.dead)return false;const amount=animalDamageTaken(obj.type,obj.stage,Math.max(0,Number(dmg)||0));if(amount<=0)return false;obj.hp=Math.max(0,obj.hp-amount);obj.flash=.15;obj.combat=6;if(obj.hp<=0){obj.dead=true;this.petDeathTimers.set(ref.id,3);}return true;}
    return false;
  }

  givePetExp(id,p,amount){if(!p||p.dead||p.stage==="bigmomma")return;p.exp+=amount;const need=expNeed(p.stage,p.level);if(p.exp<need)return;p.exp-=need;p.level++;let next=null;if(p.stage==="baby"&&p.level>=4)next="adult";else if(p.stage==="adult"&&p.level>=5)next="boss";else if(p.stage==="boss"&&p.level>=6)next="superboss";if(next){p.stage=next;p.r=animalRadius(p.type,next);p.maxHp=typeHp(p.type,next);p.hp=p.maxHp;p.speed=animalSpeed(p.type,next,true);p.level=1;const c=this.clientById(p.ownerId);if(c)c.send("petGrew",{id,stage:next,type:p.type});}}

  updatePets(dt){
    for(const[id,p]of this.state.pets){
      if(p.dead)continue;
      p.abilityCd=Math.max(0,p.abilityCd-dt);
      p.atkCd=Math.max(0,p.atkCd-dt);
      p.combat=Math.max(0,p.combat-dt);
      p.flash=Math.max(0,p.flash-dt);
      p.attackAnim=Math.max(0,p.attackAnim-dt);
      p.tailPhase+=dt*(2.8+p.speed*.02);

      const owner=this.state.players.get(p.ownerId);
      if(!owner)continue;

      if(owner.ridingPetId===id){
        p.x=owner.x;p.y=owner.y;p.angle=owner.angle;
        continue;
      }

      let target=null;
      const threat=this.ownerThreat.get(p.ownerId);
      if(threat&&threat.until>this.state.worldTime){
        const obj=threat.kind==="animal"?this.state.animals.get(threat.id):this.state.enemies.get(threat.id);
        if(obj&&((threat.kind==="animal"&&obj.hp>0)||(threat.kind==="enemy"&&!obj.dead&&obj.hp>0))&&dist(owner.x,owner.y,obj.x,obj.y)<520)target={kind:threat.kind,id:threat.id,obj,d:dist(p.x,p.y,obj.x,obj.y)};
      }else if(threat)this.ownerThreat.delete(p.ownerId);
      if(!target&&p.orderMode==="combat")target=this.nearestHostile(p.x,p.y,340);
      else if(!target&&p.orderMode==="defend"){
        target=this.nearestHostile(p.x,p.y,210);
        if(target&&dist(owner.x,owner.y,target.obj.x,target.obj.y)>260)target=null;
      }

      if(target){
        const a=angTo(p.x,p.y,target.obj.x,target.obj.y);
        smoothTurn(p,a,dt,5);
        const touch=dist(p.x,p.y,target.obj.x,target.obj.y)<=p.r*.8+(target.obj.r||16)*.8+12;
        if(!touch){
          p.x+=Math.cos(p.angle)*p.speed*1.18*dt;
          p.y+=Math.sin(p.angle)*p.speed*1.18*dt;
        }else if(p.atkCd<=0){
          const dmg=petAtkDmg(p);
          p.atkCd=p.stage==="baby"?.55:p.stage==="adult"?.4:p.stage==="boss"?.32:.28;
          p.attackAnim=.18;
          if(target.kind==="enemy"){
            this.enemyAggro.set(target.id,{kind:"pet",id});
            const before=this.state.enemies.has(target.id);
            this.hitEnemy(target.id,target.obj,dmg,p.ownerId);
            if(before&&!this.state.enemies.has(target.id))this.givePetExp(id,p,18);
          }else{
            this.animalAggro.set(target.id,{kind:"pet",id});
            const before=this.state.animals.has(target.id);
            target.obj.hp=Math.max(0,target.obj.hp-dmg);
            target.obj.flash=.12;target.obj.recentHit=3.8;target.obj.sleeping=false;target.obj.enraged=true;
            if(target.obj.stage!=="baby")this.animalAggro.set(target.id,{kind:"pet",id});
            if(target.obj.hp<=0){
              this.state.animals.delete(target.id);
              this.animalAggro.delete(target.id);
              this.rewardKill(p.ownerId,"animal",target.obj.x,target.obj.y,target.obj.type);
              this.givePetExp(id,p,16);
            }
          }
        }
      }else if(p.orderMode==="set"&&p.targetX>=0){
        const d=dist(p.x,p.y,p.targetX,p.targetY);
        if(d>12){
          const a=angTo(p.x,p.y,p.targetX,p.targetY);
          smoothTurn(p,a,dt,4.6);
          p.x+=Math.cos(p.angle)*p.speed*1.3*dt;
          p.y+=Math.sin(p.angle)*p.speed*1.3*dt;
        }else{
          p.targetX=-1;p.targetY=-1;p.orderMode="follow";
        }
      }else{
        const d=dist(p.x,p.y,owner.x,owner.y);
        const ownerMoving=!!owner.moving;

        if(ownerMoving){
          // Moving owners get tight, immediate following instead of delayed catch-up.
          p.wanderT=Math.min(p.wanderT,.18);
          const stop=Math.max(52,p.r*.68+PLAYER_R+12);
          if(d>stop){
            const a=angTo(p.x,p.y,owner.x,owner.y);
            smoothTurn(p,a,dt,8.2);
            const catchup=d>320?1.78:d>190?1.52:d>105?1.30:1.10;
            p.x+=Math.cos(p.angle)*p.speed*catchup*dt;
            p.y+=Math.sin(p.angle)*p.speed*catchup*dt;
          }
        }else{
          // While the owner stands still, pets wander naturally nearby.
          const roam=Math.max(105,Math.min(185,110+p.r*.55));
          const returnDist=roam+65;

          if(d>returnDist){
            const a=angTo(p.x,p.y,owner.x,owner.y);
            smoothTurn(p,a,dt,4.8);
            p.x+=Math.cos(p.angle)*p.speed*.92*dt;
            p.y+=Math.sin(p.angle)*p.speed*.92*dt;
          }else{
            p.wanderT-=dt;
            if(p.wanderT<=0){
              p.wanderA=rand(0,TAU);
              p.wanderT=rand(1.1,3.2);
            }

            // Near the edge of the pet's roaming area, wander back toward the owner.
            const wa=d>roam?angTo(p.x,p.y,owner.x,owner.y):p.wanderA;
            smoothTurn(p,wa,dt,3.0);
            p.x+=Math.cos(p.angle)*p.speed*.30*dt;
            p.y+=Math.sin(p.angle)*p.speed*.30*dt;
          }
        }
      }

      p.x=clamp(p.x,20,WORLD_W-20);
      p.y=clamp(p.y,20,WORLD_H-20);
      this.resolveStatic(p,p.r*.72);
    }

    for(const[id,left]of Array.from(this.petDeathTimers.entries())){
      const n=left-dt;
      if(n<=0){this.state.pets.delete(id);this.petDeathTimers.delete(id);}
      else this.petDeathTimers.set(id,n);
    }
  }

  updateEnemies(dt){
    const phase=TIME_PHASES[this.state.dayPhase];
    for(const[id,en]of this.state.enemies){
      en.flash=Math.max(0,en.flash-dt);en.atkCd=Math.max(0,en.atkCd-dt);en.attackAnim=Math.max(0,en.attackAnim-dt);
      const mount=en.ridingPetId?this.state.animals.get(en.ridingPetId):null;
      if(en.ridingPetId&&!mount){en.ridingPetId="";en.guardPetId="";en.hasGuard=false;}
      if(mount){
        en.x=mount.x;en.y=mount.y;en.angle=mount.angle;
        if(phase.safe){en.hp-=18*dt;if(en.hp<=0){this.state.enemies.delete(id);this.enemyAggro.delete(id);this.detachEnemyGuard(id,"",true);continue;}}
        // Rider cube is intentionally weak; its mount is the weapon and movement.
        continue;
      }
      if(phase.safe){
        const edge=angTo(WORLD_W/2,WORLD_H/2,en.x,en.y);smoothTurn(en,edge,dt,12);en.x+=Math.cos(edge)*en.speed*1.35*dt;en.y+=Math.sin(edge)*en.speed*1.35*dt;en.hp-=18*dt;
        if(en.hp<=0||en.x<5||en.x>WORLD_W-5||en.y<5||en.y>WORLD_H-5){this.state.enemies.delete(id);this.enemyAggro.delete(id);this.detachEnemyGuard(id,"",true);continue;}
        this.resolveStatic(en,en.r*.9);continue;
      }
      let ref=this.enemyAggro.get(id),target=this.targetObject(ref);if(ref&&!target){this.enemyAggro.delete(id);ref=null;}if(!target){const near=this.nearestPlayerOrPet(en.x,en.y,en.ranged?430:280);if(near){ref={kind:near.kind,id:near.id};target=near.obj;}}
      if(target){
        const d=dist(en.x,en.y,target.x,target.y),a=angTo(en.x,en.y,target.x,target.y);smoothTurn(en,a,dt,10);const tr=this.targetRadius(ref,target);
        if(en.ranged){const desired=en.weapon==="Bow"?235:205;en.strafeT-=dt;if(en.strafeT<=0){en.strafeDir*=-1;en.strafeT=rand(.7,1.7);}if(d>desired+42){en.x+=Math.cos(a)*en.speed*.92*dt;en.y+=Math.sin(a)*en.speed*.92*dt;}else if(d<desired-34){en.x-=Math.cos(a)*en.speed*.82*dt;en.y-=Math.sin(a)*en.speed*.82*dt;}else{const q=a+en.strafeDir*Math.PI/2;en.x+=Math.cos(q)*en.speed*.62*dt;en.y+=Math.sin(q)*en.speed*.62*dt;}if(en.atkCd<=0){const isBow=en.weapon==="Bow";this.addProjectile({x:en.x+Math.cos(a)*(en.r+10),y:en.y+Math.sin(a)*(en.r+10),vx:Math.cos(a)*(isBow?560:470),vy:Math.sin(a)*(isBow?560:470),life:isBow?1.15:1.3,r:isBow?4.5:6,hostile:true,kind:isBow?"enemyArrow":"arcaneBolt",color:isBow?"#8fd4ff":"#c77dff",dmg:en.dmg,ownerId:id,petBlast:false,knock:0});en.atkCd=isBow?rand(1.25,1.55):rand(1.6,1.95);en.attackAnim=.28;}}
        else if(d>en.r+tr-3){en.x+=Math.cos(a)*en.speed*dt;en.y+=Math.sin(a)*en.speed*dt;}else if(en.atkCd<=0){this.damageTarget(ref,en.dmg,"enemy",id);en.atkCd=en.weapon==="Sword"?.72:.85;en.attackAnim=.22;}
      }else{en.wanderT-=dt;if(en.wanderT<=0){en.wanderA=Math.random()<.55?angTo(en.x,en.y,WORLD_W*.5+rand(-WORLD_W*.3,WORLD_W*.3),WORLD_H*.5+rand(-WORLD_H*.3,WORLD_H*.3)):rand(0,TAU);en.wanderT=rand(1.5,3.5);}smoothTurn(en,en.wanderA,dt,6);en.x+=Math.cos(en.angle)*en.speed*.55*dt;en.y+=Math.sin(en.angle)*en.speed*.55*dt;}
      this.resolveStatic(en,en.r*.9);
      // A non-riding guard is a separate body; never let it sit inside its cube.
      const gid=this.enemyPetByEnemy.get(id),guard=gid&&this.state.animals.get(gid);
      if(guard&&en.ridingPetId!==gid){const min=en.r+Math.max(18,(guard.r||18)*.72)+12,d=dist(en.x,en.y,guard.x,guard.y);if(d<min&&d>.01){const a=angTo(en.x,en.y,guard.x,guard.y),push=min-d;guard.x+=Math.cos(a)*push;guard.y+=Math.sin(a)*push;this.resolveStatic(guard,(guard.r||18)*.68);}}
    }
  }

  updateProjectiles(dt){
    const dynKinds=new Set(["enemy","animal"]);
    for(const[id,p]of Array.from(this.state.projectiles.entries())){
      const x0=p.x,y0=p.y,x1=p.x+p.vx*dt,y1=p.y+p.vy*dt;
      p.x=x1;p.y=y1;p.life-=dt;
      if(p.life<=0||p.x<0||p.y<0||p.x>WORLD_W||p.y>WORLD_H){this.state.projectiles.delete(id);continue;}
      let best={t:2,type:""};
      const consider=(t,type,data)=>{if(t!=null&&t<best.t)best={t,type,...data};};

      if(p.hostile){
        for(const[pid,pl]of this.state.players){if(pl.dead)continue;consider(segmentCircleT(x0,y0,x1,y1,pl.x,pl.y,p.r+PLAYER_R),"player",{pid,pl});}
        for(const[petId,pet]of this.state.pets){if(pet.dead)continue;consider(animalProjectileSegmentT(pet,x0,y0,x1,y1,p.r),"pet",{petId,pet});}
        const mx=(x0+x1)*.5,my=(y0+y1)*.5,range=Math.hypot(x1-x0,y1-y0)*.5+180;
        for(const rec of this.nearbyDynamic(mx,my,range,new Set(["animal"]))){
          if(this.enemyOwnerByPet.has(rec.id))continue; // hostile cubes don't shoot their own guard animals
          consider(animalProjectileSegmentT(rec.obj,x0,y0,x1,y1,p.r),"wild",{aid:rec.id,a:rec.obj});
        }
      }else{
        for(const[pid,pl]of this.state.players){if(pid===p.ownerId||pl.dead)continue;consider(segmentCircleT(x0,y0,x1,y1,pl.x,pl.y,p.r+PLAYER_R),"pvp",{pid,pl});}
        const mx=(x0+x1)*.5,my=(y0+y1)*.5,range=Math.hypot(x1-x0,y1-y0)*.5+180;
        for(const rec of this.nearbyDynamic(mx,my,range,dynKinds)){
          if(rec.kind==="enemy")consider(segmentCircleT(x0,y0,x1,y1,rec.obj.x,rec.obj.y,p.r+rec.obj.r),"enemy",{eid:rec.id,en:rec.obj});
          else consider(animalProjectileSegmentT(rec.obj,x0,y0,x1,y1,p.r),"wild",{aid:rec.id,a:rec.obj});
        }
      }

      // Static world pieces compete by hit order, so a tree/rock in front of an animal blocks the shot.
      const mx=(x0+x1)*.5,my=(y0+y1)*.5,travel=Math.hypot(x1-x0,y1-y0),range=travel*.5+150;
      for(const solid of this.nearbySolids(mx,my,range)){
        if(solid.kind==="resource"){const r=this.state.resources.get(solid.id);if(!r||!r.alive)continue;}
        if(solid.kind==="gold"){const g=this.state.gold.get(solid.id);if(!g||(!g.infinite&&g.goldLeft<=0))continue;}
        if(solid.kind==="chest"){const c=this.state.chests.get(solid.id);if(!c||c.opened)continue;}
        consider(segmentCircleT(x0,y0,x1,y1,solid.x,solid.y,p.r+solid.r*.94),"solid",{solid});
      }
      for(const[wid,w]of this.state.walls){if(w.hp<=0)continue;consider(segmentCircleT(x0,y0,x1,y1,w.x,w.y,p.r+w.r),"wall",{wid,w});}

      if(best.t<=1){
        p.x=x0+(x1-x0)*best.t;p.y=y0+(y1-y0)*best.t;
        if(best.type==="player")this.damageTarget({kind:"player",id:best.pid},p.dmg,"projectile",p.ownerId);
        else if(best.type==="pet")this.damageTarget({kind:"pet",id:best.petId},p.dmg,"projectile",p.ownerId);
        else if(best.type==="pvp"){this.damageTarget({kind:"player",id:best.pid},p.dmg,"playerProjectile",p.ownerId);this.broadcastFx({kind:"hit",x:best.pl.x,y:best.pl.y-8,text:Math.round(p.dmg),color:"#8fd4ff"});}
        else if(best.type==="enemy"){this.hitEnemy(best.eid,best.en,p.dmg,p.ownerId);if(p.knock&&this.state.enemies.has(best.eid)){const a=Math.atan2(p.vy,p.vx);best.en.x+=Math.cos(a)*p.knock;best.en.y+=Math.sin(a)*p.knock;}}
        else if(best.type==="wild"){
          if(p.hostile){const a=best.a,dmg=animalDamageTaken(a.type,a.stage,p.dmg);a.hp=Math.max(0,a.hp-dmg);a.flash=.12;a.recentHit=4;a.sleeping=false;a.enraged=true;a.combat=8;if(a.hp<=0){this.state.animals.delete(best.aid);this.animalAggro.delete(best.aid);}}
          else{this.hitWild(best.aid,best.a,p.dmg,p.ownerId);if(p.knock&&this.state.animals.has(best.aid)){const q=Math.atan2(p.vy,p.vx);best.a.x+=Math.cos(q)*p.knock;best.a.y+=Math.sin(q)*p.knock;}}
        }
        this.state.projectiles.delete(id);
      }
    }
  }

  updateWallsTowers(dt){
    const now=this.state.worldTime;
    const wallEnemyKinds=new Set(["enemy"]),spikeKinds=new Set(["enemy","animal"]);
    for(const[id,w]of Array.from(this.state.walls.entries())){
      if(w.ttl>0)w.ttl-=dt;
      if(w.hp<=0||(w.ttl!==-1&&w.ttl<=0)){this.state.walls.delete(id);continue;}

      // Hostile cubes can eventually break any wall they are pressing against,
      // so permanent walls are permanent until damaged, not invincible exploits.
      let breaker=null;
      for(const rec of this.nearbyDynamic(w.x,w.y,w.r+90,wallEnemyKinds)){const en=rec.obj;if(!en||en.dead)continue;if(dist(w.x,w.y,en.x,en.y)<=w.r+en.r+4){breaker={eid:rec.id,en};break;}}
      if(breaker){const key=`${id}:${breaker.eid}`,next=this.wallEnemyNext.get(key)||0;if(now>=next){const wd=Math.max(2.5,(breaker.en.dmg||6)*.7);w.hp=Math.max(0,w.hp-wd);this.wallEnemyNext.set(key,now+.9);this.broadcastFx({kind:"hit",x:w.x,y:w.y,text:Math.round(wd),color:w.kind==="stoneSpike"?"#d9e0e6":"#c99a5b"});if(w.hp<=0){this.state.walls.delete(id);continue;}}}

      // Dog walls are spiked. They damage enemies/wildlife, never the owner or owner's pets.
      if(w.spiked&&w.spikeDmg>0){const next=this.wallSpikeNext.get(id)||0;if(now>=next){let hit=false;for(const rec of this.nearbyDynamic(w.x,w.y,w.r+110,spikeKinds)){const o=rec.obj;if(!o)continue;if(rec.kind==="enemy"){if(!o.dead&&dist(w.x,w.y,o.x,o.y)<=w.r+o.r+3){this.hitEnemy(rec.id,o,w.spikeDmg,w.ownerId,false);hit=true;break;}}else if(o.hp>0&&dist(w.x,w.y,o.x,o.y)<=w.r+o.r*.78+2){this.hitWild(rec.id,o,w.spikeDmg,w.ownerId,false);if(this.state.animals.has(rec.id)&&w.sourcePetId)this.animalAggro.set(rec.id,{kind:"pet",id:w.sourcePetId});hit=true;break;}}if(hit)this.wallSpikeNext.set(id,now+.55);}}
    }
    for(const[,t]of this.state.towers){t.cd-=dt;if(t.cd>0)continue;const target=this.nearestHostile(t.x,t.y,320);if(!target)continue;const a=angTo(t.x,t.y,target.obj.x,target.obj.y);this.addProjectile({x:t.x+Math.cos(a)*18,y:t.y+Math.sin(a)*18,vx:Math.cos(a)*520,vy:Math.sin(a)*520,life:.85,r:4,hostile:false,kind:"arrow",color:"#d4aa3a",dmg:9,ownerId:t.ownerId,petBlast:false,knock:0});t.cd=.8;}
  }

  updateTime(dt){this.state.worldTime+=dt;this.state.phaseTimer-=dt;if(this.state.phaseTimer<=0){this.state.dayPhase=(this.state.dayPhase+1)%TIME_PHASES.length;if(this.state.dayPhase===0)this.state.dayCount++;this.state.phaseTimer=TIME_PHASES[this.state.dayPhase].duration;this.broadcast("phaseEvent",{phase:this.state.dayPhase,dayCount:this.state.dayCount});}const phase=TIME_PHASES[this.state.dayPhase];if(phase.spawn){this.waveTimer-=dt;if(this.waveTimer<=0){this.state.wave++;this.waveTimer=phase.strong?6.5:8.5;const base=phase.strong?5:4,count=Math.min(base+Math.floor(this.state.wave*1.6),phase.strong?14:11);for(let i=0;i<count&&this.state.enemies.size<70;i++)this.addEnemy(phase.strong);if(phase.strong&&Math.random()<.45)for(let i=0;i<3&&this.state.enemies.size<70;i++)this.addEnemy(true);}}}

  update(dt){this.updateTime(dt);for(const[,p]of this.state.players)p.animalCarryT=Math.max(0,(p.animalCarryT||0)-dt);for(const[id,left]of Array.from(this.resourceRespawns.entries())){const n=left-dt;if(n<=0){const r=this.state.resources.get(id);if(r){r.hp=r.maxHp;r.alive=true;}this.resourceRespawns.delete(id);}else this.resourceRespawns.set(id,n);}for(const[,c]of this.state.chests)c.pulse=Math.max(0,c.pulse-dt*3);this.updateAnimals(dt);this.updatePets(dt);this.updateEnemies(dt);this.rebuildDynamicGrid();this.applyPlayerCreaturePushes();this.updateWallsTowers(dt);this.updateProjectiles(dt);this.flushNetworkEvents(dt);}

  onJoin(client,options={}){const s=this.safeSpawn(),p=new PlayerState();p.id=client.sessionId;p.username=String(options.username||"Cube").slice(0,14);p.x=s.x;p.y=s.y;p.angle=0;p.health=100;p.maxHealth=100;p.color=typeof options.color==="string"?options.color:"#3fa7ff";p.tool="Fist";this.state.players.set(client.sessionId,p);const start=String(options.startPet||"");const requestedStage=String(options.startPetStage||"baby");const startStage=["baby","adult","boss","superboss"].includes(requestedStage)?requestedStage:"baby";if(PET_TYPES[start])this.ensureStarterPetFor(client,start,startStage);client.send("serverReady",{fullWorld:true});}
  onLeave(client){this.state.players.delete(client.sessionId);this.chatLastSent.delete(client.sessionId);this.playerAttackCd.delete(client.sessionId);this.playerShootCd.delete(client.sessionId);this.playerCarryUntil.delete(client.sessionId);this.playerCarryAnimal.delete(client.sessionId);this.pendingPlayerHits.delete(client.sessionId);this.pendingAnimalPushes.delete(client.sessionId);const prefix=`${client.sessionId}:`;for(const k of Array.from(this.harvestCredits.keys()))if(k.startsWith(prefix))this.harvestCredits.delete(k);for(const k of Array.from(this.goldHandCredits.keys()))if(k.startsWith(prefix))this.goldHandCredits.delete(k);for(const[id,p]of Array.from(this.state.pets.entries()))if(p.ownerId===client.sessionId)this.state.pets.delete(id);}
}
