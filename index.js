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
    if (!fs.existsSync(ACCOUNT_FILE)) return { byId: {}, byGoogleSub: {}, globalCodeClaims: {} };
    const parsed = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8"));
    return {
      byId: parsed?.byId && typeof parsed.byId === "object" ? parsed.byId : {},
      byGoogleSub: parsed?.byGoogleSub && typeof parsed.byGoogleSub === "object" ? parsed.byGoogleSub : {},
      globalCodeClaims: parsed?.globalCodeClaims && typeof parsed.globalCodeClaims === "object" ? parsed.globalCodeClaims : {}
    };
  } catch (err) {
    console.error("Failed to load HOSTL accounts:", err);
    return { byId: {}, byGoogleSub: {}, globalCodeClaims: {} };
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
  // Migrate the old tester title name to the official SCCTT title.
  if (Number(a.testerRank) === 1) {
    a.unlockedTitles = a.unlockedTitles.map(t => t === "Tester" ? "#1 Tester" : t);
    if (!a.unlockedTitles.includes("#1 Tester")) a.unlockedTitles.push("#1 Tester");
    if (a.title === "Tester" || !a.title) a.title = "#1 Tester";
  }
  const current = safeText(a.title, 32);
  if (current && !a.unlockedTitles.includes(current)) a.unlockedTitles.push(current);
  if (current && !a.unlockedTitles.includes(current)) a.title = "";
  return a;
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
    starterPetEntitlement: a.starterPetEntitlement && typeof a.starterPetEntitlement === "object" ? a.starterPetEntitlement : null
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
  res.status(200).json({ ok: true, game: "HOSTL", multiplayer: true, serverBuild: 526, gameBuild: 598, rulesVersion: "591", chat: true, googleAuth: !!GOOGLE_CLIENT_ID, ...getCubeServerStats() });
});

app.get("/status", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, ...getCubeServerStats(), maxPlayersPerRoom: 12, serverBuild: 526, gameBuild: 598 });
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
      account.updatedAt = new Date().toISOString();
    }
    const dailyGranted = applyDailyCubits(account);
    await saveAccounts();
    res.json({ ok: true, created, dailyGranted, token: signSession(userId), account: publicAccount(account) });
  } catch (err) {
    console.error("Google login failed:", err?.message || err);
    const msg = String(err?.message || "").toLowerCase();
    const error = msg.includes("audience") || msg.includes("wrong recipient") ? "google_client_mismatch" : "google_verification_failed";
    res.status(401).json({ ok: false, error });
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
  rewardTesterKill
});

app.delete("/api/account", requireAccount, async (req, res) => {
  const a = accountDb.byId[req.hostlUserId];
  if (a?.googleSub) delete accountDb.byGoogleSub[a.googleSub];
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
