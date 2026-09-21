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
  // Migrate the original tester title to its final public name.
  if (Math.max(0, Math.floor(Number(a.testerRank)||0)) === 1) {
    a.unlockedTitles = a.unlockedTitles.filter(t => t !== "Tester");
    if (!a.unlockedTitles.includes("#1 Tester")) a.unlockedTitles.push("#1 Tester");
    if (safeText(a.title,32) === "Tester" || !safeText(a.title,32)) a.title = "#1 Tester";
  }
  const current = safeText(a.title, 32);
  if (current && !a.unlockedTitles.includes(current)) a.unlockedTitles.push(current);
  if (current && !a.unlockedTitles.includes(current)) a.title = "";
  return a;
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
  return { userId:a.userId, username:a.username||"Player", title:a.title||"", online:p.online, playing:p.playing, worldId:p.worldId };
}
function socialRequestSummary(uid){ const a=accountDb.byId[String(uid)]; return a?{userId:a.userId,username:a.username||"Player",title:a.title||""}:null; }
function normalizedTransferPart(raw){
  const obj=raw&&typeof raw==="object"?raw:{};
  const cubits=Math.max(0,Math.min(100000000,Math.floor(Number(obj.cubits)||0)));
  const species=safeText(obj.species,24).toLowerCase();
  const cards=Math.max(0,Math.min(1000000,Math.floor(Number(obj.cards)||0)));
  return {cubits,species,cards};
}
function hasTransfer(a,part){
  if(!a)return false; if(Math.floor(Number(a.cubits)||0)<part.cubits)return false;
  if(part.cards>0){ const owned=Math.floor(Number(a.speciesCards?.[part.species])||0); if(!part.species||owned<part.cards)return false; }
  return true;
}
function applyTransfer(from,to,part){
  if(part.cubits>0){ from.cubits=Math.max(0,Math.floor(Number(from.cubits)||0)-part.cubits); to.cubits=Math.max(0,Math.floor(Number(to.cubits)||0)+part.cubits); }
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
    a.username = cleanDisplayName(a.username) || "Player";
    ensureTitleState(a);
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
saveAccounts();
function publicAccount(a) {
  return {
    userId: a.userId,
    username: a.username || "Player",
    email: a.email || "",
    picture: a.picture || "",
    cubits: Math.max(0, Math.floor(Number(a.cubits) || 0)),
    unlockedThemes: Array.isArray(a.unlockedThemes) ? a.unlockedThemes : [],
    achievements: a.achievements && typeof a.achievements === "object" ? a.achievements : {},
    lastDailyCubits: a.lastDailyCubits || "",
    lastDailyChest: a.lastDailyChest || "",
    createdAt: a.createdAt || "",
    title: a.title || "",
    unlockedTitles: Array.isArray(a.unlockedTitles) ? a.unlockedTitles : [],
    testerRank: Math.max(0, Math.floor(Number(a.testerRank) || 0)),
    speciesCards: a.speciesCards && typeof a.speciesCards === "object" ? a.speciesCards : {},
    starterPetEntitlement: a.starterPetEntitlement && typeof a.starterPetEntitlement === "object" ? a.starterPetEntitlement : null,
    friendCount: ensureSocialState(a).friends.length
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
function requireAccount(req, res, next) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const uid = verifySession(token);
  if (!uid) return res.status(401).json({ ok: false, error: "not_authenticated" });
  req.hostlUserId = uid;
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
  account.cubits = Math.max(0, Math.floor(Number(account.cubits) || 0) + 10);
  return true;
}

// Official HOSTL promo codes. Add future codes here and redeploy.
// Rewards are applied server-side so each account can only claim a code once.
const PROMO_CODES = new Map([
  ["HOSTLSTART", { cubits: 150, themes: ["Golden"], label: "+150 Cubits and the Golden theme" }],
  ["SCCTT", {
    cubits: 14000,
    speciesCards: { saber: 500 },
    title: "#1 Tester",
    testerRank: 1,
    starterPetEntitlement: { type: "saber", stage: "adult" },
    globalOnce: true,
    label: "+14,000 Cubits, +500 Saber Cards, Adult Saber starter access, and the #1 Tester title"
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
  res.status(200).json({ ok: true, game: "HOSTL", multiplayer: true, serverBuild: 524, gameBuild: 596, rulesVersion: "591", chat: true, googleAuth: !!GOOGLE_CLIENT_ID, ...getCubeServerStats() });
});

app.get("/status", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, ...getCubeServerStats(), maxPlayersPerRoom: 12, serverBuild: 524, gameBuild: 596 });
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
    if (!account) {
      created = true;
      userId = allocateNumericUserId();
      const suggestedName = cleanDisplayName(p.given_name || p.name || "Player") || "Player";
      account = {
        userId,
        googleSub: p.sub,
        username: suggestedName,
        email: safeText(p.email, 120).toLowerCase(),
        picture: safeText(p.picture, 500),
        cubits: 500,
        unlockedThemes: [],
        achievements: {},
        lastDailyCubits: "",
        lastDailyChest: "",
        redeemedCodes: [],
        speciesCards: {},
        title: "",
        unlockedTitles: [],
        testerRank: 0,
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
      account.username = cleanDisplayName(account.username) || "Player";
      ensureTitleState(account);
      ensureSocialState(account);
      account.updatedAt = new Date().toISOString();
    }
    const dailyGranted = applyDailyCubits(account);
    await saveAccounts();
    res.json({ ok: true, created, dailyGranted, token: signSession(userId), account: publicAccount(account) });
  } catch (err) {
    console.error("Google login failed:", err?.message || err);
    res.status(401).json({ ok: false, error: "google_verification_failed" });
  }
});

app.get("/api/account", requireAccount, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, account: publicAccount(accountDb.byId[req.hostlUserId]) });
});

app.put("/api/account", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  const body = req.body || {};
  if (typeof body.username === "string") {
    const nextName = cleanDisplayName(body.username);
    if (nextName.length >= 2) a.username = nextName;
  }
  ensureTitleState(a);
  if (typeof body.title === "string") {
    const requestedTitle = safeText(body.title, 32);
    if (!requestedTitle) a.title = "";
    else if (a.unlockedTitles.includes(requestedTitle)) a.title = requestedTitle;
  }
  if (Number.isFinite(Number(body.cubits))) a.cubits = Math.max(0, Math.min(1000000000, Math.floor(Number(body.cubits))));
  if (Array.isArray(body.unlockedThemes)) a.unlockedThemes = [...new Set(body.unlockedThemes.map(x => safeText(x, 40)).filter(Boolean))].slice(0, 100);
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
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  res.json({ ok: true, account: publicAccount(a) });
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
  const part=normalizedTransferPart(req.body||{}); if(part.cubits<=0&&part.cards<=0)return res.status(400).json({ok:false,error:"nothing_to_gift"}); if(!hasTransfer(from,part))return res.status(409).json({ok:false,error:"not_enough"});
  applyTransfer(from,to,part); from.updatedAt=to.updatedAt=new Date().toISOString(); await saveAccounts(); res.json({ok:true,account:publicAccount(from),friend:friendPublicSummary(targetId)});
});
app.get("/api/friends/trades", requireAccount, (req,res)=>{
  const uid=req.hostlUserId; const offers=Object.values(accountDb.tradeOffers||{}).filter(o=>o&&o.status==="pending"&&(o.from===uid||o.to===uid)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);
  res.setHeader("Cache-Control","no-store"); res.json({ok:true,offers});
});
app.post("/api/friends/trade", requireAccount, async (req,res)=>{
  const from=accountDb.byId[req.hostlUserId], targetId=String(req.body?.playerId||""); if(!accountDb.byId[targetId]||!areFriends(from.userId,targetId))return res.status(403).json({ok:false,error:"not_friends"});
  const give=normalizedTransferPart(req.body?.give), want=normalizedTransferPart(req.body?.want); if(give.cubits<=0&&give.cards<=0&&want.cubits<=0&&want.cards<=0)return res.status(400).json({ok:false,error:"empty_trade"}); if(!hasTransfer(from,give))return res.status(409).json({ok:false,error:"not_enough"});
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
  if (redeemed.includes(code)) return res.status(409).json({ ok:false, error:"already_redeemed" });
  if (!accountDb.globalCodeClaims || typeof accountDb.globalCodeClaims !== "object") accountDb.globalCodeClaims = {};
  const existingGlobalClaim = accountDb.globalCodeClaims[code];
  if (reward.globalOnce && existingGlobalClaim && existingGlobalClaim !== a.userId) return res.status(409).json({ ok:false, error:"code_already_claimed" });

  if (Number.isFinite(Number(reward.cubits)) && Number(reward.cubits) > 0) {
    a.cubits = Math.max(0, Math.floor(Number(a.cubits) || 0) + Math.floor(Number(reward.cubits)));
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
  if (reward.starterPetEntitlement && typeof reward.starterPetEntitlement === "object") {
    a.starterPetEntitlement={type:safeText(reward.starterPetEntitlement.type,24).toLowerCase(),stage:safeText(reward.starterPetEntitlement.stage,24).toLowerCase()};
  }
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
  const cubits = 3000, saberCards = 100;
  a.cubits = Math.max(0, Math.floor(Number(a.cubits)||0) + cubits);
  if (!a.speciesCards || typeof a.speciesCards !== "object") a.speciesCards = {};
  a.speciesCards.saber = Math.max(0, Math.floor(Number(a.speciesCards.saber)||0) + saberCards);
  const rewardSummary = `+${cubits.toLocaleString()} Cubits · +${saberCards} Saber Cards`;
  a.achievements[achievementId] = { at:Date.now(), species:"saber", rewardSummary, serverVerified:true };
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  return { granted:true, rewardSummary, cubits, saberCards, account:publicAccount(a) };
}

configureHostlAccountHooks({
  resolveSession(token) {
    const uid = verifySession(token);
    if (!uid) return null;
    const a = accountDb.byId[uid];
    if (!a) return null;
    return { userId:uid, title:a.title||"", testerRank:Math.max(0,Math.floor(Number(a.testerRank)||0)) };
  },
  rewardTesterKill,
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
