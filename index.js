import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { OAuth2Client } from "google-auth-library";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { WorldRoom, getCubeServerStats } from "./WorldRoom.js";

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
    if (!fs.existsSync(ACCOUNT_FILE)) return { byId: {}, byGoogleSub: {} };
    const parsed = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8"));
    return {
      byId: parsed?.byId && typeof parsed.byId === "object" ? parsed.byId : {},
      byGoogleSub: parsed?.byGoogleSub && typeof parsed.byGoogleSub === "object" ? parsed.byGoogleSub : {}
    };
  } catch (err) {
    console.error("Failed to load HOSTL accounts:", err);
    return { byId: {}, byGoogleSub: {} };
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
    createdAt: a.createdAt || ""
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

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, game: "HOSTL", multiplayer: true, serverBuild: 507, gameBuild: 579, rulesVersion: "579", chat: true, googleAuth: !!GOOGLE_CLIENT_ID, ...getCubeServerStats() });
});

app.get("/status", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, ...getCubeServerStats(), maxPlayersPerRoom: 12, serverBuild: 506, gameBuild: 578 });
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
      userId = `hostl_${crypto.randomUUID()}`;
      const suggestedName = safeText(p.given_name || p.name || "Player", 20) || "Player";
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      accountDb.byId[userId] = account;
      accountDb.byGoogleSub[p.sub] = userId;
    } else {
      account.email = safeText(p.email, 120).toLowerCase();
      account.picture = safeText(p.picture, 500);
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
  if (typeof body.username === "string") a.username = safeText(body.username, 20) || a.username;
  if (Number.isFinite(Number(body.cubits))) a.cubits = Math.max(0, Math.min(1000000000, Math.floor(Number(body.cubits))));
  if (Array.isArray(body.unlockedThemes)) a.unlockedThemes = [...new Set(body.unlockedThemes.map(x => safeText(x, 40)).filter(Boolean))].slice(0, 100);
  if (body.achievements && typeof body.achievements === "object" && !Array.isArray(body.achievements)) a.achievements = body.achievements;
  if (typeof body.lastDailyCubits === "string") a.lastDailyCubits = safeText(body.lastDailyCubits, 20);
  if (typeof body.lastDailyChest === "string") a.lastDailyChest = safeText(body.lastDailyChest, 20);
  a.updatedAt = new Date().toISOString();
  await saveAccounts();
  res.json({ ok: true, account: publicAccount(a) });
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
gameServer.define("world", WorldRoom);
await gameServer.listen(port);

console.log(`HOSTL multiplayer listening on port ${port}`);
console.log(`Local game: http://localhost:${port}`);
console.log("On Render, open the service's HTTPS URL. The game auto-connects with WSS.");
