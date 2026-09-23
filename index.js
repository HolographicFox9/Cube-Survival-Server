import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom, getCubeServerStats, configureHostlAccountHooks } from "./WorldRoom.js";

const port = Number(process.env.PORT) || 2567;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
// Account records are server-authoritative. For true persistence across Render deploys/restarts,
// HOSTL_DATA_DIR should point at a mounted persistent disk (recommended: /var/data/hostl).
// Without a persistent mount, the fallback project data folder can be replaced by the host.
const DATA_DIR = String(process.env.HOSTL_DATA_DIR || path.join(__dirname, "data")).trim();
const ACCOUNT_FILE = path.join(DATA_DIR, "accounts.json");
const SESSION_SECRET = String(process.env.HOSTL_SESSION_SECRET || crypto.randomBytes(32).toString("hex"));
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

if (!process.env.HOSTL_SESSION_SECRET) {
  console.warn("HOSTL_SESSION_SECRET is not set. Login sessions will reset whenever the server restarts.");
}
if (!GOOGLE_CLIENT_ID) {
  console.warn("GOOGLE_CLIENT_ID is not set. Google Sign-In will remain disabled.");
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const ACCOUNT_STORAGE_PERSISTENT = !!process.env.HOSTL_DATA_DIR;
if (!ACCOUNT_STORAGE_PERSISTENT) {
  console.warn("HOSTL account storage is using the local filesystem fallback. Set HOSTL_DATA_DIR to a mounted persistent disk path for deploy-safe permanent accounts.");
}
function loadAccounts() {
  try {
    if (!fs.existsSync(ACCOUNT_FILE)) return { byId: {}, byGoogleSub: {}, globalCodeClaims: {}, friendChats: {}, tradeOffers: {} };
    const parsed = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8"));
    return {
      byId: parsed?.byId && typeof parsed.byId === "object" ? parsed.byId : {},
      byGoogleSub: parsed?.byGoogleSub && typeof parsed.byGoogleSub === "object" ? parsed.byGoogleSub : {},
      globalCodeClaims: parsed?.globalCodeClaims && typeof parsed.globalCodeClaims === "object" ? parsed.globalCodeClaims : {},
      friendChats: parsed?.friendChats && typeof parsed.friendChats === "object" ? parsed.friendChats : {},
      tradeOffers: parsed?.tradeOffers && typeof parsed.tradeOffers === "object" ? parsed.tradeOffers : {}
    };
  } catch (err) {
    console.error("Failed to load HOSTL accounts:", err);
    return { byId: {}, byGoogleSub: {}, globalCodeClaims: {}, friendChats: {}, tradeOffers: {} };
  }
}
let accountDb = loadAccounts();
let saveChain = Promise.resolve();
function saveAccounts() {
  saveChain = saveChain.then(async () => {
    const temp = `${ACCOUNT_FILE}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(accountDb, null, 2), "utf8");
    await fs.promises.rename(temp, ACCOUNT_FILE);
  }).catch(err => console.error("Failed to save HOSTL accounts:", err));
  return saveChain;
}
function safeText(value, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}
function cleanDisplayName(value) {
  const raw = safeText(value, 20).replace(/\s+/g, " ");
  const cleaned = raw.replace(/[^A-Za-z0-9 _\-.'!]/g, "").trim();
  return cleaned.slice(0, 20);
}
// HOSTL has exactly one account currency: Gold Cubits.
// Older builds stored this balance under `cubits`; migrate it once and keep only
// `goldCubits` as the canonical saved-account field going forward.
function ensureGoldCubits(a) {
  if (!a || typeof a !== "object") return 0;
  if (!Number.isFinite(Number(a.goldCubits))) a.goldCubits = Number.isFinite(Number(a.cubits)) ? Number(a.cubits) : 0;
  a.goldCubits = Math.max(0, Math.min(1000000000, Math.floor(Number(a.goldCubits) || 0)));
  if (Object.prototype.hasOwnProperty.call(a, "cubits")) delete a.cubits;
  return a.goldCubits;
}
function setGoldCubits(a, value) { a.goldCubits = Math.max(0, Math.min(1000000000, Math.floor(Number(value) || 0))); return a.goldCubits; }
function addGoldCubits(a, delta) { return setGoldCubits(a, ensureGoldCubits(a) + Math.floor(Number(delta) || 0)); }
function allocateNumericUserId(used = new Set(Object.keys(accountDb?.byId || {}))) {
  for (let tries = 0; tries < 5000; tries++) {
    const candidate = String(1 + Math.floor(Math.random() * 99999));
    if (!used.has(candidate)) return candidate;
  }
  for (let i = 1; i <= 99999; i++) {
    const candidate = String(i);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("HOSTL player ID space is full");
}
function ensureTitleState(a) {
  if (!Array.isArray(a.unlockedTitles)) a.unlockedTitles = [];
  a.unlockedTitles = [...new Set(a.unlockedTitles.map(x => safeText(x, 32)).filter(Boolean))].slice(0, 100);
  // Migrate special staff titles to their final public names.
  if (Math.max(0, Math.floor(Number(a.testerRank)||0)) === 1) {
    a.unlockedTitles = a.unlockedTitles.filter(t => t !== "Tester");
    if (!a.unlockedTitles.includes("#1 Tester")) a.unlockedTitles.push("#1 Tester");
    if (safeText(a.title,32) === "Tester" || !safeText(a.title,32)) a.title = "#1 Tester";
  }
  if (Math.max(0, Math.floor(Number(a.ownerRank)||0)) === 1) {
    if (!a.unlockedTitles.includes("Owner")) a.unlockedTitles.push("Owner");
    if (!safeText(a.title,32)) a.title = "Owner";
  }
  const current = safeText(a.title, 32);
  if (current && !a.unlockedTitles.includes(current)) a.unlockedTitles.push(current);
  if (current && !a.unlockedTitles.includes(current)) a.title = "";
  return a;
}

const STARTER_PET_STAGE_RANK = { baby:0, adult:1, boss:2, superboss:3, bigmomma:4 };
function ensureStarterPetEntitlements(a) {
  if (!a || typeof a !== "object") return [];
  const raw = Array.isArray(a.starterPetEntitlements) ? [...a.starterPetEntitlements] : [];
  if (a.starterPetEntitlement && typeof a.starterPetEntitlement === "object") raw.push(a.starterPetEntitlement);
  const byType = new Map();
  for (const ent of raw) {
    if (!ent || typeof ent !== "object") continue;
    const type = safeText(ent.type,24).toLowerCase();
    const stage = safeText(ent.stage,24).toLowerCase();
    if (!type) continue;
    const cleanStage = Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,stage) ? stage : "baby";
    const old = byType.get(type);
    if (!old || STARTER_PET_STAGE_RANK[cleanStage] > STARTER_PET_STAGE_RANK[old.stage]) byType.set(type,{type,stage:cleanStage});
  }
  a.starterPetEntitlements = [...byType.values()];
  // Legacy field is kept so older clients still receive at least one entitlement.
  a.starterPetEntitlement = a.starterPetEntitlements[0] || null;
  return a.starterPetEntitlements;
}
function grantStarterPetEntitlement(a,type,stage="baby") {
  const t=safeText(type,24).toLowerCase();
  const st=safeText(stage,24).toLowerCase();
  if(!t)return;
  const cleanStage=Object.prototype.hasOwnProperty.call(STARTER_PET_STAGE_RANK,st)?st:"baby";
  ensureStarterPetEntitlements(a);
  const found=a.starterPetEntitlements.find(x=>x.type===t);
  if(found){ if(STARTER_PET_STAGE_RANK[cleanStage]>STARTER_PET_STAGE_RANK[found.stage]) found.stage=cleanStage; }
  else a.starterPetEntitlements.push({type:t,stage:cleanStage});
  // Prefer the newly granted entitlement in the legacy field for older clients.
  a.starterPetEntitlement={type:t,stage:(a.starterPetEntitlements.find(x=>x.type===t)||{}).stage||cleanStage};
}
function repairSpecialPromoEntitlements(a) {
  if(!a || typeof a!=="object") return false;
  let changed=false;
  if(!a.specialRewardRepairs || typeof a.specialRewardRepairs!=="object" || Array.isArray(a.specialRewardRepairs)) a.specialRewardRepairs={};
  if(!a.speciesCards || typeof a.speciesCards!=="object" || Array.isArray(a.speciesCards)) a.speciesCards={};
  const codes=Array.isArray(a.redeemedCodes)?a.redeemedCodes.map(x=>String(x).toUpperCase()):[];
  const hasTester=codes.includes("SCCTT") || codes.includes("SCCTT2") || Math.max(0,Math.floor(Number(a.testerRank)||0))===1;
  if(hasTester){
    if(Math.max(0,Math.floor(Number(a.testerRank)||0))!==1){a.testerRank=1;changed=true;}
    ensureTitleState(a);
    if(!a.unlockedTitles.includes("#1 Tester")){a.unlockedTitles.push("#1 Tester");changed=true;}
    const before=JSON.stringify(ensureStarterPetEntitlements(a)); grantStarterPetEntitlement(a,"saber","adult");
    if(JSON.stringify(a.starterPetEntitlements)!==before)changed=true;
    if(!a.specialRewardRepairs.sccttSaberCardsV1){
      const old=Math.max(0,Math.floor(Number(a.speciesCards.saber)||0));
      if(old<500){a.speciesCards.saber=500;changed=true;}
      a.specialRewardRepairs.sccttSaberCardsV1=Date.now(); changed=true;
    }
  }
  const hasOwner=codes.includes("OVCC") || codes.includes("OVCC2") || Math.max(0,Math.floor(Number(a.ownerRank)||0))===1;
  if(hasOwner){
    if(Math.max(0,Math.floor(Number(a.ownerRank)||0))!==1){a.ownerRank=1;changed=true;}
    ensureTitleState(a);
    if(!a.unlockedTitles.includes("Owner")){a.unlockedTitles.push("Owner");changed=true;}
    const before=JSON.stringify(ensureStarterPetEntitlements(a)); grantStarterPetEntitlement(a,"snake","adult");
    if(JSON.stringify(a.starterPetEntitlements)!==before)changed=true;
    if(!a.specialRewardRepairs.ovccViperCardsV2){
      const old=Math.max(0,Math.floor(Number(a.speciesCards.snake)||0));
      if(old<500){a.speciesCards.snake=500;changed=true;}
      a.specialRewardRepairs.ovccViperCardsV2=Date.now(); changed=true;
    }
  }
  const hasSTC=codes.includes("STC");
  if(hasSTC){
    const before=JSON.stringify(ensureStarterPetEntitlements(a)); grantStarterPetEntitlement(a,"saber","adult");
    if(JSON.stringify(a.starterPetEntitlements)!==before)changed=true;
    if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
    if(!a.unlockedThemes.includes("celestialCrown")){a.unlockedThemes.push("celestialCrown");changed=true;}
    if(!a.specialRewardRepairs.stcSaberCardsV2){
      const old=Math.max(0,Math.floor(Number(a.speciesCards.saber)||0));
      if(old<500){a.speciesCards.saber=500;changed=true;}
      a.specialRewardRepairs.stcSaberCardsV2=Date.now(); changed=true;
    }
  }
  ensureStarterPetEntitlements(a);
  ensurePetProgressState(a);
  return changed;
}


const MATERIAL_CATALOG = {
  // Prices are balanced against normal high-skill play (~100–150 Gold Cubits/minute once waves are active).
  // Drops/chests are intentionally the efficient route; buying is the guaranteed route.
  leather:{name:"Leather",price:600,rarity:"Common"},
  resin:{name:"Hard Resin",price:725,rarity:"Common"},
  swiftFiber:{name:"Swift Fiber",price:1450,rarity:"Uncommon"},
  ironBuckle:{name:"Iron Buckle",price:1900,rarity:"Uncommon"},
  ironPlate:{name:"Iron Plate",price:3800,rarity:"Rare"},
  animalNotes:{name:"Animal Field Notes",price:3250,rarity:"Rare"},
  toolKit:{name:"Fine Tool Kit",price:8100,rarity:"Epic"},
  beastBook:{name:"Beast Language Book",price:10800,rarity:"Epic"},
  predatorStudy:{name:"Predator Study Kit",price:9500,rarity:"Epic"},
  sharpFang:{name:"Sharpened Fang",price:25000,rarity:"Legendary"},
  apexScale:{name:"Apex Scale",price:67500,rarity:"Mythical"}
};
const BUILD_RECIPES = {
  speedyBoots:{chance:.85,ingredients:{leather:4,swiftFiber:4,ironBuckle:2}},
  ironShell:{chance:.60,ingredients:{ironPlate:8,resin:5,leather:3}},
  hunterWrap:{chance:.75,ingredients:{leather:5,sharpFang:3,swiftFiber:3}},
  gatherGloves:{chance:.82,ingredients:{leather:4,swiftFiber:4,toolKit:1}},
  saddle:{chance:.92,ingredients:{leather:5,swiftFiber:2,ironBuckle:1}}
};
const LEARN_RECIPES = { animalWhisperer:{ingredients:{beastBook:1,animalNotes:5,predatorStudy:2,sharpFang:1}} };
const ANIMAL_RARITY={dog:"Common",cat:"Common",rabbit:"Common",wolf:"Uncommon",bear:"Uncommon",fox:"Uncommon",boar:"Rare",deer:"Rare",owl:"Rare",snake:"Legendary",saber:"Legendary",dragon:"Starter"};
const CHEST_SPECIES=["dog","cat","dragon","fox","wolf","bear","rabbit","owl","snake","deer","boar","saber"];
const CHEST_SPECIES_RARITY_WEIGHT={Common:2.4,Uncommon:1.5,Rare:.82,Legendary:.28,Starter:.55};
function chestSpeciesRarity(type){return ANIMAL_RARITY[type]||"Common";}
function randomChestSpecies(){
  const rows=CHEST_SPECIES.map(v=>({v,w:CHEST_SPECIES_RARITY_WEIGHT[chestSpeciesRarity(v)]||1}));
  let total=rows.reduce((n,x)=>n+x.w,0),roll=Math.random()*total;
  for(const row of rows){roll-=row.w;if(roll<=0)return row.v;}
  return rows[0]?.v||"dog";
}
const CHEST_THEMES=["fireElement","waterElement","lightningElement","powerElement","windElement","plantElement","stoneElement","earthElement","soundElement","arcticPulse","chromeWave","nightDrive","toxicReactor","solarPunk","viperwave","hologram","hyperwave","cyberCircuit","hacker","blackNeon","blackNight","thunderStorm","glitch","slime","auroraVale","prismTech","oceanAbyss","auroraBorealis","computerVirus","dragonForge","celestialCrown","titanStorm","goldenEclipse","saberFang","voidObsidian","bloodMoon","emberKingdom","crystalCavern","ancientRuins","explosion","castorianopsia"];
// Theme unlock assignment v1 (frozen).
// This list was randomized ONCE during development and is now hard-coded.
// Nothing here rolls, reshuffles, or changes a theme's unlock method at runtime.
// Classics stay free forever; every non-classic theme has exactly one fixed method.
const THEME_GUEST_FREE=new Set(["forestGold","blueEmber","sunsetJungle","royalStone","mossCream","lavaNight","mintTech","oceanCoral","frostPine","desertDusk","crimsonSteel","neonArcade"]);
const THEME_ACCOUNT_FREE=new Set(["stoneElement","strawberryMilk","honeyBee","candyComet","pumpkinMoon","arcticPulse","viperwave","hologram","hacker","blackNeon","thunderStorm","auroraVale","oceanAbyss","dragonForge","celestialCrown","goldenEclipse","crystalCavern","rainyWindow","owlNight","beardedDunes","moonPetal","kemonoCamp"]);
const THEME_AD=new Set(["waterElement","lightningElement","powerElement","windElement","soundElement","rabbitMeadow","cottonCandy","roseQuartz","nightDrive","hyperwave","blackNight","glitch","prismTech","auroraBorealis","emberKingdom","ancientRuins","explosion","castorianopsia","deerGrove","autumnHearth","goldenPrairie"]);
const THEME_GOLD=new Set(["fireElement","plantElement","earthElement","peachBunny","bubblegumSky","cozyPlush","blossomCandy","chromeWave","toxicReactor","solarPunk","cyberCircuit","slime","computerVirus","titanStorm","saberFang","voidObsidian","bloodMoon","sakuraBreeze","lavenderDream","quietMeadow","midnightGarden"]);
const THEME_ELEMENT=new Set(["fireElement","waterElement","lightningElement","powerElement","windElement","plantElement","stoneElement","earthElement","soundElement"]);
const THEME_EPIC=new Set(["dragonForge","celestialCrown","titanStorm","goldenEclipse","saberFang","voidObsidian","bloodMoon","emberKingdom","crystalCavern","ancientRuins","explosion","castorianopsia"]);
const THEME_COOL=new Set(["arcticPulse","chromeWave","nightDrive","toxicReactor","solarPunk","viperwave","hologram","hyperwave","cyberCircuit","hacker","blackNeon","blackNight","thunderStorm","glitch","slime","auroraVale","prismTech","oceanAbyss","auroraBorealis","computerVirus"]);
const THEME_CUTE=new Set(["strawberryMilk","peachBunny","bubblegumSky","honeyBee","cozyPlush","rabbitMeadow","blossomCandy","cottonCandy","candyComet","roseQuartz","pumpkinMoon"]);
const THEME_RELAX=new Set(["sakuraBreeze","lavenderDream","rainyWindow","quietMeadow","deerGrove","owlNight","beardedDunes","moonPetal","kemonoCamp","autumnHearth","midnightGarden","goldenPrairie"]);
function themeGoldPrice(id){
  if(THEME_ELEMENT.has(id))return 5900;
  if(THEME_EPIC.has(id))return ["bloodMoon","voidObsidian","goldenEclipse"].includes(id)?25200:18000;
  if(THEME_COOL.has(id))return ["glitch","hologram","hacker","computerVirus"].includes(id)?14400:9900;
  if(THEME_CUTE.has(id))return 7650;
  if(THEME_RELAX.has(id))return 8550;
  return 10800;
}
function isKnownTheme(id){return THEME_GUEST_FREE.has(id)||THEME_ACCOUNT_FREE.has(id)||THEME_AD.has(id)||THEME_GOLD.has(id);}
function accountCanUseTheme(a,id){return isKnownTheme(id) && (THEME_GUEST_FREE.has(id)||THEME_ACCOUNT_FREE.has(id)||(Array.isArray(a?.unlockedThemes)&&a.unlockedThemes.includes(id)));}

function ensureEconomyState(a){
  if(!a.materials||typeof a.materials!=="object"||Array.isArray(a.materials))a.materials={};
  for(const id of Object.keys(MATERIAL_CATALOG))a.materials[id]=Math.max(0,Math.min(100000,Math.floor(Number(a.materials[id])||0)));
  if(!Array.isArray(a.craftedStarters))a.craftedStarters=[]; a.craftedStarters=[...new Set(a.craftedStarters.map(x=>safeText(x,32)).filter(x=>BUILD_RECIPES[x]))];
  if(!Array.isArray(a.learnedSkills))a.learnedSkills=[]; a.learnedSkills=[...new Set(a.learnedSkills.map(x=>safeText(x,32)).filter(x=>LEARN_RECIPES[x]))];
  return a;
}
function ensurePetProgressState(a){
  if(!a || typeof a!=="object") return a;
  if(!a.speciesCards || typeof a.speciesCards!=="object" || Array.isArray(a.speciesCards)) a.speciesCards={};
  for(const [k,v] of Object.entries(a.speciesCards)) a.speciesCards[safeText(k,24).toLowerCase()]=Math.max(0,Math.min(1000000,Math.floor(Number(v)||0)));
  if(!a.ownedStarters || typeof a.ownedStarters!=="object" || Array.isArray(a.ownedStarters)) a.ownedStarters={};
  for(const k of Object.keys(a.ownedStarters)) a.ownedStarters[k]=!!a.ownedStarters[k];
  if(!a.petStages || typeof a.petStages!=="object" || Array.isArray(a.petStages)) a.petStages={};
  const validStages=new Set(["baby","adult","boss","superboss","bigmomma"]);
  for(const [k,v] of Object.entries(a.petStages)){ const s=safeText(v,20).toLowerCase(); a.petStages[k]=validStages.has(s)?s:"baby"; }
  if(!a.petStatUpgrades || typeof a.petStatUpgrades!=="object" || Array.isArray(a.petStatUpgrades)) a.petStatUpgrades={};
  for(const [species,stats0] of Object.entries(a.petStatUpgrades)){
    const stats=(stats0&&typeof stats0==="object"&&!Array.isArray(stats0))?stats0:{};
    const clean={}; for(const stat of ["health","defense","attack","weight","regen","speed"]) clean[stat]=Math.max(0,Math.min(10,Math.floor(Number(stats[stat])||0)));
    a.petStatUpgrades[species]=clean;
  }
  a.starterPetType=safeText(a.starterPetType||"",24).toLowerCase();
  a.starterPetName=safeText(a.starterPetName||"",20);
  a.starterPetGender=a.starterPetGender==="Female"?"Female":"Male";
  return a;
}
function hasIngredients(a,ingredients){ensureEconomyState(a);return Object.entries(ingredients||{}).every(([id,n])=>(a.materials[id]||0)>=n);}
function consumeIngredients(a,ingredients){ensureEconomyState(a);for(const [id,n] of Object.entries(ingredients||{}))a.materials[id]=Math.max(0,(a.materials[id]||0)-n);}
function addMaterial(a,id,n){ensureEconomyState(a);if(MATERIAL_CATALOG[id])a.materials[id]=Math.min(100000,(a.materials[id]||0)+Math.max(0,Math.floor(Number(n)||0)));}
const MATERIAL_RARITY_WEIGHT={Common:48,Uncommon:28,Rare:14,Epic:7,Legendary:2.5,Mythical:.5};
function randomMaterialId(multiplier=1){
  const entries=Object.entries(MATERIAL_CATALOG).map(([id,m])=>[id,Math.max(.05,(MATERIAL_RARITY_WEIGHT[m.rarity]||1)*multiplier)]);
  let total=entries.reduce((a,[,w])=>a+w,0),roll=Math.random()*total;
  for(const [id,w] of entries){roll-=w;if(roll<=0)return id;}
  return entries[0]?.[0]||"leather";
}
async function rewardGameplayMaterial(userId,id,qty,source="gameplay"){
  const a=accountDb.byId[String(userId||"")]; if(!a||!MATERIAL_CATALOG[id])return {granted:false};
  addMaterial(a,id,qty); a.updatedAt=new Date().toISOString(); await saveAccounts();
  return {granted:true,id,qty:Math.max(1,Math.floor(Number(qty)||1)),name:MATERIAL_CATALOG[id].name,rarity:MATERIAL_CATALOG[id].rarity,source,account:publicAccount(a)};
}

// The material shop is one shared deterministic stock rotation for everyone.
// A rotation lasts exactly two UTC days. Duplicate material slots are intentional.
const SHOP_ROTATION_MS = 2 * 24 * 60 * 60 * 1000;
const SHOP_SLOT_COUNT = 30;
const SHOP_STOCK_WEIGHT = { Common:34, Uncommon:26, Rare:18, Epic:12, Legendary:7, Mythical:3 };
function shopRotationInfo(now=Date.now()) {
  const rotationId = Math.floor(Number(now) / SHOP_ROTATION_MS);
  return { rotationId, startsAt: rotationId * SHOP_ROTATION_MS, nextRefreshAt: (rotationId + 1) * SHOP_ROTATION_MS };
}
function seededShopRandom(seed) {
  let t = (Number(seed) ^ 0x6D2B79F5) >>> 0;
  return function(){ t += 0x6D2B79F5; let x=t; x=Math.imul(x^(x>>>15),x|1); x^=x+Math.imul(x^(x>>>7),x|61); return ((x^(x>>>14))>>>0)/4294967296; };
}
function weightedShopMaterial(rand) {
  const entries=Object.entries(MATERIAL_CATALOG).map(([id,m])=>[id,Math.max(.1,SHOP_STOCK_WEIGHT[m.rarity]||1)]);
  let total=entries.reduce((a,[,w])=>a+w,0), roll=rand()*total;
  for(const [id,w] of entries){ roll-=w; if(roll<=0)return id; }
  return entries[0]?.[0]||"leather";
}
function generateShopStock(rotationId) {
  const rand=seededShopRandom((rotationId+1)*104729);
  const ids=[];
  // Always give the rotation useful coverage, then fill the rest by rarity weight.
  const guaranteed=["leather","resin","swiftFiber","ironBuckle","ironPlate","animalNotes","toolKit","beastBook","predatorStudy","sharpFang"];
  for(const id of guaranteed) if(MATERIAL_CATALOG[id]) ids.push(id);
  // Mythical appears in about half of rotations; it remains obtainable from gameplay/chests even when absent.
  if(MATERIAL_CATALOG.apexScale && rand()<0.5) ids.push("apexScale");
  while(ids.length<SHOP_SLOT_COUNT) ids.push(weightedShopMaterial(rand));
  // Deterministically shuffle so guaranteed items are not always at the top.
  for(let i=ids.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [ids[i],ids[j]]=[ids[j],ids[i]]; }
  return ids.map((materialId,index)=>{
    const m=MATERIAL_CATALOG[materialId];
    return { slotId:`${rotationId}:${index}`, materialId, name:m.name, rarity:m.rarity, price:m.price, index };
  });
}
function ensureShopPurchases(a) {
  if(!a.shopPurchases || typeof a.shopPurchases!=="object" || Array.isArray(a.shopPurchases)) a.shopPurchases={};
  const current=shopRotationInfo().rotationId;
  for(const key of Object.keys(a.shopPurchases)) if(Number(key)<current-1 || Number(key)>current) delete a.shopPurchases[key];
  return a.shopPurchases;
}
function purchasedShopSlots(a, rotationId) {
  const map=ensureShopPurchases(a); const key=String(rotationId);
  if(!Array.isArray(map[key])) map[key]=[];
  map[key]=[...new Set(map[key].map(x=>String(x||"")).filter(Boolean))].slice(0,SHOP_SLOT_COUNT);
  return map[key];
}

function ensureSocialState(a) {
  if (!a || typeof a !== "object") return a;
  const cleanIds = arr => [...new Set((Array.isArray(arr) ? arr : []).map(x=>String(x||"")).filter(x=>/^\d{1,5}$/.test(x)))].slice(0,200);
  a.friends = cleanIds(a.friends);
  a.incomingFriendRequests = cleanIds(a.incomingFriendRequests).filter(id=>!a.friends.includes(id));
  a.outgoingFriendRequests = cleanIds(a.outgoingFriendRequests).filter(id=>!a.friends.includes(id));
  return a;
}
const WEB_PRESENCE = new Map();
const GAME_PRESENCE = new Map();
function markWebPresence(uid){ WEB_PRESENCE.set(String(uid), Date.now()); }
function isWebOnline(uid){ const t=WEB_PRESENCE.get(String(uid))||0; if(Date.now()-t>45000){ WEB_PRESENCE.delete(String(uid)); return false; } return true; }
function markGamePresence(uid,key,worldId){
  uid=String(uid||""); key=String(key||""); if(!uid||!key)return;
  if(!GAME_PRESENCE.has(uid)) GAME_PRESENCE.set(uid,new Map());
  GAME_PRESENCE.get(uid).set(key,{worldId:safeText(worldId,24)||"world1",at:Date.now()});
}
function clearGamePresence(uid,key){ uid=String(uid||""); const m=GAME_PRESENCE.get(uid); if(!m)return; m.delete(String(key||"")); if(!m.size)GAME_PRESENCE.delete(uid); }
function presenceFor(uid){
  const m=GAME_PRESENCE.get(String(uid)); const first=m&&m.size?[...m.values()][0]:null;
  return { online:!!first || isWebOnline(uid), playing:!!first, worldId:first?.worldId||"" };
}
function friendChatKey(a,b){ return [String(a),String(b)].sort((x,y)=>Number(x)-Number(y)).join(":"); }
function areFriends(a,b){ const aa=accountDb.byId[String(a)]; return !!aa && ensureSocialState(aa).friends.includes(String(b)); }
function friendPublicSummary(uid){
  const a=accountDb.byId[String(uid)]; if(!a)return null; ensureSocialState(a); const p=presenceFor(uid);
  return { userId:a.userId, username:a.username||"", displayName:a.displayName||"", title:a.title||"", online:p.online, playing:p.playing, worldId:p.worldId };
}
function socialRequestSummary(uid){ const a=accountDb.byId[String(uid)]; return a?{userId:a.userId,username:a.username||"",displayName:a.displayName||"",title:a.title||""}:null; }
function normalizedTransferPart(raw){
  const obj=raw&&typeof raw==="object"?raw:{};
  const goldCubits=Math.max(0,Math.min(100000000,Math.floor(Number(obj.goldCubits ?? obj.cubits)||0)));
  const species=safeText(obj.species,24).toLowerCase();
  const cards=Math.max(0,Math.min(1000000,Math.floor(Number(obj.cards)||0)));
  return {goldCubits,species,cards};
}
function hasTransfer(a,part){
  if(!a)return false; if(ensureGoldCubits(a)<part.goldCubits)return false;
  if(part.cards>0){ const owned=Math.floor(Number(a.speciesCards?.[part.species])||0); if(!part.species||owned<part.cards)return false; }
  return true;
}
function applyTransfer(from,to,part){
  if(part.goldCubits>0){ setGoldCubits(from,ensureGoldCubits(from)-part.goldCubits); addGoldCubits(to,part.goldCubits); }
  if(part.cards>0&&part.species){ if(!from.speciesCards||typeof from.speciesCards!=="object")from.speciesCards={}; if(!to.speciesCards||typeof to.speciesCards!=="object")to.speciesCards={}; from.speciesCards[part.species]=Math.max(0,Math.floor(Number(from.speciesCards[part.species])||0)-part.cards); to.speciesCards[part.species]=Math.max(0,Math.floor(Number(to.speciesCards[part.species])||0)+part.cards); }
}
function normalizeLoadedAccounts() {
  const oldById = accountDb.byId || {};
  const newById = {};
  const idMap = new Map();
  const used = new Set();
  for (const [oldId, a0] of Object.entries(oldById)) {
    const a = a0 && typeof a0 === "object" ? a0 : {};
    let newId = /^\d{1,5}$/.test(String(oldId)) && !used.has(String(oldId)) ? String(oldId) : allocateNumericUserId(used);
    used.add(newId);
    idMap.set(String(oldId), newId);
    a.userId = newId;
    a.username = cleanDisplayName(a.username || "");
    a.displayName = cleanDisplayName(a.displayName || "");
    ensureTitleState(a);
    ensureEconomyState(a);
    ensurePetProgressState(a);
    ensureSocialState(a);
    newById[newId] = a;
  }
  accountDb.byId = newById;
  const newByGoogleSub = {};
  for (const [sub, oldId] of Object.entries(accountDb.byGoogleSub || {})) {
    const mapped = idMap.get(String(oldId));
    if (mapped && newById[mapped]) newByGoogleSub[sub] = mapped;
  }
  accountDb.byGoogleSub = newByGoogleSub;
  const newClaims = {};
  for (const [code, oldId] of Object.entries(accountDb.globalCodeClaims || {})) {
    newClaims[code] = idMap.get(String(oldId)) || String(oldId);
  }
  accountDb.globalCodeClaims = newClaims;
}
normalizeLoadedAccounts();
for (const a of Object.values(accountDb.byId || {})) {
  ensureGoldCubits(a);
  ensurePetProgressState(a);
  repairSpecialPromoEntitlements(a);
}
saveAccounts();

// Deploy-safe account recovery backup.
// Render's free web-service filesystem can be replaced during a deploy. HOSTL therefore
// gives the browser an HMAC-signed snapshot of the account after every account response.
// On the next Google sign-in, that snapshot can rebuild the SAME Google-linked account
// if the server-side accounts.json disappeared. The browser cannot edit the snapshot
// without invalidating the signature, and Google identity must still match before restore.
function recoverySubHash(googleSub) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(`hostl-account-recovery-sub:${String(googleSub||"")}`).digest("base64url");
}
function accountRecoverySnapshot(a) {
  ensureGoldCubits(a); ensureTitleState(a); ensureEconomyState(a); ensurePetProgressState(a); ensureSocialState(a); ensureStarterPetEntitlements(a); ensureShopPurchases(a); ensureRedeemedCodes(a);
  const cloneObj = value => JSON.parse(JSON.stringify(value && typeof value === "object" ? value : {}));
  return {
    userId:String(a.userId||""),
    username:cleanDisplayName(a.username||"").slice(0,14),
    displayName:cleanDisplayName(a.displayName||""),
    profileNamesInitialized:!!a.profileNamesInitialized,
    goldCubits:ensureGoldCubits(a),
    unlockedThemes:Array.isArray(a.unlockedThemes)?[...new Set(a.unlockedThemes.map(x=>safeText(x,40)).filter(Boolean))].slice(0,100):[],
    selectedTheme:accountCanUseTheme(a,safeText(a.selectedTheme||"",40))?safeText(a.selectedTheme,40):"",
    achievements:cloneObj(a.achievements),
    lastDailyCubits:safeText(a.lastDailyCubits||"",20),
    lastDailyChest:safeText(a.lastDailyChest||"",20),
    redeemedCodes:[...ensureRedeemedCodes(a)],
    speciesCards:cloneObj(a.speciesCards),
    ownedStarters:cloneObj(a.ownedStarters),
    petStages:cloneObj(a.petStages),
    petStatUpgrades:cloneObj(a.petStatUpgrades),
    starterPetType:safeText(a.starterPetType||"",24).toLowerCase(),
    starterPetName:safeText(a.starterPetName||"",20),
    starterPetGender:a.starterPetGender==="Female"?"Female":"Male",
    materials:cloneObj(a.materials),
    craftedStarters:Array.isArray(a.craftedStarters)?[...a.craftedStarters]:[],
    learnedSkills:Array.isArray(a.learnedSkills)?[...a.learnedSkills]:[],
    title:safeText(a.title||"",32),
    unlockedTitles:Array.isArray(a.unlockedTitles)?[...a.unlockedTitles]:[],
    testerRank:Math.max(0,Math.floor(Number(a.testerRank)||0)),
    ownerRank:Math.max(0,Math.floor(Number(a.ownerRank)||0)),
    starterPetEntitlements:ensureStarterPetEntitlements(a).map(x=>({...x})),
    starterPetEntitlement:a.starterPetEntitlement&&typeof a.starterPetEntitlement==="object"?{...a.starterPetEntitlement}:null,
    specialRewardRepairs:cloneObj(a.specialRewardRepairs),
    shopPurchases:cloneObj(a.shopPurchases),
    friends:[...ensureSocialState(a).friends],
    incomingFriendRequests:[...a.incomingFriendRequests],
    outgoingFriendRequests:[...a.outgoingFriendRequests],
    createdAt:safeText(a.createdAt||new Date().toISOString(),40)
  };
}
function signAccountRecovery(a) {
  if(!a?.googleSub) return "";
  const payload={v:1,iat:Date.now(),subHash:recoverySubHash(a.googleSub),account:accountRecoverySnapshot(a)};
  const body=b64url(JSON.stringify(payload));
  const sig=crypto.createHmac("sha256",SESSION_SECRET).update(`hostl-recovery:${body}`).digest("base64url");
  return `${body}.${sig}`;
}
function verifyAccountRecoveryToken(token,googleSub) {
  try{
    const [body,sig]=String(token||"").split(".");
    if(!body||!sig)return null;
    const expected=crypto.createHmac("sha256",SESSION_SECRET).update(`hostl-recovery:${body}`).digest("base64url");
    const aa=Buffer.from(sig),bb=Buffer.from(expected); if(aa.length!==bb.length||!crypto.timingSafeEqual(aa,bb))return null;
    const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
    if(Number(payload?.v)!==1 || payload?.subHash!==recoverySubHash(googleSub) || !payload?.account || typeof payload.account!=="object") return null;
    return payload;
  }catch(_){return null;}
}
function restoreAccountFromRecovery(payload,googleProfile) {
  const snap=payload?.account||{};
  const desired=/^\d{1,5}$/.test(String(snap.userId||""))?String(snap.userId):"";
  let userId=desired && !accountDb.byId[desired] ? desired : allocateNumericUserId();
  const a={
    userId, googleSub:googleProfile.sub,
    username:cleanDisplayName(snap.username||"").slice(0,14), displayName:cleanDisplayName(snap.displayName||""), profileNamesInitialized:!!snap.profileNamesInitialized,
    email:safeText(googleProfile.email,120).toLowerCase(), picture:safeText(googleProfile.picture,500),
    goldCubits:Math.max(0,Math.min(1000000000,Math.floor(Number(snap.goldCubits)||0))),
    unlockedThemes:Array.isArray(snap.unlockedThemes)?snap.unlockedThemes:[], selectedTheme:safeText(snap.selectedTheme||"",40), achievements:(snap.achievements&&typeof snap.achievements==="object"&&!Array.isArray(snap.achievements))?snap.achievements:{},
    lastDailyCubits:safeText(snap.lastDailyCubits||"",20), lastDailyChest:safeText(snap.lastDailyChest||"",20), redeemedCodes:Array.isArray(snap.redeemedCodes)?snap.redeemedCodes:[],
    speciesCards:(snap.speciesCards&&typeof snap.speciesCards==="object"&&!Array.isArray(snap.speciesCards))?snap.speciesCards:{}, ownedStarters:(snap.ownedStarters&&typeof snap.ownedStarters==="object"&&!Array.isArray(snap.ownedStarters))?snap.ownedStarters:{},
    petStages:(snap.petStages&&typeof snap.petStages==="object"&&!Array.isArray(snap.petStages))?snap.petStages:{}, petStatUpgrades:(snap.petStatUpgrades&&typeof snap.petStatUpgrades==="object"&&!Array.isArray(snap.petStatUpgrades))?snap.petStatUpgrades:{},
    starterPetType:safeText(snap.starterPetType||"",24).toLowerCase(), starterPetName:safeText(snap.starterPetName||"",20), starterPetGender:snap.starterPetGender==="Female"?"Female":"Male",
    materials:(snap.materials&&typeof snap.materials==="object"&&!Array.isArray(snap.materials))?snap.materials:{}, craftedStarters:Array.isArray(snap.craftedStarters)?snap.craftedStarters:[], learnedSkills:Array.isArray(snap.learnedSkills)?snap.learnedSkills:[],
    title:safeText(snap.title||"",32), unlockedTitles:Array.isArray(snap.unlockedTitles)?snap.unlockedTitles:[], testerRank:Math.max(0,Math.floor(Number(snap.testerRank)||0)), ownerRank:Math.max(0,Math.floor(Number(snap.ownerRank)||0)),
    starterPetEntitlements:Array.isArray(snap.starterPetEntitlements)?snap.starterPetEntitlements:[], starterPetEntitlement:snap.starterPetEntitlement&&typeof snap.starterPetEntitlement==="object"?snap.starterPetEntitlement:null,
    specialRewardRepairs:(snap.specialRewardRepairs&&typeof snap.specialRewardRepairs==="object"&&!Array.isArray(snap.specialRewardRepairs))?snap.specialRewardRepairs:{},
    shopPurchases:(snap.shopPurchases&&typeof snap.shopPurchases==="object"&&!Array.isArray(snap.shopPurchases))?snap.shopPurchases:{},
    friends:Array.isArray(snap.friends)?snap.friends:[], incomingFriendRequests:Array.isArray(snap.incomingFriendRequests)?snap.incomingFriendRequests:[], outgoingFriendRequests:Array.isArray(snap.outgoingFriendRequests)?snap.outgoingFriendRequests:[],
    createdAt:safeText(snap.createdAt||new Date().toISOString(),40), updatedAt:new Date().toISOString()
  };
  ensureGoldCubits(a); ensureTitleState(a); ensureEconomyState(a); ensurePetProgressState(a); ensureSocialState(a); ensureStarterPetEntitlements(a); ensureShopPurchases(a); ensureRedeemedCodes(a); repairSpecialPromoEntitlements(a);
  if(!accountCanUseTheme(a,a.selectedTheme)) a.selectedTheme="";
  accountDb.byId[userId]=a; accountDb.byGoogleSub[googleProfile.sub]=userId;
  // Rebuild global one-use code ownership when its rightful signed account returns after storage loss.
  for(const code of a.redeemedCodes){const def=PROMO_CODES.get(String(code).toUpperCase());if(def?.globalOnce&&!accountDb.globalCodeClaims[String(code).toUpperCase()])accountDb.globalCodeClaims[String(code).toUpperCase()]=userId;}
  return a;
}
function publicAccount(a) {
  return {
    userId: a.userId,
    username: a.username || "",
    displayName: a.displayName || "",
    email: a.email || "",
    picture: a.picture || "",
    goldCubits: ensureGoldCubits(a),
    unlockedThemes: Array.isArray(a.unlockedThemes) ? a.unlockedThemes : [],
    selectedTheme: accountCanUseTheme(a, safeText(a.selectedTheme||"",40)) ? safeText(a.selectedTheme,40) : "",
    achievements: a.achievements && typeof a.achievements === "object" ? a.achievements : {},
    lastDailyCubits: a.lastDailyCubits || "",
    lastDailyChest: a.lastDailyChest || "",
    createdAt: a.createdAt || "",
    title: a.title || "",
    unlockedTitles: Array.isArray(a.unlockedTitles) ? a.unlockedTitles : [],
    testerRank: Math.max(0, Math.floor(Number(a.testerRank) || 0)),
    ownerRank: Math.max(0, Math.floor(Number(a.ownerRank) || 0)),
    speciesCards: ensurePetProgressState(a).speciesCards,
    ownedStarters: {...a.ownedStarters},
    petStages: {...a.petStages},
    petStatUpgrades: JSON.parse(JSON.stringify(a.petStatUpgrades||{})),
    starterPetType: a.starterPetType||"",
    starterPetName: a.starterPetName||"",
    starterPetGender: a.starterPetGender||"Male",
    materials: ensureEconomyState(a).materials,
    craftedStarters: [...a.craftedStarters],
    learnedSkills: [...a.learnedSkills],
    starterPetEntitlements: ensureStarterPetEntitlements(a).map(x=>({...x})),
    starterPetEntitlement: a.starterPetEntitlement && typeof a.starterPetEntitlement === "object" ? {...a.starterPetEntitlement} : null,
    friendCount: ensureSocialState(a).friends.length,
    recoveryToken: signAccountRecovery(a)
  };
}
function b64url(input) {
  return Buffer.from(input).toString("base64url");
}
function signSession(userId) {
  const body = b64url(JSON.stringify({ uid: userId, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifySession(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.uid || Number(payload.exp) < Date.now()) return null;
    return accountDb.byId[payload.uid] ? payload.uid : null;
  } catch (_) { return null; }
}
function cookieValue(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const piece of raw.split(";")) {
    const i = piece.indexOf("=");
    if (i < 0) continue;
    const k = piece.slice(0, i).trim();
    if (k !== name) continue;
    try { return decodeURIComponent(piece.slice(i + 1).trim()); } catch (_) { return piece.slice(i + 1).trim(); }
  }
  return "";
}
function requestSessionToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return cookieValue(req, "hostl_session");
}
function setSessionCookie(res, token) {
  // HttpOnly keeps game JavaScript from accidentally deleting or exposing the session.
  res.setHeader("Set-Cookie", `hostl_session=${encodeURIComponent(token)}; Max-Age=${60*60*24*30}; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "hostl_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
}
function requireAccount(req, res, next) {
  const token = requestSessionToken(req);
  const uid = verifySession(token);
  if (!uid) return res.status(401).json({ ok: false, error: "not_authenticated" });
  req.hostlUserId = uid;
  req.hostlSessionToken = token;
  next();
}
function utcDayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function applyDailyCubits(account) {
  const today = utcDayKey();
  if (account.lastDailyCubits === today) return false;
  account.lastDailyCubits = today;
  addGoldCubits(account, 10);
  return true;
}

// Official HOSTL promo codes. Add future codes here and redeploy.
// Rewards are applied server-side so each account can only claim a code once.
const PROMO_CODES = new Map([
  ["HOSTLSTART", { goldCubits: 150, themes: ["Golden"], label: "+150 Gold Cubits and the Golden theme" }],
  ["SCCTT", {
    goldCubits: 14000,
    speciesCards: { saber: 500 },
    title: "#1 Tester",
    testerRank: 1,
    starterPetEntitlement: { type: "saber", stage: "adult" },
    globalOnce: true,
    label: "+14,000 Gold Cubits, +500 Saber Cards, Adult Saber starter access, and the #1 Tester title"
  }],
  ["SCCTT2", {
    goldCubits: 14000,
    speciesCards: { saber: 500 },
    title: "#1 Tester",
    testerRank: 1,
    starterPetEntitlement: { type: "saber", stage: "adult" },
    globalOnce: true,
    label: "+14,000 Gold Cubits, +500 Saber Cards, Adult Saber starter access, and the #1 Tester title"
  }],
  ["OVCC", {
    goldCubits: 10000,
    speciesCards: { snake: 500 },
    title: "Owner",
    ownerRank: 1,
    starterPetEntitlement: { type: "snake", stage: "adult" },
    globalOnce: true,
    label: "+10,000 Gold Cubits, +500 Viper Cards, Adult Viper starter access, and the Owner title"
  }],
  ["OVCC2", {
    goldCubits: 10000,
    speciesCards: { snake: 500 },
    title: "Owner",
    ownerRank: 1,
    starterPetEntitlement: { type: "snake", stage: "adult" },
    globalOnce: true,
    label: "+10,000 Gold Cubits, +500 Viper Cards, Adult Viper starter access, and the Owner title"
  }],
  ["STC", {
    speciesCards: { saber: 500 },
    themes: ["celestialCrown"],
    starterPetEntitlement: { type: "saber", stage: "adult" },
    globalOnce: true,
    label: "+500 Saber Cards, Adult Saber starter access, and the Celestial Crown theme"
  }]
]);
function normalizePromoCode(value) {
  return safeText(value, 32).toUpperCase().replace(/\s+/g, "");
}
function ensureRedeemedCodes(account) {
  if (!Array.isArray(account.redeemedCodes)) account.redeemedCodes = [];
  return account.redeemedCodes;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, game: "HOSTL", multiplayer: true, serverBuild: 567, gameBuild: 639, rulesVersion: "598", chat: true, googleAuth: !!GOOGLE_CLIENT_ID, accountStoragePersistent: ACCOUNT_STORAGE_PERSISTENT, accountRecoveryBackup: true, accountDataDir: DATA_DIR, ...getCubeServerStats() });
});

app.get("/status", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, ...getCubeServerStats(), maxPlayersPerRoom: 12, serverBuild: 567, gameBuild: 639 });
});

app.get("/auth/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, googleClientId: GOOGLE_CLIENT_ID || "" });
});

app.post("/auth/google", async (req, res) => {
  if (!googleClient || !GOOGLE_CLIENT_ID) return res.status(503).json({ ok: false, error: "google_auth_not_configured" });
  const credential = safeText(req.body?.credential, 10000);
  if (!credential) return res.status(400).json({ ok: false, error: "missing_credential" });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p?.sub || !p?.email) return res.status(401).json({ ok: false, error: "invalid_google_account" });

    let userId = accountDb.byGoogleSub[p.sub];
    let account = userId ? accountDb.byId[userId] : null;
    let created = false;
    let recovered = false;
    if (!account) {
      const supplied = Array.isArray(req.body?.recoveryTokens) ? req.body.recoveryTokens.slice(0,8) : (req.body?.recoveryToken ? [req.body.recoveryToken] : []);
      let bestRecovery = null;
      for (const raw of supplied) {
        const candidate=verifyAccountRecoveryToken(safeText(raw,180000),p.sub);
        if(candidate && (!bestRecovery || Number(candidate.iat||0)>Number(bestRecovery.iat||0))) bestRecovery=candidate;
      }
      if(bestRecovery){
        account=restoreAccountFromRecovery(bestRecovery,p); userId=account.userId; recovered=true;
      }
    }
    if (!account) {
      created = true;
      userId = allocateNumericUserId();
      account = {
        userId,
        googleSub: p.sub,
        username: "",
        displayName: "",
        profileNamesInitialized: true,
        email: safeText(p.email, 120).toLowerCase(),
        picture: safeText(p.picture, 500),
        goldCubits: 500,
        unlockedThemes: [],
        selectedTheme: "forestGold",
        achievements: {},
        lastDailyCubits: "",
        lastDailyChest: "",
        redeemedCodes: [],
        speciesCards: {},
        ownedStarters: {}, petStages: {}, petStatUpgrades: {}, starterPetType:"", starterPetName:"", starterPetGender:"Male",
        materials: {}, craftedStarters: [], learnedSkills: [],
        title: "",
        unlockedTitles: [],
        testerRank: 0,
        ownerRank: 0,
        starterPetEntitlement: null,
        friends: [], incomingFriendRequests: [], outgoingFriendRequests: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      accountDb.byId[userId] = account;
      accountDb.byGoogleSub[p.sub] = userId;
    } else {
      account.email = safeText(p.email, 120).toLowerCase();
      account.picture = safeText(p.picture, 500);
      // Username and Display Name are HOSTL profile fields chosen by the player.
      // They are intentionally NOT connected to the Google profile name.
      if (!account.profileNamesInitialized) {
        const oldGoogleName = cleanDisplayName(p.given_name || p.name || "");
        const oldUser = cleanDisplayName(account.username || "");
        const oldDisplay = cleanDisplayName(account.displayName || "");
        // Migrate old test accounts that were auto-filled from Google by older HOSTL builds.
        if (oldGoogleName && oldUser === oldGoogleName) account.username = "";
        else account.username = oldUser;
        if (oldGoogleName && oldDisplay === oldGoogleName) account.displayName = "";
        else account.displayName = oldDisplay;
        account.profileNamesInitialized = true;
      } else {
        account.username = cleanDisplayName(account.username || "");
        account.displayName = cleanDisplayName(account.displayName || "");
      }
      ensureTitleState(account);
      ensureEconomyState(account);
      ensureSocialState(account);
      repairSpecialPromoEntitlements(account);
      account.updatedAt = new Date().toISOString();
    }
    const dailyGranted = applyDailyCubits(account);
    await saveAccounts();
    const sessionToken = signSession(userId);
    setSessionCookie(res, sessionToken);
    res.json({ ok: true, created, recovered, dailyGranted, token: sessionToken, account: publicAccount(account) });
  } catch (err) {
    console.error("Google login failed:", err?.message || err);
    res.status(401).json({ ok: false, error: "google_verification_failed" });
  }
});

app.get("/api/account", requireAccount, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const a=accountDb.byId[req.hostlUserId];
  if(repairSpecialPromoEntitlements(a)){a.updatedAt=new Date().toISOString();await saveAccounts();}
  // Returning the already-verified token lets the browser restore its local copy from
  // the HttpOnly cookie after a reload without asking Google to sign in again.
  res.json({ ok: true, token: req.hostlSessionToken, account: publicAccount(a) });
});

app.post("/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok:true });
});

app.put("/api/account", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  const body = req.body || {};
  if (typeof body.username === "string") {
    const nextUsername = cleanDisplayName(body.username).slice(0, 14);
    if (nextUsername.length >= 2) { a.username = nextUsername; a.profileNamesInitialized = true; }
  }
  if (typeof body.displayName === "string") {
    const nextName = cleanDisplayName(body.displayName);
    if (nextName.length >= 2) { a.displayName = nextName; a.profileNamesInitialized = true; }
  }
  ensureTitleState(a);
  if (typeof body.title === "string") {
    const requestedTitle = safeText(body.title, 32);
    if (!requestedTitle) a.title = "";
    else if (a.unlockedTitles.includes(requestedTitle)) a.title = requestedTitle;
  }
  if (Number.isFinite(Number(body.goldCubits))) setGoldCubits(a, body.goldCubits);
  else if (Number.isFinite(Number(body.cubits))) setGoldCubits(a, body.cubits); // legacy client compatibility
  if (Array.isArray(body.unlockedThemes)) a.unlockedThemes = [...new Set(body.unlockedThemes.map(x => safeText(x, 40)).filter(Boolean))].slice(0, 100);
  if (typeof body.selectedTheme === "string") {
    const requestedTheme=safeText(body.selectedTheme,40);
    if(accountCanUseTheme(a,requestedTheme)) a.selectedTheme=requestedTheme;
  }
  if (body.achievements && typeof body.achievements === "object" && !Array.isArray(body.achievements)) a.achievements = body.achievements;
  if (typeof body.lastDailyCubits === "string") a.lastDailyCubits = safeText(body.lastDailyCubits, 20);
  if (typeof body.lastDailyChest === "string") a.lastDailyChest = safeText(body.lastDailyChest, 20);
  if (body.speciesCards && typeof body.speciesCards === "object" && !Array.isArray(body.speciesCards)) {
    if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
    for (const [species, raw] of Object.entries(body.speciesCards)) {
      const key = safeText(species, 24).toLowerCase();
      const n = Math.max(0, Math.min(1000000, Math.floor(Number(raw) || 0)));
      if (key) a.speciesCards[key] = n;
    }
  }
  if (body.ownedStarters && typeof body.ownedStarters === "object" && !Array.isArray(body.ownedStarters)) {
    a.ownedStarters={}; for(const [k,v] of Object.entries(body.ownedStarters)) if(v) a.ownedStarters[safeText(k,40)]=true;
  }
  if (body.petStages && typeof body.petStages === "object" && !Array.isArray(body.petStages)) {
    a.petStages={}; const valid=new Set(["baby","adult","boss","superboss","bigmomma"]);
    for(const [k,v] of Object.entries(body.petStages)){const s=safeText(v,20).toLowerCase();a.petStages[safeText(k,24).toLowerCase()]=valid.has(s)?s:"baby";}
  }
  if (body.petStatUpgrades && typeof body.petStatUpgrades === "object" && !Array.isArray(body.petStatUpgrades)) {
    a.petStatUpgrades={}; for(const [species,stats0] of Object.entries(body.petStatUpgrades)){const stats=(stats0&&typeof stats0==="object")?stats0:{};const clean={};for(const stat of ["health","defense","attack","weight","regen","speed"])clean[stat]=Math.max(0,Math.min(10,Math.floor(Number(stats[stat])||0)));a.petStatUpgrades[safeText(species,24).toLowerCase()]=clean;}
  }
  if(typeof body.starterPetType==="string") a.starterPetType=safeText(body.starterPetType,24).toLowerCase();
  if(typeof body.starterPetName==="string") a.starterPetName=safeText(body.starterPetName,20);
  if(typeof body.starterPetGender==="string") a.starterPetGender=body.starterPetGender==="Female"?"Female":"Male";
  ensurePetProgressState(a);
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  res.json({ ok: true, account: publicAccount(a) });
});



app.get("/api/time", (req,res)=>{
  const now=Date.now(); const d=new Date(now); const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1));
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,serverNow:now,utcDay:d.toISOString().slice(0,10),nextUtcDayAt:next.getTime()});
});
app.get("/api/shop/stock", (req,res)=>{
  const now=Date.now(); const info=shopRotationInfo(now); const stock=generateShopStock(info.rotationId);
  const uid=verifySession(requestSessionToken(req)); const a=uid?accountDb.byId[uid]:null;
  const purchased=a?purchasedShopSlots(a,info.rotationId):[];
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true,serverNow:now,utcDay:new Date(now).toISOString().slice(0,10),rotationId:info.rotationId,nextRefreshAt:info.nextRefreshAt,
    listings:stock.map(x=>({...x,purchased:purchased.includes(x.slotId)}))});
});
app.post("/api/shop/buy-stock", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a);
  const info=shopRotationInfo(); const stock=generateShopStock(info.rotationId);
  const slotId=safeText(req.body?.slotId,64); const listing=stock.find(x=>x.slotId===slotId);
  if(!listing)return res.status(409).json({ok:false,error:"shop_refreshed",rotationId:info.rotationId,nextRefreshAt:info.nextRefreshAt,account:publicAccount(a)});
  const bought=purchasedShopSlots(a,info.rotationId);
  if(bought.includes(slotId))return res.status(409).json({ok:false,error:"already_purchased",account:publicAccount(a)});
  const item=MATERIAL_CATALOG[listing.materialId];
  if(ensureGoldCubits(a)<item.price)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:item.price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-item.price); addMaterial(a,listing.materialId,1); bought.push(slotId);
  a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,listing:{...listing,purchased:true},account:publicAccount(a),rotationId:info.rotationId,nextRefreshAt:info.nextRefreshAt});
});
// Legacy direct purchase endpoint kept for older clients only. New builds use rotating stock slots.
app.post("/api/shop/buy-material", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a);
  const id=safeText(req.body?.id,32); const item=MATERIAL_CATALOG[id]; if(!item)return res.status(404).json({ok:false,error:"unknown_material"});
  if(ensureGoldCubits(a)<item.price)return res.status(409).json({ok:false,error:"not_enough_cubits",cost:item.price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-item.price); addMaterial(a,id,1); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,material:id,account:publicAccount(a)});
});
app.post("/api/build-starter", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a); const id=safeText(req.body?.id,32); const recipe=BUILD_RECIPES[id];
  if(!recipe)return res.status(404).json({ok:false,error:"unknown_recipe"}); if(a.craftedStarters.includes(id))return res.status(409).json({ok:false,error:"already_owned",account:publicAccount(a)});
  if(!hasIngredients(a,recipe.ingredients))return res.status(409).json({ok:false,error:"missing_materials",account:publicAccount(a)});
  consumeIngredients(a,recipe.ingredients); const success=Math.random()<recipe.chance; if(success)a.craftedStarters.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,success,account:publicAccount(a)});
});
app.post("/api/learn-skill", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a); const id=safeText(req.body?.id,32); const recipe=LEARN_RECIPES[id];
  if(!recipe)return res.status(404).json({ok:false,error:"unknown_skill"}); if(a.learnedSkills.includes(id))return res.status(409).json({ok:false,error:"already_owned",account:publicAccount(a)});
  if(!hasIngredients(a,recipe.ingredients))return res.status(409).json({ok:false,error:"missing_materials",account:publicAccount(a)});
  consumeIngredients(a,recipe.ingredients); a.learnedSkills.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,account:publicAccount(a)});
});
app.post("/api/themes/buy", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const id=safeText(req.body?.themeId,40);
  if(!THEME_GOLD.has(id))return res.status(404).json({ok:false,error:"theme_not_for_sale"});
  if(a.unlockedThemes.includes(id))return res.json({ok:true,alreadyOwned:true,account:publicAccount(a)});
  const price=themeGoldPrice(id); if(ensureGoldCubits(a)<price)return res.status(409).json({ok:false,error:"not_enough_cubits",price,account:publicAccount(a)});
  setGoldCubits(a,ensureGoldCubits(a)-price); a.unlockedThemes.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts();
  res.json({ok:true,themeId:id,price,account:publicAccount(a)});
});
app.post("/api/themes/ad-unlock", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const id=safeText(req.body?.themeId,40); if(!THEME_AD.has(id))return res.status(404).json({ok:false,error:"theme_not_ad_unlock"});
  if(!a.unlockedThemes.includes(id))a.unlockedThemes.push(id); a.updatedAt=new Date().toISOString(); await saveAccounts();
  // Rewarded-ad test hook: once an ad provider is connected, require a verified ad-completion token before granting.
  res.json({ok:true,themeId:id,account:publicAccount(a)});
});

app.post("/api/open-chest", requireAccount, async (req,res)=>{
  const a=accountDb.byId[req.hostlUserId]; ensureEconomyState(a); if(!a.speciesCards||typeof a.speciesCards!=="object")a.speciesCards={}; if(!Array.isArray(a.unlockedThemes))a.unlockedThemes=[];
  const kind=safeText(req.body?.kind,20).toLowerCase(); const daily=kind==="daily"; const forest=kind==="forest"; if(!daily&&!forest)return res.status(400).json({ok:false,error:"unknown_chest"});
  const day=new Date().toISOString().slice(0,10); const cost=forest?1100:0; if(daily&&a.lastDailyChest===day)return res.status(409).json({ok:false,error:"already_claimed",account:publicAccount(a)});
  if(ensureGoldCubits(a)<cost)return res.status(409).json({ok:false,error:"not_enough_cubits",cost,account:publicAccount(a)}); if(cost)setGoldCubits(a,ensureGoldCubits(a)-cost);
  const rewards=[]; const rand=(lo,hi)=>lo+Math.floor(Math.random()*(hi-lo+1));
  const goldCubits=daily?rand(18,45):rand(260,620); addGoldCubits(a,goldCubits); rewards.push(`+${goldCubits} Gold Cubits`);
  const materialRolls=daily?rand(1,2):rand(2,4);
  const matRewards={}; for(let i=0;i<materialRolls;i++){const id=randomMaterialId(); const rarity=MATERIAL_CATALOG[id]?.rarity||"Common"; const qty=(rarity==="Common"||rarity==="Uncommon")?(daily?rand(1,2):rand(1,3)):1; addMaterial(a,id,qty); matRewards[id]=(matRewards[id]||0)+qty;}
  for(const [id,qty] of Object.entries(matRewards))rewards.push(`+${qty} ${MATERIAL_CATALOG[id].name}`);
  const species=randomChestSpecies(); const cards=daily?rand(3,8):rand(8,20); a.speciesCards[species]=Math.max(0,Math.floor(Number(a.speciesCards[species])||0)+cards); rewards.push(`+${cards} ${species.charAt(0).toUpperCase()+species.slice(1)} Cards`);
  const themeChance=daily?.10:.35; if(Math.random()<themeChance){const choices=CHEST_THEMES.filter(t=>!a.unlockedThemes.includes(t)); if(choices.length){const t=choices[rand(0,choices.length-1)];a.unlockedThemes.push(t);rewards.push(`${t} theme unlocked permanently`);}}
  if(daily)a.lastDailyChest=day; a.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,rewards,account:publicAccount(a)});
});

app.post("/api/presence", requireAccount, (req,res)=>{ markWebPresence(req.hostlUserId); res.json({ok:true}); });
app.get("/api/friends", requireAccount, (req,res)=>{
  markWebPresence(req.hostlUserId);
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]);
  res.setHeader("Cache-Control","no-store");
  res.json({ok:true, account:publicAccount(a),
    friends:a.friends.map(friendPublicSummary).filter(Boolean),
    incoming:a.incomingFriendRequests.map(socialRequestSummary).filter(Boolean),
    outgoing:a.outgoingFriendRequests.map(socialRequestSummary).filter(Boolean)
  });
});
app.post("/api/friends/request", requireAccount, async (req,res)=>{
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]); const targetId=String(req.body?.playerId||"").trim(); const b=accountDb.byId[targetId]?ensureSocialState(accountDb.byId[targetId]):null;
  if(!b)return res.status(404).json({ok:false,error:"player_not_found"}); if(targetId===a.userId)return res.status(400).json({ok:false,error:"cannot_friend_self"});
  if(a.friends.includes(targetId))return res.status(409).json({ok:false,error:"already_friends"});
  if(a.incomingFriendRequests.includes(targetId)){
    a.incomingFriendRequests=a.incomingFriendRequests.filter(x=>x!==targetId); b.outgoingFriendRequests=b.outgoingFriendRequests.filter(x=>x!==a.userId);
    if(!a.friends.includes(targetId))a.friends.push(targetId); if(!b.friends.includes(a.userId))b.friends.push(a.userId);
    await saveAccounts(); return res.json({ok:true,accepted:true,friend:friendPublicSummary(targetId)});
  }
  if(!a.outgoingFriendRequests.includes(targetId))a.outgoingFriendRequests.push(targetId); if(!b.incomingFriendRequests.includes(a.userId))b.incomingFriendRequests.push(a.userId);
  await saveAccounts(); res.json({ok:true,sent:true});
});
app.post("/api/friends/respond", requireAccount, async (req,res)=>{
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]); const targetId=String(req.body?.playerId||"").trim(); const b=accountDb.byId[targetId]?ensureSocialState(accountDb.byId[targetId]):null;
  if(!b||!a.incomingFriendRequests.includes(targetId))return res.status(404).json({ok:false,error:"request_not_found"});
  a.incomingFriendRequests=a.incomingFriendRequests.filter(x=>x!==targetId); b.outgoingFriendRequests=b.outgoingFriendRequests.filter(x=>x!==a.userId);
  if(req.body?.accept){ if(!a.friends.includes(targetId))a.friends.push(targetId); if(!b.friends.includes(a.userId))b.friends.push(a.userId); }
  await saveAccounts(); res.json({ok:true,accepted:!!req.body?.accept});
});
app.delete("/api/friends/:id", requireAccount, async (req,res)=>{
  const a=ensureSocialState(accountDb.byId[req.hostlUserId]); const targetId=String(req.params.id||""); const b=accountDb.byId[targetId]?ensureSocialState(accountDb.byId[targetId]):null;
  a.friends=a.friends.filter(x=>x!==targetId); a.incomingFriendRequests=a.incomingFriendRequests.filter(x=>x!==targetId); a.outgoingFriendRequests=a.outgoingFriendRequests.filter(x=>x!==targetId);
  if(b){ b.friends=b.friends.filter(x=>x!==a.userId); b.incomingFriendRequests=b.incomingFriendRequests.filter(x=>x!==a.userId); b.outgoingFriendRequests=b.outgoingFriendRequests.filter(x=>x!==a.userId); }
  await saveAccounts(); res.json({ok:true});
});
app.get("/api/friends/chat/:id", requireAccount, (req,res)=>{
  const targetId=String(req.params.id||""); if(!areFriends(req.hostlUserId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const key=friendChatKey(req.hostlUserId,targetId); const messages=Array.isArray(accountDb.friendChats[key])?accountDb.friendChats[key].slice(-100):[];
  res.setHeader("Cache-Control","no-store"); res.json({ok:true,messages});
});
app.post("/api/friends/chat/:id", requireAccount, async (req,res)=>{
  const targetId=String(req.params.id||""); if(!areFriends(req.hostlUserId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  let message=safeText(req.body?.message,240).replace(/[<>]/g,""); if(!message)return res.status(400).json({ok:false,error:"empty_message"});
  const key=friendChatKey(req.hostlUserId,targetId); if(!Array.isArray(accountDb.friendChats[key]))accountDb.friendChats[key]=[];
  const item={id:crypto.randomUUID(),from:req.hostlUserId,to:targetId,message,at:Date.now()}; accountDb.friendChats[key].push(item); accountDb.friendChats[key]=accountDb.friendChats[key].slice(-100); await saveAccounts(); res.json({ok:true,message:item});
});
app.post("/api/friends/gift", requireAccount, async (req,res)=>{
  const from=accountDb.byId[req.hostlUserId], targetId=String(req.body?.playerId||""); const to=accountDb.byId[targetId]; if(!to||!areFriends(from.userId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const part=normalizedTransferPart(req.body||{}); if(part.goldCubits<=0&&part.cards<=0)return res.status(400).json({ok:false,error:"nothing_to_gift"}); if(!hasTransfer(from,part))return res.status(409).json({ok:false,error:"not_enough"});
  applyTransfer(from,to,part); from.updatedAt=to.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,account:publicAccount(from),friend:friendPublicSummary(targetId)});
});
app.get("/api/friends/trades", requireAccount, (req,res)=>{
  const uid=req.hostlUserId; const offers=Object.values(accountDb.tradeOffers||{}).filter(o=>o&&o.status==="pending"&&(o.from===uid||o.to===uid)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
  res.setHeader("Cache-Control","no-store"); res.json({ok:true,offers});
});
app.post("/api/friends/trade", requireAccount, async (req,res)=>{
  const from=accountDb.byId[req.hostlUserId], targetId=String(req.body?.playerId||""); if(!accountDb.byId[targetId]||!areFriends(from.userId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const give=normalizedTransferPart(req.body?.give), want=normalizedTransferPart(req.body?.want); if(give.goldCubits<=0&&give.cards<=0&&want.goldCubits<=0&&want.cards<=0)return res.status(400).json({ok:false,error:"empty_trade"}); if(!hasTransfer(from,give))return res.status(409).json({ok:false,error:"not_enough"});
  const id=crypto.randomUUID(); const offer={id,from:from.userId,to:targetId,give,want,status:"pending",createdAt:Date.now()}; accountDb.tradeOffers[id]=offer; await saveAccounts(); res.json({ok:true,offer});
});
app.post("/api/friends/trade/:id/respond", requireAccount, async (req,res)=>{
  const offer=accountDb.tradeOffers?.[String(req.params.id||"")]; if(!offer||offer.status!=="pending"||offer.to!==req.hostlUserId)return res.status(404).json({ok:false,error:"trade_not_found"});
  if(!req.body?.accept){ offer.status="declined"; offer.closedAt=Date.now(); await saveAccounts(); return res.json({ok:true,accepted:false}); }
  const from=accountDb.byId[offer.from], to=accountDb.byId[offer.to]; if(!from||!to||!areFriends(from.userId,to.userId))return res.status(409).json({ok:false,error:"not_friends"}); if(!hasTransfer(from,offer.give)||!hasTransfer(to,offer.want))return res.status(409).json({ok:false,error:"trade_inventory_changed"});
  applyTransfer(from,to,offer.give); applyTransfer(to,from,offer.want); offer.status="accepted"; offer.closedAt=Date.now(); from.updatedAt=to.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,accepted:true,account:publicAccount(to)});
});

app.post("/api/redeem-code", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  const code = normalizePromoCode(req.body?.code);
  if (!code) return res.status(400).json({ ok:false, error:"missing_code" });
  const reward = PROMO_CODES.get(code);
  if (!reward) return res.status(404).json({ ok:false, error:"invalid_code" });
  const redeemed = ensureRedeemedCodes(a);
  if (redeemed.includes(code)) {
    const repaired=repairSpecialPromoEntitlements(a);
    if(repaired){a.updatedAt=new Date().toISOString();await saveAccounts();}
    return res.status(409).json({ ok:false, error:"already_redeemed", repaired, account:publicAccount(a) });
  }
  if (!accountDb.globalCodeClaims || typeof accountDb.globalCodeClaims !== "object") accountDb.globalCodeClaims = {};
  const existingGlobalClaim = accountDb.globalCodeClaims[code];
  if (reward.globalOnce && existingGlobalClaim && existingGlobalClaim !== a.userId) return res.status(409).json({ ok:false, error:"code_already_claimed" });

  if (Number.isFinite(Number(reward.goldCubits)) && Number(reward.goldCubits) > 0) {
    addGoldCubits(a, reward.goldCubits);
  }
  if (Array.isArray(reward.themes) && reward.themes.length) {
    if (!Array.isArray(a.unlockedThemes)) a.unlockedThemes = [];
    a.unlockedThemes = [...new Set([...a.unlockedThemes, ...reward.themes.map(x=>safeText(x,40)).filter(Boolean)])].slice(0,100);
  }
  if (reward.speciesCards && typeof reward.speciesCards === "object") {
    if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
    for (const [species, raw] of Object.entries(reward.speciesCards)) {
      const key=safeText(species,24).toLowerCase(), amount=Math.max(0,Math.floor(Number(raw)||0));
      if (key && amount) a.speciesCards[key]=Math.max(0,Math.floor(Number(a.speciesCards[key])||0)+amount);
    }
  }
  if (reward.title) {
    ensureTitleState(a);
    const grantedTitle = safeText(reward.title,32);
    if (grantedTitle && !a.unlockedTitles.includes(grantedTitle)) a.unlockedTitles.push(grantedTitle);
    if (!a.title && grantedTitle) a.title = grantedTitle;
  }
  if (Number(reward.testerRank)>0) a.testerRank=Math.max(0,Math.floor(Number(reward.testerRank)||0));
  if (Number(reward.ownerRank)>0) {
    a.ownerRank=Math.max(0,Math.floor(Number(reward.ownerRank)||0));
    ensureTitleState(a);
    if (!a.unlockedTitles.includes("Owner")) a.unlockedTitles.push("Owner");
    a.title="Owner";
  }
  if (reward.starterPetEntitlement && typeof reward.starterPetEntitlement === "object") {
    grantStarterPetEntitlement(a,reward.starterPetEntitlement.type,reward.starterPetEntitlement.stage);
  }
  // Mark/repair special pet rewards idempotently. This also repairs older tester/owner claims.
  repairSpecialPromoEntitlements(a);
  if (reward.globalOnce) accountDb.globalCodeClaims[code]=a.userId;
  redeemed.push(code);
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  res.json({ ok:true, code, message:`Code redeemed: ${reward.label || "reward added"}.`, account:publicAccount(a) });
});

async function rewardTesterKill(accountId) {
  const a = accountDb.byId[String(accountId || "")];
  if (!a) return { granted:false, reason:"account_missing" };
  if (!a.achievements || typeof a.achievements !== "object") a.achievements = {};
  const achievementId = "tester_hunter_1";
  if (a.achievements[achievementId]) return { granted:false, account:publicAccount(a) };
  const goldCubits = 3000, saberCards = 100;
  addGoldCubits(a, goldCubits);
  if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
  a.speciesCards.saber = Math.max(0, Math.floor(Number(a.speciesCards.saber)||0) + saberCards);
  const rewardSummary = `+${goldCubits.toLocaleString()} Gold Cubits · +${saberCards} Saber Cards`;
  a.achievements[achievementId] = { at:Date.now(), species:"saber", rewardSummary, serverVerified:true };
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  return { granted:true, rewardSummary, goldCubits, saberCards, account:publicAccount(a) };
}

async function rewardOwnerKill(accountId) {
  const a = accountDb.byId[String(accountId || "")];
  if (!a) return { granted:false, reason:"account_missing" };
  if (!a.achievements || typeof a.achievements !== "object") a.achievements = {};
  const achievementId = "owner_hunter_1";
  if (a.achievements[achievementId]) return { granted:false, account:publicAccount(a) };
  const goldCubits = 7500, viperCards = 250;
  addGoldCubits(a, goldCubits);
  if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
  a.speciesCards.snake = Math.max(0, Math.floor(Number(a.speciesCards.snake)||0) + viperCards);
  const rewardSummary = `+${goldCubits.toLocaleString()} Gold Cubits · +${viperCards} Viper Cards`;
  a.achievements[achievementId] = { at:Date.now(), species:"snake", rewardSummary, serverVerified:true };
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  return { granted:true, rewardSummary, goldCubits, viperCards, account:publicAccount(a) };
}

configureHostlAccountHooks({
  resolveSession(token) {
    const uid = verifySession(token);
    if (!uid) return null;
    const a = accountDb.byId[uid];
    if (!a) return null;
    return { userId:uid, title:a.title||"", testerRank:Math.max(0,Math.floor(Number(a.testerRank)||0)), ownerRank:Math.max(0,Math.floor(Number(a.ownerRank)||0)) };
  },
  rewardTesterKill,
  rewardOwnerKill,
  rewardGameplayMaterial,
  onPresenceJoin(userId,key,worldId){ markGamePresence(userId,key,worldId); },
  onPresenceLeave(userId,key){ clearGamePresence(userId,key); }
});

app.delete("/api/account", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  if (a?.googleSub) delete accountDb.byGoogleSub[a.googleSub];
  if(a){ ensureSocialState(a); for(const fid of a.friends){ const f=accountDb.byId[fid]; if(f){ ensureSocialState(f); f.friends=f.friends.filter(x=>x!==a.userId); f.incomingFriendRequests=f.incomingFriendRequests.filter(x=>x!==a.userId); f.outgoingFriendRequests=f.outgoingFriendRequests.filter(x=>x!==a.userId); } } }
  for(const [id,o] of Object.entries(accountDb.tradeOffers||{})){ if(o?.from===req.hostlUserId||o?.to===req.hostlUserId) delete accountDb.tradeOffers[id]; }
  for(const key of Object.keys(accountDb.friendChats||{})){ if(key.split(":").includes(req.hostlUserId)) delete accountDb.friendChats[key]; }
  WEB_PRESENCE.delete(req.hostlUserId); GAME_PRESENCE.delete(req.hostlUserId);
  delete accountDb.byId[req.hostlUserId];
  await saveAccounts();
  res.json({ ok: true });
});

app.get("/", (_req, res) => {
  res.redirect("/index.html?server=self");
});
app.use(express.static(publicDir, { index: false, maxAge: "1h" }));

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("world", WorldRoom).filterBy(["worldId"]);
await gameServer.listen(port);

console.log(`HOSTL multiplayer listening on port ${port}`);
console.log(`Local game: http://localhost:${port}`);
console.log("On Render, open the service's HTTPS URL. The game auto-connects with WSS.");
