
(() => {
"use strict";

// ---------- loading screen ----------
const bootLoadingScreen = document.getElementById("bootLoadingScreen");
const bootLoadingStatus = document.getElementById("bootLoadingStatus");
const bootLoadingFill = document.getElementById("bootLoadingFill");

function setLoadingScreen(message = "Loading…", progress = null, busy = false) {
  if (!bootLoadingScreen) return;
  bootLoadingScreen.classList.remove("boot-loaded");
  bootLoadingScreen.classList.toggle("boot-busy", !!busy);
  if (bootLoadingStatus) bootLoadingStatus.textContent = message;
  if (bootLoadingFill && progress != null) {
    bootLoadingFill.style.width = Math.max(4, Math.min(100, progress)) + "%";
  }
}

function hideLoadingScreen() {
  if (!bootLoadingScreen) return;
  bootLoadingScreen.classList.remove("boot-busy");
  if (bootLoadingFill) bootLoadingFill.style.width = "100%";
  if (bootLoadingStatus) bootLoadingStatus.textContent = "Ready";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    bootLoadingScreen.classList.add("boot-loaded");
  }));
}

function waitOneFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

setTimeout(() => {
  if (bootLoadingScreen && !bootLoadingScreen.classList.contains("boot-loaded")) {
    if (bootLoadingStatus) bootLoadingStatus.textContent = "Still loading…";
  }
}, 6000);

// ---------- multiplayer server address ----------
const CUBE_SERVER_STORAGE_KEY = "cubeServerUrl";

function normalizeMultiplayerServerUrl(value) {
  let url = String(value || "").trim();
  if (!url) return "";
  if (/^https:\/\//i.test(url)) url = "wss://" + url.slice(8);
  else if (/^http:\/\//i.test(url)) url = "ws://" + url.slice(7);
  else if (!/^wss?:\/\//i.test(url)) {
    const secure = location.protocol === "https:";
    url = (secure ? "wss://" : "ws://") + url;
  }
  return url.replace(/\/+$/, "");
}

function samePageMultiplayerServerUrl() {
  if (location.protocol === "https:") return `wss://${location.host}`;
  if (location.protocol === "http:") return `ws://${location.host}`;
  return "";
}

function preferredMultiplayerServerUrl() {
  let requested = "";
  try { requested = new URLSearchParams(location.search).get("server") || ""; } catch {}

  if (requested.toLowerCase() === "self") {
    const selfUrl = samePageMultiplayerServerUrl();
    if (selfUrl) {
      localStorage.setItem(CUBE_SERVER_STORAGE_KEY, selfUrl);
      return selfUrl;
    }
  } else if (requested) {
    const normalized = normalizeMultiplayerServerUrl(requested);
    if (normalized) {
      localStorage.setItem(CUBE_SERVER_STORAGE_KEY, normalized);
      return normalized;
    }
  }

  const saved = normalizeMultiplayerServerUrl(localStorage.getItem(CUBE_SERVER_STORAGE_KEY) || "");
  if (saved) return saved;
  return "ws://localhost:2567";
}

function saveMultiplayerServerInput() {
  const input = document.getElementById("serverUrl");
  if (!input) return preferredMultiplayerServerUrl();
  const normalized = normalizeMultiplayerServerUrl(input.value) || preferredMultiplayerServerUrl();
  input.value = normalized;
  localStorage.setItem(CUBE_SERVER_STORAGE_KEY, normalized);
  return normalized;
}

// ---------- setup ----------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Keep one physical-pixel copy of the last frame that finished drawing correctly.
// If one bad entity throws halfway through a frame, restore this instead of leaving
// a cleared/blank or half-drawn world on screen.
const lastGoodFrameCanvas = document.createElement("canvas");
const lastGoodFrameCtx = lastGoodFrameCanvas.getContext("2d");
let hasLastGoodFrame = false;
let lastGoodFrameCaptureAt = 0;
const LAST_GOOD_FRAME_CAPTURE_MS = 1000; // recovery snapshot only once per second; avoids periodic GPU/CPU copy stalls.

function resizeLastGoodFrameBuffer() {
  // Recovery does not need full render resolution. A half-size backup cuts
  // canvas-copy bandwidth/memory to about 1/4 and avoids random copy stalls.
  const bw = Math.max(1, Math.floor(canvas.width * 0.5));
  const bh = Math.max(1, Math.floor(canvas.height * 0.5));
  if (lastGoodFrameCanvas.width !== bw || lastGoodFrameCanvas.height !== bh) {
    lastGoodFrameCanvas.width = bw;
    lastGoodFrameCanvas.height = bh;
    hasLastGoodFrame = false;
  }
}

function captureLastGoodFrame(force = false) {
  // Multiplayer already has a resilient requestAnimationFrame loop. Avoid any
  // GPU->canvas recovery copy while online; large canvas copies can stall the
  // main thread on some browsers/GPUs.
  if (net && net.room) return;
  const now = performance.now();
  if (!force && hasLastGoodFrame && now - lastGoodFrameCaptureAt < LAST_GOOD_FRAME_CAPTURE_MS) return;
  lastGoodFrameCaptureAt = now;
  resizeLastGoodFrameBuffer();
  lastGoodFrameCtx.setTransform(1, 0, 0, 1, 0, 0);
  lastGoodFrameCtx.globalAlpha = 1;
  lastGoodFrameCtx.globalCompositeOperation = "source-over";
  lastGoodFrameCtx.clearRect(0, 0, lastGoodFrameCanvas.width, lastGoodFrameCanvas.height);
  lastGoodFrameCtx.drawImage(
    canvas,
    0, 0, canvas.width, canvas.height,
    0, 0, lastGoodFrameCanvas.width, lastGoodFrameCanvas.height
  );
  hasLastGoodFrame = true;
}

function restoreLastGoodFrame() {
  if (!hasLastGoodFrame) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    lastGoodFrameCanvas,
    0, 0, lastGoodFrameCanvas.width, lastGoodFrameCanvas.height,
    0, 0, canvas.width, canvas.height
  );
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  return true;
}

const mmCanvas = document.getElementById("minimap");
const mmCtx = mmCanvas.getContext("2d");
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 1.5);
let vignetteGradient = null;

function resize() {
  W = window.innerWidth; H = window.innerHeight;
  const mobileRender = mobileMode || (window.matchMedia && window.matchMedia("(pointer:coarse)").matches);
  DPR = Math.min(window.devicePixelRatio || 1, mobileRender ? 1.25 : 1.5);
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  resizeLastGoodFrameBuffer();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  vignetteGradient = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.3, W/2, H/2, Math.max(W,H)*0.7);
  vignetteGradient.addColorStop(0, "rgba(0,0,0,0)");
  vignetteGradient.addColorStop(1, "rgba(0,0,0,0.32)");
}
window.addEventListener("resize", resize);
resize();

// ---------- constants ----------
const WORLD_W = 14400, WORLD_H = 14400;
const PLAYER_R = 18;
const TOOLS = {
  // Each tool has a real job now. Fists are intentionally bad at everything,
  // Axe = wood + respectable combat, Pickaxe = stone/rock, Sword = creature combat,
  // Bow = safer ranged combat. resourcePower controls how fast scenery breaks.
  Fist:    { dmg: 1.0, gather: 0.06, resourcePower: 0.08, range: 42, swing: 0.20, cadence: 0.50, cost: null, woodWall: 1.0, stoneWall: 0.45 },
  Axe:     { dmg: 7.0, gather: 3.2, resourcePower: 1.20, range: 50, swing: 0.42, cadence: 0.55, cost: { wood: 8 }, gatherFor: "tree", woodWall: 12.0, stoneWall: 3.5 },
  Pickaxe: { dmg: 5.0, gather: 2.5, resourcePower: 1.15, range: 50, swing: 0.28, cadence: 0.50, cost: { wood: 6, stone: 4 }, gatherFor: "rock", woodWall: 4.0, stoneWall: 14.0 },
  Sword:   { dmg: 12.0, gather: 0.08, resourcePower: 0.12, range: 56, swing: 0.17, cadence: 0.38, cost: { wood: 6, stone: 8 }, woodWall: 5.0, stoneWall: 2.5 },
  Bow:     { dmg: 9.0, gather: 0.12, resourcePower: 0.18, range: 46, swing: 0.22, cadence: 0.55, cost: { wood: 10, gold: 3 }, woodWall: 2.0, stoneWall: 1.5 },
};
const WALL_COST = { wood: 6 };
const CRAFTABLES = [
  { id: "Axe", name: "Axe", cost: { wood: 8 }, desc: "Best on trees & wood walls; decent creature damage" },
  { id: "Pickaxe", name: "Pickaxe", cost: { wood: 6, stone: 4 }, desc: "Best on rock & stone walls; weaker vs creatures" },
  { id: "Sword", name: "Sword", cost: { wood: 6, stone: 8 }, desc: "Best melee creature damage — terrible for gathering" },
  { id: "Bow", name: "Bow", cost: { wood: 10, gold: 3 }, desc: "Safer ranged creature damage (uses wood)" },
  { id: "Wall", name: "Wood Wall", cost: { wood: 6 }, desc: "Permanent breakable barrier (also in hotbar)" },
  { id: "Tower", name: "Battle Tower", cost: { wood: 18, stone: 12 }, desc: "Auto-attacks nearby enemies" },
  { id: "Saddle", name: "Saddle", cost: { wood: 12, stone: 6, gold: 2 }, desc: "Ride adult/boss pets" },
  { id: "HealPack", name: "Heal Pack", cost: { wood: 3, gold: 2 }, desc: "Restore 40 HP" },
];

const COLORS = [
  // Blues
  "#3fa7ff", "#4d7cff", "#2457c5", "#6ec8ff", "#a0e0ff",
  // Cyans / teals
  "#5ce1e6", "#2fc7b5", "#1b8f8a", "#7ce8d4",
  // Greens
  "#7be08a", "#4fc26b", "#2f8f4e", "#a8e66f", "#78b159",
  // Yellows / golds
  "#f2c94c", "#ffd166", "#e3a72f", "#fff08a",
  // Oranges
  "#ff9a4d", "#ff7a2f", "#d86624", "#ffb36b",
  // Reds
  "#ff5c4d", "#d94343", "#a92f3b", "#ff7c73",
  // Pinks
  "#f283a6", "#ff9bc7", "#d85c9d", "#ffb7d5",
  // Purples
  "#c77dff", "#9b6cff", "#7a4cc2", "#e0a6ff",
  // Browns / earth
  "#b9794b", "#8b5a3c", "#d19a66", "#6f4a35",
  // Neutrals
  "#e8c9a0", "#d8d8d8", "#9da7ad", "#59636b", "#f2f0e6",
  // Dark colors
  "#24313f", "#2f3b2f", "#3b2947", "#4a2d2d"
];

const HOME_THEMES = {
  forestGold: {
    name:"Forest Gold", desc:"Classic survival greens with warm gold.",
    bg:"#1E2D24", panel:"#2B3F33", panel2:"#203129",
    primary:"#D6A441", primary2:"#B78331",
    secondary:"#4A6A58", secondary2:"#385143",
    accent:"#8FBF6A", text:"#F2EEDC", muted:"#C7C0A8", special:"#D6A441"
  },
  blueEmber: {
    name:"Blue Ember", desc:"Cool navy and teal with a bright orange Play button.",
    bg:"#18242E", panel:"#243646", panel2:"#1B2A37",
    primary:"#F2A93B", primary2:"#C97922",
    secondary:"#4D7EA8", secondary2:"#395F82",
    accent:"#7FD1C8", text:"#F4F7FA", muted:"#B8C7D3", special:"#F2A93B"
  },
  sunsetJungle: {
    name:"Sunset Jungle", desc:"Jungle greens, sunset orange and berry accents.",
    bg:"#213128", panel:"#314737", panel2:"#26382C",
    primary:"#F08A24", primary2:"#C96318",
    secondary:"#A64D79", secondary2:"#7D365A",
    accent:"#F2D16B", text:"#FFF3E3", muted:"#D6C4AF", special:"#F2D16B"
  },
  royalStone: {
    name:"Royal Stone", desc:"Charcoal stone, royal blue and restrained gold.",
    bg:"#22252E", panel:"#343948", panel2:"#292D39",
    primary:"#C89B3C", primary2:"#9D7428",
    secondary:"#5A67A8", secondary2:"#444E82",
    accent:"#8E9FE6", text:"#F3F0E8", muted:"#C6C1B7", special:"#C89B3C"
  },
  mossCream: {
    name:"Moss & Cream", desc:"Soft moss greens and warm creamy neutrals.",
    bg:"#2B362C", panel:"#425244", panel2:"#334035",
    primary:"#D9B65D", primary2:"#AF8D3E",
    secondary:"#6C8B74", secondary2:"#536B59",
    accent:"#A7D49B", text:"#FFF8EA", muted:"#D8D0BC", special:"#D9B65D"
  },
  lavaNight: {
    name:"Lava Night", desc:"Dark plum, ember red and glowing gold.",
    bg:"#1D1A1F", panel:"#2D2832", panel2:"#231F27",
    primary:"#D94F2A", primary2:"#A9361E",
    secondary:"#6A4C93", secondary2:"#503970",
    accent:"#F0B94A", text:"#F8F1E8", muted:"#CFC3B7", special:"#F0B94A"
  },
  mintTech: {
    name:"Mint Tech", desc:"Dark teal, mint aqua and clean blue.",
    bg:"#152728", panel:"#223A3C", panel2:"#192F31",
    primary:"#49C6B4", primary2:"#2EA18F",
    secondary:"#3A6EA5", secondary2:"#2C537C",
    accent:"#FFD166", text:"#F3FFFD", muted:"#B8D7D3", special:"#FFD166"
  },
  oceanCoral: {
    name:"Ocean Coral", desc:"Deep ocean blue with coral and seafoam.",
    bg:"#142C38", panel:"#1F4656", panel2:"#183744",
    primary:"#FF7D66", primary2:"#D95A49",
    secondary:"#2F7D8C", secondary2:"#245F6B",
    accent:"#79E0C8", text:"#F5FBFC", muted:"#B7D4DB", special:"#FFD36E"
  },
  frostPine: {
    name:"Frost Pine", desc:"Cold pine green, icy blue and winter silver.",
    bg:"#1B2D2C", panel:"#29413F", panel2:"#203432",
    primary:"#9FD8E5", primary2:"#6FAEBC",
    secondary:"#4F7771", secondary2:"#395A56",
    accent:"#D2EEF4", text:"#F3F8F7", muted:"#B9CECA", special:"#D7C77A"
  },
  desertDusk: {
    name:"Desert Dusk", desc:"Dusty purple, sandstone and sunset copper.",
    bg:"#302733", panel:"#493B4B", panel2:"#392E3B",
    primary:"#D88B4B", primary2:"#AE6432",
    secondary:"#7C5D7F", secondary2:"#5E4661",
    accent:"#E6C486", text:"#FAF0E4", muted:"#D1BEB1", special:"#E6C486"
  },
  crimsonSteel: {
    name:"Crimson Steel", desc:"Dark steel with strong crimson and cool silver.",
    bg:"#20252B", panel:"#303943", panel2:"#252C34",
    primary:"#C94D4D", primary2:"#963838",
    secondary:"#586979", secondary2:"#40505F",
    accent:"#A8BAC8", text:"#F4F6F7", muted:"#B9C2C8", special:"#E0B35D"
  },
  neonArcade: {
    name:"Neon Arcade", desc:"Bold violet, cyan and electric yellow.",
    bg:"#171526", panel:"#282343", panel2:"#201C36",
    primary:"#59E3D2", primary2:"#33B6A8",
    secondary:"#6C5CE7", secondary2:"#5143BD",
    accent:"#F8E35E", text:"#FBF9FF", muted:"#C9C3E0", special:"#FF8ACF"
  },

  fireElement: {
    name:"Fire Element", desc:"Molten charcoal, flame orange and hot ember red.",
    bg:"#241713", panel:"#3A211B", panel2:"#2D1915",
    primary:"#FF7A24", primary2:"#D94A16",
    secondary:"#A83D28", secondary2:"#762A20",
    accent:"#FFD166", text:"#FFF3E8", muted:"#DAB9A8", special:"#FFB347"
  },

  waterElement: {
    name:"Water Element", desc:"Deep ocean blue, aqua and clear icy highlights.",
    bg:"#102735", panel:"#173F52", panel2:"#123242",
    primary:"#4CC9F0", primary2:"#2A8FB6",
    secondary:"#296A8A", secondary2:"#1F4F68",
    accent:"#8BE9FD", text:"#F1FBFF", muted:"#B7D8E4", special:"#73D2DE"
  },

  blossomCandy: {
    name:"Blossom Candy", desc:"Soft pink, lavender and peach with creamy text.",
    bg:"#352631", panel:"#513947", panel2:"#402D38",
    primary:"#FF9EC4", primary2:"#D76D9A",
    secondary:"#A77BC8", secondary2:"#795796",
    accent:"#FFD7A8", text:"#FFF7FB", muted:"#E6C9D7", special:"#FFB7D5"
  },

  moonPetal: {
    name:"Moon Petal", desc:"Dusty rose, moonlit violet and soft silver-blue.",
    bg:"#272436", panel:"#3C3650", panel2:"#302B42",
    primary:"#DDA0DD", primary2:"#B575B8",
    secondary:"#6F78B7", secondary2:"#51598C",
    accent:"#C7D7FF", text:"#FBF7FF", muted:"#D4CBE0", special:"#F1B9D8"
  },

  kemonoCamp: {
    name:"Kemono Camp", desc:"Warm woodland browns, fox orange and soft cream.",
    bg:"#2C241E", panel:"#44352B", panel2:"#352920",
    primary:"#E58A3A", primary2:"#B96326",
    secondary:"#7A5D46", secondary2:"#594333",
    accent:"#F0C987", text:"#FFF4E7", muted:"#D8C4B0", special:"#D96D44"
  },

  cyberCircuit: {
    name:"Cyber Circuit", desc:"Black-blue tech panels with electric cyan and lime.",
    bg:"#0D151C", panel:"#14242E", panel2:"#101C24",
    primary:"#37E6D0", primary2:"#1FAF9F",
    secondary:"#245C7A", secondary2:"#183F55",
    accent:"#B7F34A", text:"#F3FFFF", muted:"#A9C9D2", special:"#55E6FF"
  },

  voidObsidian: {
    name:"Void Obsidian", desc:"Near-black obsidian with violet glow and cold silver.",
    bg:"#0E0D12", panel:"#191720", panel2:"#131117",
    primary:"#7E57C2", primary2:"#573A8B",
    secondary:"#302D3B", secondary2:"#22202B",
    accent:"#A68CFF", text:"#F3F1F7", muted:"#AAA4B3", special:"#C6B7FF"
  },

  bloodMoon: {
    name:"Blood Moon", desc:"Dark charcoal, deep crimson and muted moon-gold.",
    bg:"#171313", panel:"#291B1D", panel2:"#201617",
    primary:"#B93A3A", primary2:"#812828",
    secondary:"#4A3438", secondary2:"#342529",
    accent:"#D9B56D", text:"#F7EEEE", muted:"#C7B3B3", special:"#E2C47C"
  },

  hacker: {
    name:"Hacker", desc:"Terminal black, matrix green and sharp code glow.",
    bg:"#07110A", panel:"#0D1B10", panel2:"#09140C",
    primary:"#39FF6A", primary2:"#17B845",
    secondary:"#123B21", secondary2:"#0B2816",
    accent:"#89FF9E", text:"#E9FFF0", muted:"#9BC9A6", special:"#39FF6A"
  },

  cottonCandy: {
    name:"Cotton Candy", desc:"Pastel pink, sky blue and sugary lavender.",
    bg:"#362A3F", panel:"#514160", panel2:"#40334D",
    primary:"#FF9ED8", primary2:"#D96FB2",
    secondary:"#77C9FF", secondary2:"#4E9BCF",
    accent:"#DAB6FF", text:"#FFF8FF", muted:"#E7CFEA", special:"#9DEBFF"
  },

  blackNeon: {
    name:"Black Neon", desc:"Pitch-black panels cut by cyan, magenta and lime neon.",
    bg:"#050607", panel:"#0B0D10", panel2:"#07090B",
    primary:"#00F0FF", primary2:"#009BA6",
    secondary:"#FF3DBD", secondary2:"#AA267F",
    accent:"#B7FF3C", text:"#F6FFFF", muted:"#A8BAC0", special:"#00F0FF"
  },

  blackNight: {
    name:"Black Night", desc:"Near-black midnight, cold stars and soft moon silver.",
    bg:"#06080D", panel:"#0D1119", panel2:"#080B12",
    primary:"#B7C8E8", primary2:"#7F91B2",
    secondary:"#202A3D", secondary2:"#141C2A",
    accent:"#E8F0FF", text:"#F6F8FD", muted:"#AEB8C8", special:"#D8E4FF"
  },

  thunderStorm: {
    name:"Thunder Storm", desc:"Storm clouds, electric blue and violent lightning flashes.",
    bg:"#121820", panel:"#1B2530", panel2:"#151D26",
    primary:"#6DA7FF", primary2:"#416FBC",
    secondary:"#394A5E", secondary2:"#283644",
    accent:"#D7E7FF", text:"#F3F7FC", muted:"#AEBBC8", special:"#A9D5FF"
  },

  glitch: {
    name:"Glitch", desc:"Black corrupted-screen look with RGB tears, scanlines and signal noise.",
    bg:"#020304", panel:"#090B0E", panel2:"#050608",
    primary:"#00EAF2", primary2:"#008F98",
    secondary:"#F238A6", secondary2:"#952269",
    accent:"#F5F7FA", text:"#F8FAFC", muted:"#9FA8B2", special:"#FF355E"
  },

  slime: {
    name:"Slime", desc:"Toxic goo greens, bubbles and squishy slime drips.",
    bg:"#142014", panel:"#213421", panel2:"#182818",
    primary:"#78E34A", primary2:"#4FA52E",
    secondary:"#3B7C42", secondary2:"#28582E",
    accent:"#B9FF70", text:"#F5FFE9", muted:"#BFD5AC", special:"#8CFF4D"
  },

  windElement: {
    name:"Wind Element", desc:"Cool sky teal, fast white gusts and airy cyan.",
    bg:"#183337", panel:"#244B4F", panel2:"#1C3C40",
    primary:"#A8F3E7", primary2:"#67C8BB",
    secondary:"#4E8B93", secondary2:"#35676E",
    accent:"#E7FFFF", text:"#F4FFFF", muted:"#BDDADD", special:"#B9F7FF"
  },

  plantElement: {
    name:"Plant Element", desc:"Deep leaf green, fresh vines and bright new-growth lime.",
    bg:"#132718", panel:"#204028", panel2:"#18321F",
    primary:"#79D85B", primary2:"#4DAE38",
    secondary:"#356D42", secondary2:"#244F30",
    accent:"#B7F27D", text:"#F4FCEB", muted:"#BDD3AF", special:"#8BE46A"
  },

  stoneElement: {
    name:"Stone Element", desc:"Slate, granite gray and warm mineral highlights.",
    bg:"#262A2C", panel:"#3A4043", panel2:"#2F3437",
    primary:"#A6B0B5", primary2:"#737E84",
    secondary:"#5D666A", secondary2:"#444C50",
    accent:"#D7C18E", text:"#F4F2EC", muted:"#C1C1BB", special:"#C8B27A"
  },

  earthElement: {
    name:"Earth Element", desc:"Rich soil browns, forest moss and warm grounded energy.",
    bg:"#241D16", panel:"#3A2D21", panel2:"#2D231A",
    primary:"#A87947", primary2:"#79522F",
    secondary:"#53643C", secondary2:"#39452B",
    accent:"#C7B06A", text:"#F8F1E4", muted:"#D1C1A8", special:"#91A75C"
  },

  soundElement: {
    name:"Sound Element", desc:"Deep violet-blue with glowing waves and rhythmic pulse lines.",
    bg:"#181727", panel:"#292743", panel2:"#201E35",
    primary:"#8A7DFF", primary2:"#5E52C8",
    secondary:"#355C8C", secondary2:"#274364",
    accent:"#7FE7FF", text:"#F7F5FF", muted:"#C4BEDB", special:"#D39CFF"
  },

  strawberryMilk: {
    name:"Strawberry Milk", desc:"Creamy strawberry pink, soft milk white and little berry-red accents.",
    bg:"#38272F", panel:"#563844", panel2:"#442D36",
    primary:"#FF7FA8", primary2:"#D65A83",
    secondary:"#A95D78", secondary2:"#7C4259",
    accent:"#FFE7ED", text:"#FFF8FA", muted:"#E9C9D3", special:"#FF4F7B"
  },

  peachBunny: {
    name:"Peach Bunny", desc:"Peach cream, bunny pink and a warm cozy cocoa outline.",
    bg:"#392B2B", panel:"#57403D", panel2:"#453431",
    primary:"#FFAE84", primary2:"#D88463",
    secondary:"#D9829A", secondary2:"#A75F73",
    accent:"#FFE0C7", text:"#FFF8F2", muted:"#E6C9BD", special:"#FFB7CB"
  },

  bubblegumSky: {
    name:"Bubblegum Sky", desc:"Candy-blue skies with pink bubbles and lavender highlights.",
    bg:"#2B2941", panel:"#403D60", panel2:"#34314E",
    primary:"#74CFFF", primary2:"#469AC7",
    secondary:"#F58BC7", secondary2:"#C35F98",
    accent:"#D7B8FF", text:"#FAF8FF", muted:"#D5CDEA", special:"#FFB6E2"
  },

  honeyBee: {
    name:"Honey Bee", desc:"Honey gold, soft black-brown and cheerful cream with buzzing energy.",
    bg:"#30291D", panel:"#493D28", panel2:"#3A301F",
    primary:"#F4C542", primary2:"#C99A25",
    secondary:"#6B5431", secondary2:"#4E3D24",
    accent:"#FFF0A6", text:"#FFF9E8", muted:"#DCCDA5", special:"#FFC83D"
  },

  cozyPlush: {
    name:"Cozy Plush", desc:"Soft cocoa, oatmeal cream and sleepy mint like a plush blanket.",
    bg:"#302B2B", panel:"#48413F", panel2:"#393331",
    primary:"#D8B59C", primary2:"#B18A70",
    secondary:"#7FA99A", secondary2:"#5D8175",
    accent:"#F2DEC5", text:"#FFF9F2", muted:"#D7C9BF", special:"#A8D7C7"
  },

  arcticPulse: {
    name:"Arctic Pulse", desc:"Midnight ice blue, sharp cyan and cold white energy pulses.",
    bg:"#101C28", panel:"#172B3B", panel2:"#122230",
    primary:"#61D9FF", primary2:"#329CC5",
    secondary:"#315D83", secondary2:"#244661",
    accent:"#D9F7FF", text:"#F4FCFF", muted:"#B6D5E1", special:"#7DEBFF"
  },

  chromeWave: {
    name:"Chrome Wave", desc:"Dark chrome, bright silver and cool blue reflective sweeps.",
    bg:"#191D22", panel:"#292F36", panel2:"#20252B",
    primary:"#C9D3DC", primary2:"#8997A4",
    secondary:"#4B6D89", secondary2:"#354F65",
    accent:"#F5FAFF", text:"#F6F8FA", muted:"#BCC4CB", special:"#A9CFFF"
  },

  nightDrive: {
    name:"Night Drive", desc:"Black highway nights with neon magenta, cyan and violet city light.",
    bg:"#090A12", panel:"#141625", panel2:"#0D0F19",
    primary:"#FF4BB8", primary2:"#B72F81",
    secondary:"#5C48D8", secondary2:"#40319E",
    accent:"#40E7FF", text:"#F8F6FF", muted:"#BEB7D2", special:"#A36BFF"
  },

  toxicReactor: {
    name:"Toxic Reactor", desc:"Graphite black, reactor lime and hazardous yellow-green glow.",
    bg:"#121711", panel:"#1D281A", panel2:"#161F14",
    primary:"#9AF542", primary2:"#67B624",
    secondary:"#416B36", secondary2:"#2D4E27",
    accent:"#E6FF5C", text:"#F5FFE8", muted:"#BCCDAA", special:"#C8FF36"
  },

  solarPunk: {
    name:"Solar Punk", desc:"Leaf green, solar gold and clean aqua with bright eco-tech energy.",
    bg:"#173025", panel:"#234838", panel2:"#1B392C",
    primary:"#E4C84A", primary2:"#B79C2E",
    secondary:"#4C9870", secondary2:"#377253",
    accent:"#7BE1C1", text:"#F6FFF6", muted:"#BED7C5", special:"#F3E276"
  },

  dragonForge: {
    name:"Dragon Forge", desc:"Black iron, dragon-fire crimson and molten forge gold.",
    bg:"#1A1110", panel:"#2D1B18", panel2:"#221512",
    primary:"#F05A2A", primary2:"#B9391C",
    secondary:"#8B2E2E", secondary2:"#642020",
    accent:"#FFD36A", text:"#FFF3E8", muted:"#D8B8A7", special:"#FF8A33"
  },

  celestialCrown: {
    name:"Celestial Crown", desc:"Royal midnight blue, star-silver and crown-gold celestial light.",
    bg:"#15162B", panel:"#242642", panel2:"#1B1D35",
    primary:"#D9B85F", primary2:"#AA883C",
    secondary:"#566CC5", secondary2:"#3F5197",
    accent:"#C8E2FF", text:"#FBFAFF", muted:"#C5C5DD", special:"#F2D77C"
  },

  titanStorm: {
    name:"Titan Storm", desc:"Heavy storm navy, steel blue and giant white-blue energy strikes.",
    bg:"#111923", panel:"#1C2936", panel2:"#151F2A",
    primary:"#7DB6FF", primary2:"#4A7FBE",
    secondary:"#53687B", secondary2:"#3A4B5B",
    accent:"#EDF6FF", text:"#F6FAFE", muted:"#B8C7D4", special:"#A7D6FF"
  },

  goldenEclipse: {
    name:"Golden Eclipse", desc:"Near-black space with a huge warm gold eclipse and amber glow.",
    bg:"#0F0D09", panel:"#1B1710", panel2:"#14110C",
    primary:"#E6B84C", primary2:"#AA7D25",
    secondary:"#4E4330", secondary2:"#382F22",
    accent:"#FFE7A1", text:"#FFF8E7", muted:"#CFC3A4", special:"#FFD267"
  },

  sakuraBreeze: {
    name:"Sakura Breeze", desc:"Gentle cherry-blossom pink, cream and spring-leaf green.",
    bg:"#342A30", panel:"#4C3B43", panel2:"#3D3036",
    primary:"#F3A6BD", primary2:"#C97991",
    secondary:"#799B78", secondary2:"#59745A",
    accent:"#FFE3E9", text:"#FFF8FA", muted:"#DDC7CE", special:"#FFBED1"
  },

  lavenderDream: {
    name:"Lavender Dream", desc:"Sleepy lavender, moon-blue and soft pearl for a dreamy calm look.",
    bg:"#2D293D", panel:"#443E59", panel2:"#373249",
    primary:"#B7A0E8", primary2:"#8A73BD",
    secondary:"#718AB7", secondary2:"#566B91",
    accent:"#E8DEFF", text:"#FBF9FF", muted:"#D1C9E1", special:"#D7C3FF"
  },

  rainyWindow: {
    name:"Rainy Window", desc:"Soft rainy slate, cool blue-gray and dim window-light silver.",
    bg:"#202B33", panel:"#31414B", panel2:"#27343C",
    primary:"#83AFC4", primary2:"#5E8498",
    secondary:"#526A79", secondary2:"#3D505C",
    accent:"#C9DCE5", text:"#F2F7F9", muted:"#B8C7CD", special:"#A9CCDC"
  },

  quietMeadow: {
    name:"Quiet Meadow", desc:"Soft grass green, pale sky blue and warm afternoon cream.",
    bg:"#28372A", panel:"#3D513F", panel2:"#304333",
    primary:"#9BCB7A", primary2:"#72A154",
    secondary:"#79A7B0", secondary2:"#5B8088",
    accent:"#F0E6B2", text:"#F8F8EB", muted:"#CBD4BA", special:"#CFE89D"
  }

};

const HOME_THEME_EFFECTS = {
  forestGold:   {mode:"fall",   count:24, glyphs:["🍃","🍂","✦"], colors:["#8FBF6A","#D6A441","#C8E5A7"], special:"leafSway", size:[20,38]},
  blueEmber:    {mode:"rise",   count:24, glyphs:["✦","◆","•"], colors:["#F2A93B","#7FD1C8","#4D7EA8"], special:"emberMist", size:[17,31]},
  sunsetJungle: {mode:"float",  count:24, glyphs:["✿","✦","●"], colors:["#F08A24","#A64D79","#F2D16B"], special:"fireflies", size:[18,34]},
  royalStone:   {mode:"drift",  count:20, glyphs:["◆","◇","✦"], colors:["#8E9FE6","#C89B3C","#D7D2C8"], special:"runeRing", size:[19,33]},
  mossCream:    {mode:"float",  count:25, glyphs:["✦","•","❋"], colors:["#A7D49B","#D9B65D","#FFF8EA"], special:"pollenHalo", size:[17,30]},
  lavaNight:    {mode:"rise",   count:28, glyphs:["▲","●","✦"], colors:["#D94F2A","#F0B94A","#A53A22"], special:"heatWave", size:[18,34]},
  mintTech:     {mode:"drift",  count:23, glyphs:["□","+","▦","◆"], colors:["#49C6B4","#3A6EA5","#FFD166"], special:"circuitGrid", size:[18,31], tech:true},
  oceanCoral:   {mode:"rise",   count:25, glyphs:["○","◌","●"], colors:["#79E0C8","#4CC9F0","#FFD36E"], special:"bubbleWave", size:[20,38]},
  frostPine:    {mode:"fall",   count:29, glyphs:["❄","✦","❅"], colors:["#D2EEF4","#9FD8E5","#FFFFFF"], special:"iceShimmer", size:[20,38]},
  desertDusk:   {mode:"drift",  count:24, glyphs:["●","◇","✦"], colors:["#D88B4B","#E6C486","#9C789E"], special:"dustGust", size:[17,31]},
  crimsonSteel: {mode:"rise",   count:21, glyphs:["✦","◆","•"], colors:["#C94D4D","#A8BAC8","#DCE5EC"], special:"silverSteel", size:[18,32]},
  neonArcade:   {mode:"pulse",  count:26, glyphs:["■","◆","+","✦"], colors:["#59E3D2","#F8E35E","#FF8ACF","#6C5CE7"], special:"arcadeGrid", size:[18,32], tech:true},
  fireElement:  {mode:"rise",   count:31, glyphs:["▲","●","✦"], colors:["#FF7A24","#D94A16","#FFD166"], special:"fireFlare", size:[20,38]},
  waterElement: {mode:"fall",   count:31, glyphs:["○","│","●"], colors:["#4CC9F0","#8BE9FD","#296A8A"], special:"rainWave", size:[16,29]},
  blossomCandy: {mode:"fall",   count:26, glyphs:["♥","♡","✿","✦"], colors:["#FF9EC4","#FFD7A8","#DDA0DD"], special:"petalBurst", size:[22,40]},
  moonPetal:    {mode:"float",  count:23, glyphs:["☾","✦","✿","·"], colors:["#C7D7FF","#DDA0DD","#F1B9D8"], special:"moonOrb", size:[20,36]},
  kemonoCamp:   {mode:"fall",   count:21, glyphs:["🐾","🍂","✦"], colors:["#E58A3A","#F0C987","#D96D44"], special:"pawTrail", size:[24,42]},
  cyberCircuit: {mode:"drift",  count:29, glyphs:["0","1","+","□","▦"], colors:["#37E6D0","#B7F34A","#55E6FF"], special:"dataRain", size:[18,32], tech:true},
  voidObsidian: {mode:"float",  count:25, glyphs:["✦","✧","◆","●"], colors:["#A68CFF","#C6B7FF","#6C55A3"], special:"voidPulse", size:[19,35]},
  bloodMoon:    {mode:"rise",   count:23, glyphs:["●","✦","◆"], colors:["#B93A3A","#D9B56D","#7D2A2A"], special:"bloodMoon", size:[18,34]},

  hacker:       {mode:"fall",   count:34, glyphs:["0","1","01","10"], colors:["#39FF6A","#89FF9E","#1CC84B"], special:"hackerScan", size:[16,28], tech:true},
  cottonCandy:  {mode:"float",  count:27, glyphs:["♥","♡","✦","☁"], colors:["#FF9ED8","#77C9FF","#DAB6FF","#FFF2FD"], special:"cottonCloud", size:[24,46]},
  blackNeon:    {mode:"pulse",  count:25, glyphs:["■","◆","+","✦"], colors:["#00F0FF","#FF3DBD","#B7FF3C"], special:"blackNeon", size:[20,36], tech:true},
  blackNight:   {mode:"pulse",  count:27, glyphs:["✦","·","✧","⋆"], colors:["#E8F0FF","#9CB0D4","#C8D8F4"], special:"nightSky", size:[16,30]},
  thunderStorm: {mode:"fall",   count:34, glyphs:["│","•","✦"], colors:["#A9D5FF","#D7E7FF","#5F84AF"], special:"lightningStorm", size:[15,28]},
  glitch:       {mode:"pulse",  count:14, glyphs:["■","▪","•"], colors:["#FF355E","#00EAF2","#F8FAFC","#295BFF"], special:"glitchBlackScreen", size:[8,18], tech:true},
  slime:        {mode:"rise",   count:27, glyphs:["●","○","◌","•"], colors:["#78E34A","#B9FF70","#48B82C"], special:"slimeDrip", size:[22,42]},
  windElement:  {mode:"drift",  count:28, glyphs:["≈","~","✦","·"], colors:["#A8F3E7","#E7FFFF","#67C8BB"], special:"windGust", size:[20,36]},
  plantElement: {mode:"fall",   count:28, glyphs:["🍃","🌿","✦","❋"], colors:["#79D85B","#B7F27D","#4DAE38"], special:"vineGrow", size:[23,42]},
  stoneElement: {mode:"fall",   count:25, glyphs:["◆","▪","⬟","•"], colors:["#A6B0B5","#737E84","#D7C18E"], special:"stoneQuake", size:[20,38]},
  earthElement: {mode:"rise",   count:26, glyphs:["●","◆","•","✦"], colors:["#A87947","#91A75C","#C7B06A"], special:"earthPulse", size:[20,38]},
  soundElement: {mode:"pulse",  count:22, glyphs:["♪","♫","•","✦"], colors:["#8A7DFF","#7FE7FF","#D39CFF"], special:"soundWave", size:[18,34]},

  strawberryMilk:{mode:"fall", count:27, glyphs:["🍓","♥","✦","•"], colors:["#FF7FA8","#FFE7ED","#FF4F7B"], special:"strawberrySwirl", size:[20,39]},
  peachBunny:    {mode:"float",count:25, glyphs:["♡","🐰","✦","•"], colors:["#FFAE84","#FFB7CB","#FFE0C7"], special:"bunnyHop", size:[21,40]},
  bubblegumSky:  {mode:"rise", count:29, glyphs:["○","◌","♡","✦"], colors:["#74CFFF","#F58BC7","#D7B8FF"], special:"bubblePop", size:[21,42]},
  honeyBee:      {mode:"drift",count:24, glyphs:["🐝","✦","◆","•"], colors:["#F4C542","#FFF0A6","#6B5431"], special:"beeBuzz", size:[19,36]},
  cozyPlush:     {mode:"float",count:23, glyphs:["♥","☁","✦","♡"], colors:["#D8B59C","#A8D7C7","#F2DEC5"], special:"plushGlow", size:[22,42]},

  arcticPulse:   {mode:"pulse",count:25, glyphs:["❄","◇","✦","•"], colors:["#61D9FF","#D9F7FF","#7DEBFF"], special:"arcticPulse", size:[18,34]},
  chromeWave:    {mode:"drift",count:21, glyphs:["◆","◇","—","✦"], colors:["#C9D3DC","#F5FAFF","#A9CFFF"], special:"chromeSweep", size:[18,32]},
  nightDrive:    {mode:"drift",count:25, glyphs:["━","◆","✦","•"], colors:["#FF4BB8","#40E7FF","#A36BFF"], special:"nightDrive", size:[18,34]},
  toxicReactor:  {mode:"pulse",count:27, glyphs:["☢","◆","•","✦"], colors:["#9AF542","#E6FF5C","#67B624"], special:"toxicReactor", size:[18,34]},
  solarPunk:     {mode:"fall", count:26, glyphs:["🍃","✦","◆","•"], colors:["#E4C84A","#7BE1C1","#4C9870"], special:"solarPunk", size:[20,38]},

  dragonForge:   {mode:"rise", count:30, glyphs:["▲","◆","✦","•"], colors:["#F05A2A","#FFD36A","#8B2E2E"], special:"dragonForge", size:[20,40]},
  celestialCrown:{mode:"float",count:26, glyphs:["✦","✧","◆","♛"], colors:["#D9B85F","#C8E2FF","#566CC5"], special:"celestialCrown", size:[20,38]},
  titanStorm:    {mode:"fall", count:31, glyphs:["│","◆","✦","•"], colors:["#7DB6FF","#EDF6FF","#53687B"], special:"titanStorm", size:[17,32]},
  goldenEclipse: {mode:"pulse",count:23, glyphs:["●","○","✦","◆"], colors:["#E6B84C","#FFE7A1","#AA7D25"], special:"goldenEclipse", size:[20,38]},

  sakuraBreeze:  {mode:"fall", count:28, glyphs:["🌸","✿","♡","✦"], colors:["#F3A6BD","#FFE3E9","#799B78"], special:"sakuraBreeze", size:[21,40]},
  lavenderDream: {mode:"float",count:24, glyphs:["☾","✦","☁","·"], colors:["#B7A0E8","#E8DEFF","#718AB7"], special:"lavenderDream", size:[20,38]},
  rainyWindow:   {mode:"fall", count:32, glyphs:["│","•","○","·"], colors:["#83AFC4","#C9DCE5","#526A79"], special:"rainyWindow", size:[14,28]},
  quietMeadow:   {mode:"float",count:25, glyphs:["✦","🍃","•","❋"], colors:["#9BCB7A","#F0E6B2","#79A7B0"], special:"quietMeadow", size:[18,34]}
};

const HOME_WORLD_BACKGROUND_EFFECTS = {
  forestGold: {
    filter:"saturate(1.09) contrast(1.03) brightness(.88) sepia(.06)",
    overlay:"radial-gradient(circle at 20% 18%,rgba(214,164,65,.18),transparent 28%), radial-gradient(circle at 78% 72%,rgba(143,191,106,.16),transparent 34%)",
    opacity:.30, blend:"soft-light"
  },
  blueEmber: {
    filter:"saturate(1.06) contrast(1.07) brightness(.82) hue-rotate(4deg)",
    overlay:"radial-gradient(circle at 18% 78%,rgba(242,169,59,.22),transparent 27%), radial-gradient(circle at 80% 16%,rgba(127,209,200,.18),transparent 32%)",
    opacity:.34, blend:"screen"
  },
  sunsetJungle: {
    filter:"saturate(1.14) contrast(1.05) brightness(.84) sepia(.08)",
    overlay:"linear-gradient(180deg,rgba(166,77,121,.12),transparent 44%,rgba(240,138,36,.20) 78%,rgba(242,209,107,.16))",
    opacity:.35, blend:"soft-light"
  },
  royalStone: {
    filter:"saturate(.88) contrast(1.11) brightness(.79) hue-rotate(7deg)",
    overlay:"radial-gradient(circle at center,transparent 38%,rgba(90,103,168,.18) 74%,rgba(200,155,60,.14))",
    opacity:.32, blend:"screen"
  },
  mossCream: {
    filter:"saturate(.93) contrast(.99) brightness(.91) sepia(.08)",
    overlay:"radial-gradient(circle at 28% 24%,rgba(255,248,234,.14),transparent 22%), radial-gradient(circle at 72% 68%,rgba(167,212,155,.18),transparent 30%)",
    opacity:.30, blend:"soft-light"
  },
  lavaNight: {
    filter:"saturate(1.18) contrast(1.11) brightness(.68) sepia(.08)",
    overlay:"linear-gradient(0deg,rgba(217,79,42,.30),rgba(240,185,74,.10) 34%,transparent 68%)",
    opacity:.42, blend:"screen"
  },
  mintTech: {
    filter:"saturate(1.04) contrast(1.09) brightness(.78) hue-rotate(2deg)",
    overlay:"linear-gradient(rgba(73,198,180,.13) 1px,transparent 1px), linear-gradient(90deg,rgba(58,110,165,.12) 1px,transparent 1px), radial-gradient(circle at center,transparent,rgba(21,39,40,.28))",
    overlaySize:"54px 54px,54px 54px,cover", opacity:.30, blend:"screen"
  },
  oceanCoral: {
    filter:"saturate(1.12) contrast(1.02) brightness(.86) hue-rotate(2deg)",
    overlay:"radial-gradient(ellipse at 20% 70%,rgba(121,224,200,.20),transparent 34%), radial-gradient(ellipse at 82% 34%,rgba(255,125,102,.15),transparent 30%)",
    opacity:.36, blend:"screen"
  },
  frostPine: {
    filter:"saturate(.72) contrast(1.04) brightness(.92) hue-rotate(7deg)",
    overlay:"linear-gradient(110deg,transparent 15%,rgba(210,238,244,.18) 42%,rgba(255,255,255,.22) 50%,rgba(159,216,229,.12) 60%,transparent 84%)",
    opacity:.34, blend:"screen"
  },
  desertDusk: {
    filter:"saturate(.94) contrast(1.05) brightness(.86) sepia(.16)",
    overlay:"linear-gradient(180deg,rgba(124,93,127,.12),transparent 48%,rgba(216,139,75,.22)), radial-gradient(circle at 84% 18%,rgba(230,196,134,.18),transparent 24%)",
    opacity:.35, blend:"soft-light"
  },
  crimsonSteel: {
    filter:"saturate(.70) contrast(1.18) brightness(.78)",
    overlay:"linear-gradient(110deg,transparent 24%,rgba(220,229,236,.18) 48%,transparent 53%), radial-gradient(circle at 82% 18%,rgba(201,77,77,.10),transparent 28%)",
    opacity:.33, blend:"screen"
  },
  neonArcade: {
    filter:"saturate(1.22) contrast(1.15) brightness(.76)",
    overlay:"linear-gradient(rgba(89,227,210,.12) 2px,transparent 2px), linear-gradient(90deg,rgba(255,138,207,.10) 2px,transparent 2px), radial-gradient(circle at 50% 76%,rgba(108,92,231,.22),transparent 44%)",
    overlaySize:"74px 74px,74px 74px,cover", opacity:.38, blend:"screen"
  },
  fireElement: {
    filter:"saturate(1.24) contrast(1.10) brightness(.78) sepia(.08)",
    overlay:"radial-gradient(ellipse at 50% 105%,rgba(255,122,36,.38),rgba(217,74,22,.18) 38%,transparent 68%)",
    opacity:.44, blend:"screen"
  },
  waterElement: {
    filter:"saturate(1.02) contrast(1.02) brightness(.88) hue-rotate(8deg)",
    overlay:"repeating-radial-gradient(ellipse at 50% 110%,rgba(139,233,253,.16) 0 3px,transparent 4px 44px)",
    opacity:.32, blend:"screen"
  },
  blossomCandy: {
    filter:"saturate(.96) contrast(.97) brightness(.94) hue-rotate(-5deg)",
    overlay:"radial-gradient(circle at 18% 20%,rgba(255,158,196,.19),transparent 29%), radial-gradient(circle at 78% 70%,rgba(221,160,221,.16),transparent 32%), radial-gradient(circle at 65% 18%,rgba(255,215,168,.12),transparent 24%)",
    opacity:.36, blend:"screen"
  },
  moonPetal: {
    filter:"saturate(.82) contrast(1.04) brightness(.74) hue-rotate(8deg)",
    overlay:"radial-gradient(circle at 82% 16%,rgba(199,215,255,.26),transparent 16%), radial-gradient(circle at center,transparent 34%,rgba(39,36,54,.32) 88%)",
    opacity:.38, blend:"screen"
  },
  kemonoCamp: {
    filter:"saturate(1.02) contrast(1.05) brightness(.82) sepia(.12)",
    overlay:"radial-gradient(ellipse at 50% 112%,rgba(229,138,58,.30),rgba(240,201,135,.12) 38%,transparent 68%)",
    opacity:.38, blend:"screen"
  },
  cyberCircuit: {
    filter:"saturate(1.04) contrast(1.17) brightness(.69) hue-rotate(8deg)",
    overlay:"linear-gradient(rgba(55,230,208,.14) 1px,transparent 1px), linear-gradient(90deg,rgba(183,243,74,.10) 1px,transparent 1px), linear-gradient(180deg,transparent,rgba(85,230,255,.08))",
    overlaySize:"42px 42px,42px 42px,cover", opacity:.38, blend:"screen"
  },
  voidObsidian: {
    filter:"saturate(.83) contrast(1.16) brightness(.58) hue-rotate(10deg)",
    overlay:"radial-gradient(circle at 50% 48%,rgba(166,140,255,.12),transparent 28%,rgba(14,13,18,.40) 72%), radial-gradient(circle at 80% 20%,rgba(198,183,255,.10),transparent 22%)",
    opacity:.42, blend:"screen"
  },
  bloodMoon: {
    filter:"saturate(.78) contrast(1.15) brightness(.63) sepia(.05)",
    overlay:"radial-gradient(circle at 82% 15%,rgba(185,58,58,.30),transparent 17%), radial-gradient(circle at center,transparent 36%,rgba(60,10,14,.34) 88%)",
    opacity:.44, blend:"screen"
  },
  hacker: {
    filter:"saturate(.72) contrast(1.20) brightness(.62) hue-rotate(12deg)",
    overlay:"repeating-linear-gradient(0deg,rgba(57,255,106,.09) 0 1px,transparent 1px 6px), linear-gradient(90deg,transparent 0 49%,rgba(57,255,106,.12) 50%,transparent 51%)",
    overlaySize:"100% 100%,100% 100%", opacity:.42, blend:"screen"
  },
  cottonCandy: {
    filter:"saturate(.91) contrast(.94) brightness(.98) hue-rotate(-3deg)",
    overlay:"radial-gradient(circle at 18% 25%,rgba(255,158,216,.22),transparent 30%), radial-gradient(circle at 78% 32%,rgba(119,201,255,.20),transparent 34%), radial-gradient(circle at 50% 78%,rgba(218,182,255,.18),transparent 36%)",
    opacity:.40, blend:"screen"
  },
  blackNeon: {
    filter:"saturate(1.18) contrast(1.25) brightness(.58)",
    overlay:"radial-gradient(circle at 0% 50%,rgba(255,61,189,.26),transparent 26%), radial-gradient(circle at 100% 42%,rgba(0,240,255,.24),transparent 28%), linear-gradient(180deg,transparent,rgba(183,255,60,.05))",
    opacity:.44, blend:"screen"
  },
  blackNight: {
    filter:"saturate(.62) contrast(1.10) brightness(.50) hue-rotate(4deg)",
    overlay:"radial-gradient(circle at 84% 14%,rgba(232,240,255,.24),transparent 15%), radial-gradient(circle at center,transparent 34%,rgba(2,4,10,.45) 86%)",
    opacity:.46, blend:"screen"
  },
  thunderStorm: {
    filter:"saturate(.62) contrast(1.18) brightness(.56) hue-rotate(4deg)",
    overlay:"linear-gradient(180deg,rgba(215,231,255,.06),rgba(18,24,32,.36)), repeating-linear-gradient(108deg,transparent 0 38px,rgba(169,213,255,.08) 39px 42px,transparent 43px 74px)",
    opacity:.46, blend:"screen"
  },
  glitch: {
    filter:"saturate(.78) contrast(1.08) brightness(.74) hue-rotate(-10deg)",
    overlay:"repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 5px), linear-gradient(90deg,transparent 0 18%,rgba(255,53,94,.12) 18% 19%,transparent 19% 54%,rgba(0,234,242,.12) 54% 55%,transparent 55%)",
    opacity:.44, blend:"screen"
  },
  slime: {
    filter:"saturate(1.16) contrast(1.06) brightness(.77) hue-rotate(4deg)",
    overlay:"radial-gradient(circle at 20% 85%,rgba(120,227,74,.24),transparent 30%), radial-gradient(circle at 78% 18%,rgba(185,255,112,.16),transparent 28%), linear-gradient(180deg,rgba(20,32,20,.10),rgba(72,184,44,.10))",
    opacity:.40, blend:"screen"
  },
  windElement: {
    filter:"saturate(.78) contrast(.99) brightness(.95) hue-rotate(5deg)",
    overlay:"repeating-linear-gradient(165deg,transparent 0 34px,rgba(231,255,255,.12) 35px 38px,transparent 39px 82px)",
    opacity:.30, blend:"screen"
  },
  plantElement: {
    filter:"saturate(1.18) contrast(1.04) brightness(.82) hue-rotate(-3deg)",
    overlay:"radial-gradient(circle at 15% 20%,rgba(183,242,125,.18),transparent 28%), radial-gradient(circle at 82% 78%,rgba(77,174,56,.18),transparent 34%)",
    opacity:.34, blend:"soft-light"
  },
  stoneElement: {
    filter:"grayscale(.24) saturate(.68) contrast(1.17) brightness(.76)",
    overlay:"radial-gradient(circle at center,transparent 32%,rgba(50,55,58,.30) 82%), linear-gradient(180deg,rgba(215,193,142,.05),transparent)",
    opacity:.34, blend:"multiply"
  },
  earthElement: {
    filter:"saturate(.88) contrast(1.08) brightness(.76) sepia(.15)",
    overlay:"radial-gradient(ellipse at 50% 108%,rgba(145,167,92,.23),rgba(168,121,71,.16) 36%,transparent 68%)",
    opacity:.40, blend:"screen"
  },
  soundElement: {
    filter:"saturate(.88) contrast(1.09) brightness(.73) hue-rotate(12deg)",
    overlay:"repeating-radial-gradient(circle at 50% 50%,rgba(127,231,255,.11) 0 2px,transparent 3px 46px), radial-gradient(circle at center,rgba(138,125,255,.10),transparent 48%)",
    opacity:.40, blend:"screen"
  },

  strawberryMilk: {
    filter:"saturate(.92) contrast(.96) brightness(.96) hue-rotate(-6deg)",
    overlay:"radial-gradient(circle at 18% 24%,rgba(255,127,168,.24),transparent 28%), radial-gradient(circle at 82% 70%,rgba(255,231,237,.20),transparent 34%)",
    opacity:.40, blend:"screen", overlayAnimation:"homeWorldCandyDrift 8s ease-in-out infinite alternate"
  },
  peachBunny: {
    filter:"saturate(.90) contrast(.96) brightness(.96) sepia(.04)",
    overlay:"radial-gradient(circle at 22% 74%,rgba(255,174,132,.22),transparent 30%), radial-gradient(circle at 76% 22%,rgba(255,183,203,.18),transparent 28%)",
    opacity:.38, blend:"screen", overlayAnimation:"homeWorldBunnyFloat 6.6s ease-in-out infinite alternate"
  },
  bubblegumSky: {
    filter:"saturate(.98) contrast(.97) brightness(.94) hue-rotate(4deg)",
    overlay:"radial-gradient(circle at 16% 70%,rgba(116,207,255,.20),transparent 18%), radial-gradient(circle at 55% 26%,rgba(245,139,199,.20),transparent 22%), radial-gradient(circle at 84% 62%,rgba(215,184,255,.18),transparent 20%)",
    opacity:.43, blend:"screen", overlayAnimation:"homeWorldBubbleFloat 7.2s ease-in-out infinite alternate"
  },
  honeyBee: {
    filter:"saturate(1.04) contrast(1.04) brightness(.90) sepia(.10)",
    overlay:"repeating-linear-gradient(120deg,rgba(244,197,66,.08) 0 12px,transparent 12px 34px), radial-gradient(circle at 72% 20%,rgba(255,240,166,.18),transparent 26%)",
    overlaySize:"72px 72px,cover", opacity:.34, blend:"soft-light", overlayAnimation:"homeWorldHoneyDrift 7.8s linear infinite"
  },
  cozyPlush: {
    filter:"saturate(.82) contrast(.94) brightness(.94) sepia(.05)",
    overlay:"radial-gradient(circle at 50% 52%,rgba(242,222,197,.18),transparent 44%), radial-gradient(circle at 20% 24%,rgba(168,215,199,.12),transparent 28%)",
    opacity:.36, blend:"screen", overlayAnimation:"homeWorldCozyGlow 9s ease-in-out infinite alternate"
  },

  arcticPulse: {
    filter:"saturate(.76) contrast(1.12) brightness(.79) hue-rotate(8deg)",
    overlay:"radial-gradient(circle at 50% 50%,transparent 22%,rgba(97,217,255,.15) 42%,transparent 64%), radial-gradient(circle at 82% 16%,rgba(217,247,255,.17),transparent 24%)",
    opacity:.40, blend:"screen", overlayAnimation:"homeWorldArcticPulse 4.8s ease-in-out infinite"
  },
  chromeWave: {
    filter:"grayscale(.46) saturate(.62) contrast(1.18) brightness(.80)",
    overlay:"linear-gradient(110deg,transparent 14%,rgba(245,250,255,.24) 38%,rgba(169,207,255,.12) 48%,transparent 66%)",
    opacity:.38, blend:"screen", overlayAnimation:"homeWorldChromeSweep 6.4s ease-in-out infinite"
  },
  nightDrive: {
    filter:"saturate(1.18) contrast(1.17) brightness(.58) hue-rotate(4deg)",
    overlay:"linear-gradient(180deg,transparent 0 58%,rgba(255,75,184,.12) 70%,rgba(64,231,255,.12) 78%,transparent 88%), repeating-linear-gradient(90deg,transparent 0 74px,rgba(163,107,255,.07) 75px 77px,transparent 78px 150px)",
    overlaySize:"cover,150px 100%", opacity:.45, blend:"screen", overlayAnimation:"homeWorldDrive 5.8s linear infinite"
  },
  toxicReactor: {
    filter:"saturate(1.15) contrast(1.20) brightness(.65) hue-rotate(8deg)",
    overlay:"radial-gradient(circle at center,rgba(154,245,66,.18),transparent 26%,rgba(230,255,92,.07) 42%,transparent 58%), repeating-radial-gradient(circle at center,rgba(200,255,54,.08) 0 2px,transparent 3px 44px)",
    opacity:.44, blend:"screen", overlayAnimation:"homeWorldToxicPulse 3.8s ease-in-out infinite"
  },
  solarPunk: {
    filter:"saturate(1.06) contrast(1.04) brightness(.90) sepia(.05)",
    overlay:"radial-gradient(circle at 76% 16%,rgba(243,226,118,.24),transparent 28%), radial-gradient(circle at 18% 74%,rgba(123,225,193,.17),transparent 34%)",
    opacity:.38, blend:"screen", overlayAnimation:"homeWorldSolarSweep 8.5s ease-in-out infinite alternate"
  },

  dragonForge: {
    filter:"saturate(1.22) contrast(1.16) brightness(.61) sepia(.08)",
    overlay:"radial-gradient(ellipse at 50% 112%,rgba(240,90,42,.38),rgba(255,211,106,.13) 34%,transparent 68%), radial-gradient(circle at 50% 50%,transparent 44%,rgba(80,10,8,.24))",
    opacity:.48, blend:"screen", overlayAnimation:"homeWorldForge 4s ease-in-out infinite alternate"
  },
  celestialCrown: {
    filter:"saturate(.83) contrast(1.10) brightness(.67) hue-rotate(8deg)",
    overlay:"radial-gradient(circle at 50% 26%,rgba(217,184,95,.19),transparent 20%), radial-gradient(circle at 22% 72%,rgba(86,108,197,.15),transparent 28%), radial-gradient(circle at 82% 68%,rgba(200,226,255,.14),transparent 26%)",
    opacity:.42, blend:"screen", overlayAnimation:"homeWorldCelestial 10s ease-in-out infinite alternate"
  },
  titanStorm: {
    filter:"saturate(.66) contrast(1.20) brightness(.54) hue-rotate(4deg)",
    overlay:"linear-gradient(180deg,rgba(237,246,255,.05),rgba(17,25,35,.34)), repeating-linear-gradient(108deg,transparent 0 50px,rgba(125,182,255,.08) 51px 54px,transparent 55px 96px)",
    opacity:.48, blend:"screen", overlayAnimation:"homeWorldTitanFlash 7.2s steps(1,end) infinite", canvasAnimation:"homeWorldTitanShake 7.2s steps(1,end) infinite"
  },
  goldenEclipse: {
    filter:"saturate(.72) contrast(1.20) brightness(.56) sepia(.14)",
    overlay:"radial-gradient(circle at 72% 22%,rgba(15,13,9,.96) 0 9%,rgba(255,210,103,.36) 10% 12%,rgba(230,184,76,.13) 15%,transparent 30%), radial-gradient(circle at center,transparent 38%,rgba(15,13,9,.34) 84%)",
    opacity:.50, blend:"screen", overlayAnimation:"homeWorldEclipse 8.8s ease-in-out infinite alternate"
  },

  sakuraBreeze: {
    filter:"saturate(.86) contrast(.96) brightness(.96) hue-rotate(-3deg)",
    overlay:"radial-gradient(circle at 18% 18%,rgba(243,166,189,.20),transparent 26%), radial-gradient(circle at 82% 70%,rgba(121,155,120,.12),transparent 32%)",
    opacity:.38, blend:"screen", overlayAnimation:"homeWorldSakura 9s ease-in-out infinite alternate"
  },
  lavenderDream: {
    filter:"saturate(.78) contrast(.94) brightness(.88) hue-rotate(9deg)",
    overlay:"radial-gradient(circle at 28% 34%,rgba(183,160,232,.20),transparent 34%), radial-gradient(circle at 76% 64%,rgba(232,222,255,.15),transparent 38%)",
    opacity:.40, blend:"screen", overlayAnimation:"homeWorldLavender 10s ease-in-out infinite alternate"
  },
  rainyWindow: {
    filter:"saturate(.62) contrast(1.04) brightness(.72) hue-rotate(5deg)",
    overlay:"repeating-linear-gradient(104deg,transparent 0 28px,rgba(201,220,229,.10) 29px 31px,transparent 32px 58px), linear-gradient(180deg,rgba(131,175,196,.08),rgba(32,43,51,.24))",
    overlaySize:"90px 140px,cover", opacity:.42, blend:"screen", overlayAnimation:"homeWorldRain 1.5s linear infinite"
  },
  quietMeadow: {
    filter:"saturate(.92) contrast(.96) brightness(.96) sepia(.03)",
    overlay:"radial-gradient(circle at 76% 18%,rgba(240,230,178,.20),transparent 28%), radial-gradient(circle at 20% 76%,rgba(155,203,122,.14),transparent 34%)",
    opacity:.34, blend:"soft-light", overlayAnimation:"homeWorldMeadow 11s ease-in-out infinite alternate"
  }
};

const HOME_BACKGROUND_EFFECTS_STORAGE_KEY = "cubeHomeBackgroundEffects";
let homeBackgroundEffectsEnabled = localStorage.getItem(HOME_BACKGROUND_EFFECTS_STORAGE_KEY) !== "off";

function updateHomeBackgroundEffectsToggle() {
  const toggle = document.getElementById("homeBackgroundEffectsToggle");
  const state = document.getElementById("homeBackgroundEffectsState");
  if (toggle) toggle.checked = homeBackgroundEffectsEnabled;
  if (state) state.textContent = homeBackgroundEffectsEnabled ? "On" : "Off";
}

function setHomeBackgroundEffectsEnabled(enabled, save = true) {
  homeBackgroundEffectsEnabled = !!enabled;
  if (save) {
    localStorage.setItem(HOME_BACKGROUND_EFFECTS_STORAGE_KEY, homeBackgroundEffectsEnabled ? "on" : "off");
  }
  updateHomeBackgroundEffectsToggle();
  syncHomeWorldThemeState();
}

const HOME_THEME_EFFECTS_STORAGE_KEY = "cubeHomeThemeEffects";
let homeThemeEffectsEnabled = localStorage.getItem(HOME_THEME_EFFECTS_STORAGE_KEY) !== "off";

function updateHomeThemeEffectsToggle() {
  const toggle = document.getElementById("homeThemeEffectsToggle");
  const state = document.getElementById("homeThemeEffectsState");
  if (toggle) toggle.checked = homeThemeEffectsEnabled;
  if (state) state.textContent = homeThemeEffectsEnabled ? "On" : "Off";
}

function addHomeFxSpecial(layer, className, options = {}) {
  const el = document.createElement(options.tag || "span");
  el.className = "home-fx-special " + className;
  if (options.text != null) el.textContent = options.text;
  if (options.left != null) el.style.left = options.left;
  if (options.top != null) el.style.top = options.top;
  if (options.right != null) el.style.right = options.right;
  if (options.bottom != null) el.style.bottom = options.bottom;
  if (options.color) el.style.color = options.color;
  if (options.duration) el.style.setProperty("--sp-dur", options.duration);
  if (options.delay) el.style.animationDelay = options.delay;
  if (options.vars) {
    for (const [k,v] of Object.entries(options.vars)) el.style.setProperty(k,v);
  }
  layer.appendChild(el);
  return el;
}

function buildHomeThemeSpecialScene(layer, fx) {
  const special = fx.special || "";
  const randPct = (a,b) => (a + Math.random() * (b-a)).toFixed(1) + "%";
  const randSec = (a,b) => (a + Math.random() * (b-a)).toFixed(2) + "s";

  if (special === "leafSway") {
    addHomeFxSpecial(layer,"fx-special-leaf-sway");
    addHomeFxSpecial(layer,"fx-special-leaf-sway",{top:"20%",left:"54%",vars:{"width":"34vw"},delay:"-2.2s"});
  } else if (special === "emberMist") {
    addHomeFxSpecial(layer,"fx-special-ember-mist");
    addHomeFxSpecial(layer,"fx-special-ember-mist",{left:"-8vw",top:"55vh",delay:"-2.7s"});
  } else if (special === "fireflies") {
    for (let i=0;i<8;i++) addHomeFxSpecial(layer,"fx-special-firefly",{
      left:randPct(8,92),top:randPct(18,88),color:fx.colors[i%fx.colors.length],
      duration:randSec(3.4,7.2),delay:randSec(-7,0)
    });
  } else if (special === "runeRing") {
    const r=addHomeFxSpecial(layer,"fx-special-rune-ring");
    r.style.transform="translate(-50%,-50%)";
  } else if (special === "pollenHalo") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-special-pollen",{
      left:randPct(4,88),top:randPct(14,78),delay:randSec(-5,0)
    });
  } else if (special === "heatWave") {
    addHomeFxSpecial(layer,"fx-special-heat-wave");
  } else if (special === "circuitGrid") {
    addHomeFxSpecial(layer,"fx-special-circuit-grid");
  } else if (special === "bubbleWave") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-special-wave",{top:(38+i*18)+"%",delay:(-i*1.6)+"s"});
  } else if (special === "iceShimmer") {
    addHomeFxSpecial(layer,"fx-special-ice-shimmer");
    addHomeFxSpecial(layer,"fx-special-ice-shimmer",{delay:"-3.6s"});
  } else if (special === "dustGust") {
    addHomeFxSpecial(layer,"fx-special-dust-gust");
    addHomeFxSpecial(layer,"fx-special-dust-gust",{top:"67%",delay:"-3s"});
  } else if (special === "steelSlash") {
    addHomeFxSpecial(layer,"fx-special-steel-slash");
    addHomeFxSpecial(layer,"fx-special-steel-slash",{top:"66%",delay:"-2.6s"});
  } else if (special === "silverSteel") {
    addHomeFxSpecial(layer,"fx-special-silver-slash",{top:"22%",delay:"-1.0s",vars:{"--silver-width":"54vw"}});
    addHomeFxSpecial(layer,"fx-special-silver-slash",{top:"49%",delay:"-3.0s",vars:{"--silver-width":"42vw"}});
    addHomeFxSpecial(layer,"fx-special-silver-slash",{top:"74%",delay:"-5.1s",vars:{"--silver-width":"58vw"}});
  } else if (special === "arcadeGrid") {
    addHomeFxSpecial(layer,"fx-special-arcade-grid");
  } else if (special === "fireFlare") {
    addHomeFxSpecial(layer,"fx-special-fire-flare");
    addHomeFxSpecial(layer,"fx-special-heat-wave",{delay:"-1.7s"});
  } else if (special === "rainWave") {
    addHomeFxSpecial(layer,"fx-special-rain-band");
    for (let i=0;i<2;i++) addHomeFxSpecial(layer,"fx-special-wave",{top:(55+i*18)+"%",delay:(-i*2)+"s"});
  } else if (special === "petalBurst") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-special-petal-burst",{
      left:randPct(5,82),top:randPct(12,76),delay:randSec(-5,0)
    });
  } else if (special === "moonOrb") {
    addHomeFxSpecial(layer,"fx-special-moon-orb");
  } else if (special === "pawTrail") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-special-paw",{
      text:"🐾",top:(62-i*10)+"%",left:(-8-i*8)+"%",delay:(-i*1.4)+"s"
    });
  } else if (special === "dataRain") {
    for (let i=0;i<12;i++) addHomeFxSpecial(layer,"fx-special-data-column",{
      text:(i%2?"01011010":"10100101"),left:(3+i*8.4)+"%",duration:randSec(3.7,7.2),delay:randSec(-7,0)
    });
    addHomeFxSpecial(layer,"fx-special-hacker-scan");
  } else if (special === "voidPulse") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-special-void-pulse",{delay:(-i*1.5)+"s"});
  } else if (special === "bloodMoon") {
    addHomeFxSpecial(layer,"fx-special-blood-moon");
  } else if (special === "hackerScan") {
    for (let i=0;i<16;i++) addHomeFxSpecial(layer,"fx-special-data-column",{
      text:(i%3===0?"01101001":"10101010"),left:(1+i*6.4)+"%",duration:randSec(3.4,6.4),delay:randSec(-7,0)
    });
    addHomeFxSpecial(layer,"fx-special-hacker-scan");
  } else if (special === "cottonCloud") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-special-cotton-cloud",{
      left:randPct(-4,82),top:randPct(6,74),delay:randSec(-7,0)
    });
  } else if (special === "blackNeon") {
    addHomeFxSpecial(layer,"fx-special-black-neon");
    addHomeFxSpecial(layer,"fx-special-black-neon-line",{top:"30%",delay:"0s",color:"#00F0FF"});
    addHomeFxSpecial(layer,"fx-special-black-neon-line",{top:"52%",delay:"-1.1s",color:"#FF3DBD"});
    addHomeFxSpecial(layer,"fx-special-black-neon-line",{top:"74%",delay:"-2.2s",color:"#B7FF3C"});
  } else if (special === "nightSky") {
    addHomeFxSpecial(layer,"fx-special-night-moon");
  } else if (special === "lightningStorm") {
    addHomeFxSpecial(layer,"fx-special-storm-cloud");
    addHomeFxSpecial(layer,"fx-special-rain-band");
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-special-lightning",{
      left:(22+i*27)+"%",delay:(i*2.15)+"s"
    });
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-special-flash",{delay:(i*2.15)+"s"});
  } else if (special === "glitchBlackScreen") {
    addHomeFxSpecial(layer,"fx-glitch-scanlines");
    addHomeFxSpecial(layer,"fx-glitch-vignette");

    for (let i=0;i<15;i++) {
      const width = 12 + Math.random()*66;
      const height = 2 + Math.random()*8;
      addHomeFxSpecial(layer,"fx-glitch-rgb-tear",{
        left:randPct(-4,82),
        top:randPct(5,93),
        duration:randSec(1.8,4.8),
        delay:randSec(-5,0),
        vars:{
          "--tear-w":width.toFixed(1)+"vw",
          "--tear-h":height.toFixed(0)+"px",
          "--tear-shift":((Math.random()-.5)*70).toFixed(0)+"px"
        }
      });
    }

    for (let i=0;i<18;i++) {
      addHomeFxSpecial(layer,"fx-glitch-pixel",{
        left:randPct(2,97),
        top:randPct(4,96),
        delay:randSec(-4,0),
        duration:randSec(1.2,3.7),
        color:["#FF355E","#00EAF2","#F8FAFC","#295BFF"][i%4],
        vars:{
          "--px-w":(4+Math.random()*22).toFixed(0)+"px",
          "--px-h":(2+Math.random()*9).toFixed(0)+"px"
        }
      });
    }

    for (let i=0;i<5;i++) {
      addHomeFxSpecial(layer,"fx-glitch-block-shift",{
        top:randPct(14,88),
        delay:randSec(-6,0),
        duration:randSec(3.4,7.2),
        vars:{
          "--block-w":(18+Math.random()*48).toFixed(0)+"vw",
          "--block-h":(12+Math.random()*42).toFixed(0)+"px",
          "--block-x":((Math.random()-.5)*110).toFixed(0)+"px"
        }
      });
    }
  } else if (special === "slimeDrip") {
    for (let i=0;i<8;i++) addHomeFxSpecial(layer,"fx-special-slime-drip",{
      left:(4+i*13)+"%",duration:randSec(3.7,6.7),delay:randSec(-6,0)
    });
  } else if (special === "windGust") {
    for (let i=0;i<6;i++) addHomeFxSpecial(layer,"fx-special-wind-gust",{
      top:(16+i*13)+"%",duration:randSec(3.4,5.8),delay:randSec(-6,0)
    });
  } else if (special === "vineGrow") {
    for (let i=0;i<6;i++) addHomeFxSpecial(layer,"fx-special-vine",{
      left:(4+i*18)+"%",duration:randSec(4.2,7.4),delay:randSec(-5,0)
    });
  } else if (special === "stoneQuake") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-special-stone-wave",{delay:(-i*1.25)+"s"});
    addHomeFxSpecial(layer,"fx-special-dust-gust",{top:"72%"});
  } else if (special === "earthPulse") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-special-earth-ring",{delay:(-i*1.3)+"s"});
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-special-earth-chunk",{
      left:(8+i*20)+"%",
      bottom:(4+(i%2)*5)+"%",
      delay:(-i*.9)+"s",
      color:i%2?"#A87947":"#C7B06A"
    });
    addHomeFxSpecial(layer,"fx-special-earth-glow");
  } else if (special === "soundWave") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-special-sound-ring",{
      delay:(-i*.72)+"s",
      color:i%2?"#7FE7FF":"#8A7DFF"
    });
    for (let i=0;i<15;i++) addHomeFxSpecial(layer,"fx-special-sound-bar",{
      left:(8+i*5.8)+"%",
      top:"48%",
      delay:(-i*.13)+"s",
      color:["#8A7DFF","#7FE7FF","#D39CFF"][i%3],
      vars:{"--sound-h":(30+Math.random()*105).toFixed(0)+"px"}
    });
  } else if (special === "strawberrySwirl") {
    for (let i=0;i<6;i++) addHomeFxSpecial(layer,"fx-354-strawberry",{
      text:"🍓",left:randPct(4,90),top:randPct(12,82),delay:randSec(-7,0),duration:randSec(4.5,7.4)
    });
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-354-milk-bubble",{left:randPct(10,82),top:randPct(18,76),delay:randSec(-5,0)});
  } else if (special === "bunnyHop") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-354-bunny-hop",{
      text:i%2?"♡":"🐰",left:(-8+i*18)+"%",bottom:(5+(i%2)*8)+"%",delay:(-i*.8)+"s"
    });
  } else if (special === "bubblePop") {
    for (let i=0;i<10;i++) addHomeFxSpecial(layer,"fx-354-bubble",{
      left:randPct(4,92),bottom:randPct(-8,60),delay:randSec(-7,0),duration:randSec(4.2,8.4),
      color:["#74CFFF","#F58BC7","#D7B8FF"][i%3],vars:{"--bubble-size":(28+Math.random()*78).toFixed(0)+"px"}
    });
  } else if (special === "beeBuzz") {
    for (let i=0;i<6;i++) addHomeFxSpecial(layer,"fx-354-bee",{
      text:"🐝",left:randPct(2,90),top:randPct(16,78),delay:randSec(-8,0),duration:randSec(5,9)
    });
  } else if (special === "plushGlow") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-354-plush-blob",{
      left:randPct(-4,84),top:randPct(10,80),delay:randSec(-7,0),color:i%2?"#A8D7C7":"#D8B59C"
    });
  } else if (special === "arcticPulse") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-354-arctic-ring",{delay:(-i*.85)+"s",color:i%2?"#61D9FF":"#D9F7FF"});
  } else if (special === "chromeSweep") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-354-chrome-line",{top:(18+i*20)+"%",delay:(-i*1.3)+"s"});
  } else if (special === "nightDrive") {
    addHomeFxSpecial(layer,"fx-354-drive-road");
    for (let i=0;i<8;i++) addHomeFxSpecial(layer,"fx-354-city-light",{
      left:(5+i*13)+"%",bottom:(10+(i%3)*5)+"%",delay:(-i*.33)+"s",color:i%2?"#40E7FF":"#FF4BB8"
    });
  } else if (special === "toxicReactor") {
    addHomeFxSpecial(layer,"fx-354-reactor-core");
    for (let i=0;i<12;i++) addHomeFxSpecial(layer,"fx-354-toxic-spark",{
      left:randPct(16,84),top:randPct(12,86),delay:randSec(-4,0),color:i%2?"#9AF542":"#E6FF5C"
    });
  } else if (special === "solarPunk") {
    addHomeFxSpecial(layer,"fx-354-solar-disc");
    for (let i=0;i<7;i++) addHomeFxSpecial(layer,"fx-354-solar-leaf",{
      text:"🍃",left:randPct(6,90),top:randPct(12,82),delay:randSec(-8,0),duration:randSec(5,9)
    });
  } else if (special === "dragonForge") {
    addHomeFxSpecial(layer,"fx-354-forge-glow");
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-354-forge-arc",{delay:(-i*.9)+"s"});
  } else if (special === "celestialCrown") {
    addHomeFxSpecial(layer,"fx-354-crown-ring");
    for (let i=0;i<9;i++) addHomeFxSpecial(layer,"fx-354-crown-star",{
      text:i%3===0?"♛":"✦",left:randPct(10,90),top:randPct(10,80),delay:randSec(-7,0),color:i%2?"#D9B85F":"#C8E2FF"
    });
  } else if (special === "titanStorm") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-354-titan-bolt",{left:(18+i*31)+"%",delay:(i*1.7)+"s"});
    addHomeFxSpecial(layer,"fx-354-titan-flash");
  } else if (special === "goldenEclipse") {
    addHomeFxSpecial(layer,"fx-354-eclipse-orb");
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-354-eclipse-ring",{delay:(-i*1.4)+"s"});
  } else if (special === "sakuraBreeze") {
    for (let i=0;i<11;i++) addHomeFxSpecial(layer,"fx-354-sakura",{
      text:i%3?"🌸":"✿",left:randPct(-8,92),top:randPct(2,72),delay:randSec(-9,0),duration:randSec(6,10)
    });
  } else if (special === "lavenderDream") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-354-dream-cloud",{left:randPct(-6,82),top:randPct(8,74),delay:randSec(-8,0)});
    for (let i=0;i<7;i++) addHomeFxSpecial(layer,"fx-354-dream-star",{text:"✦",left:randPct(8,92),top:randPct(8,82),delay:randSec(-5,0)});
  } else if (special === "rainyWindow") {
    for (let i=0;i<16;i++) addHomeFxSpecial(layer,"fx-354-rain-line",{left:(2+i*6.3)+"%",delay:randSec(-3,0),duration:randSec(1.4,2.5)});
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-354-window-drop",{left:randPct(8,90),top:randPct(12,80),delay:randSec(-5,0)});
  } else if (special === "quietMeadow") {
    for (let i=0;i<16;i++) addHomeFxSpecial(layer,"fx-354-grass",{left:(i*6.6)+"%",bottom:"0",delay:(-i*.17)+"s"});
    for (let i=0;i<7;i++) addHomeFxSpecial(layer,"fx-354-meadow-light",{left:randPct(8,92),top:randPct(20,82),delay:randSec(-6,0)});
  }
}

function buildHomeThemeExtraCoolness(layer, themeId, fx) {
  const randPct = (a,b) => (a + Math.random() * (b-a)).toFixed(1) + "%";
  const randSec = (a,b) => (a + Math.random() * (b-a)).toFixed(2) + "s";

  if (themeId === "forestGold") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-extra-sun-ray",{
      left:(8+i*24)+"%",top:"-18%",color:i===1?"#D6A441":"#BFD99A",
      delay:(-i*2.1)+"s",vars:{"--ray-angle":(-18+i*9)+"deg"}
    });
  } else if (themeId === "blueEmber") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-comet",{
      left:randPct(-12,62),top:randPct(15,78),
      color:i%2?"#7FD1C8":"#F2A93B",delay:randSec(-6,0),
      duration:randSec(4.2,7.2)
    });
  } else if (themeId === "sunsetJungle") {
    addHomeFxSpecial(layer,"fx-extra-sun-disc",{right:"5%",bottom:"5%",color:"#F08A24"});
    addHomeFxSpecial(layer,"fx-extra-horizon",{bottom:"19%",color:"#F2D16B"});
  } else if (themeId === "royalStone") {
    for (let i=0;i<2;i++) addHomeFxSpecial(layer,"fx-extra-orbit",{
      left:"50%",top:"55%",color:i?"#C89B3C":"#8E9FE6",
      delay:(-i*4.5)+"s",vars:{"--orbit-size":(360+i*105)+"px"}
    });
  } else if (themeId === "mossCream") {
    for (let i=0;i<7;i++) addHomeFxSpecial(layer,"fx-extra-dapple",{
      left:randPct(2,92),top:randPct(8,84),color:i%2?"#D9B65D":"#A7D49B",
      delay:randSec(-6,0),vars:{"--dapple-size":(70+Math.random()*120).toFixed(0)+"px"}
    });
  } else if (themeId === "lavaNight") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-lava-crack",{
      left:(5+i*25)+"%",bottom:"-4%",color:i%2?"#F0B94A":"#D94F2A",
      delay:(-i*1.8)+"s",vars:{"--crack-rot":(-12+i*8)+"deg"}
    });
  } else if (themeId === "mintTech") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-extra-tech-scan",{
      top:(24+i*24)+"%",color:i===1?"#FFD166":"#49C6B4",delay:(-i*1.7)+"s"
    });
  } else if (themeId === "oceanCoral") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-caustic",{
      left:randPct(-8,70),top:(18+i*20)+"%",color:i%2?"#79E0C8":"#4CC9F0",
      delay:(-i*1.4)+"s"
    });
  } else if (themeId === "frostPine") {
    addHomeFxSpecial(layer,"fx-extra-aurora",{top:"5%",color:"#9FD8E5"});
    addHomeFxSpecial(layer,"fx-extra-aurora",{top:"18%",color:"#D2EEF4",delay:"-4s",vars:{"--aurora-flip":"-1"}});
  } else if (themeId === "desertDusk") {
    addHomeFxSpecial(layer,"fx-extra-sun-disc",{right:"8%",top:"12%",color:"#E6C486"});
    for (let i=0;i<2;i++) addHomeFxSpecial(layer,"fx-extra-horizon",{
      bottom:(12+i*11)+"%",color:i?"#D88B4B":"#E6C486",delay:(-i*2.6)+"s"
    });
  } else if (themeId === "crimsonSteel") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-steel-glint",{
      left:randPct(4,90),top:randPct(12,86),delay:randSec(-5,0)
    });
  } else if (themeId === "neonArcade") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-neon-bar",{
      top:(15+i*22)+"%",color:["#59E3D2","#FF8ACF","#F8E35E","#6C5CE7"][i],
      delay:(-i*1.2)+"s"
    });
  } else if (themeId === "fireElement") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-extra-fire-ring",{
      left:(18+i*31)+"%",bottom:"4%",color:i===1?"#FFD166":"#FF7A24",delay:(-i*1.7)+"s"
    });
  } else if (themeId === "waterElement") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-caustic",{
      left:randPct(-5,72),top:(14+i*21)+"%",color:i%2?"#8BE9FD":"#4CC9F0",delay:(-i*1.6)+"s"
    });
  } else if (themeId === "blossomCandy") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-extra-spark-arc",{
      left:randPct(3,88),top:randPct(12,82),color:i%2?"#FF9EC4":"#FFD7A8",
      delay:randSec(-6,0)
    });
  } else if (themeId === "moonPetal") {
    for (let i=0;i<3;i++) addHomeFxSpecial(layer,"fx-extra-moon-halo",{
      right:"7vw",top:"10vh",color:i%2?"#C7D7FF":"#F1B9D8",delay:(-i*1.7)+"s",
      vars:{"--halo-size":(170+i*55)+"px"}
    });
  } else if (themeId === "kemonoCamp") {
    addHomeFxSpecial(layer,"fx-extra-camp-glow",{left:"50%",bottom:"-8%",color:"#E58A3A"});
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-extra-firefly-dot",{
      left:randPct(12,88),top:randPct(28,84),color:"#F0C987",delay:randSec(-6,0)
    });
  } else if (themeId === "cyberCircuit") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-tech-scan",{
      top:(13+i*21)+"%",color:i%2?"#B7F34A":"#37E6D0",delay:(-i*1.4)+"s"
    });
  } else if (themeId === "voidObsidian") {
    for (let i=0;i<4;i++) addHomeFxSpecial(layer,"fx-extra-void-streak",{
      left:randPct(10,85),top:randPct(12,80),color:i%2?"#A68CFF":"#C6B7FF",
      delay:randSec(-8,0),duration:randSec(5.2,8.8)
    });
  } else if (themeId === "bloodMoon") {
    for (let i=0;i<2;i++) addHomeFxSpecial(layer,"fx-extra-eclipse-ring",{
      right:"7vw",top:"10vh",color:i?"#D9B56D":"#B93A3A",delay:(-i*2.4)+"s"
    });
  } else if (themeId === "cottonCandy") {
    for (let i=0;i<5;i++) addHomeFxSpecial(layer,"fx-extra-spark-arc",{
      left:randPct(5,90),top:randPct(10,84),color:["#FF9ED8","#77C9FF","#DAB6FF"][i%3],
      delay:randSec(-6,0)
    });
  } else if (themeId === "blackNight") {
    for (let i=0;i<8;i++) addHomeFxSpecial(layer,"fx-extra-star-twinkle",{
      left:randPct(6,94),top:randPct(6,80),color:"#E8F0FF",delay:randSec(-5,0)
    });
  }
}

function renderHomeThemeEffects() {
  const layer = document.getElementById("homeThemeFx");
  if (!layer) return;

  layer.innerHTML = "";
  layer.classList.toggle("off", !homeThemeEffectsEnabled);
  updateHomeThemeEffectsToggle();
  if (!homeThemeEffectsEnabled) return;

  const fx = HOME_THEME_EFFECTS[currentHomeTheme] || HOME_THEME_EFFECTS.forestGold;
  const count = Math.min(36, Math.max(12, fx.count || 20));
  const sizeMin = fx.size?.[0] || 18;
  const sizeMax = fx.size?.[1] || 34;

  buildHomeThemeSpecialScene(layer, fx);
  buildHomeThemeExtraCoolness(layer, currentHomeTheme, fx);

  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "home-fx-particle fx-" + (fx.mode || "float");

    const glyph = fx.glyphs[i % fx.glyphs.length];
    p.textContent = glyph;

    if (fx.tech && (glyph === "□" || glyph === "▦" || glyph === "■")) {
      p.classList.add("fx-square");
      p.textContent = "";
    } else if (glyph === "│" || glyph === "—") {
      p.classList.add("fx-line");
      p.textContent = "";
    } else if (glyph === "•" || glyph === "·" || glyph === "●") {
      p.classList.add("fx-soft");
    }

    const left = Math.random() * 100;
    const top = fx.mode === "rise"
      ? 72 + Math.random() * 34
      : fx.mode === "fall"
        ? -18 - Math.random() * 54
        : Math.random() * 96;

    let size = sizeMin + Math.random() * (sizeMax - sizeMin);
    if (glyph === "🐾" || glyph === "🍂" || glyph === "🍃" || glyph === "🌿" || glyph === "☁") {
      size *= 1.18;
    }

    p.style.setProperty("--fx-left", left.toFixed(2) + "%");
    p.style.setProperty("--fx-top", top.toFixed(2) + "%");
    p.style.setProperty("--fx-size", size.toFixed(1) + "px");
    p.style.setProperty("--fx-opacity", (0.34 + Math.random() * 0.48).toFixed(2));
    p.style.setProperty("--fx-duration", (5.0 + Math.random() * 8.0).toFixed(2) + "s");
    p.style.setProperty("--fx-delay", (-Math.random() * 11).toFixed(2) + "s");
    p.style.setProperty("--fx-x", ((Math.random() - .5) * 145).toFixed(1) + "px");
    p.style.setProperty("--fx-color", fx.colors[i % fx.colors.length]);

    layer.appendChild(p);
  }
}

function setHomeThemeEffectsEnabled(enabled, save = true) {
  homeThemeEffectsEnabled = !!enabled;
  if (save) {
    localStorage.setItem(HOME_THEME_EFFECTS_STORAGE_KEY, homeThemeEffectsEnabled ? "on" : "off");
  }
  renderHomeThemeEffects();
}

const HOME_THEME_STORAGE_KEY = "cubeHomeTheme";
let currentHomeTheme = localStorage.getItem(HOME_THEME_STORAGE_KEY) || "forestGold";
if (!HOME_THEMES[currentHomeTheme]) currentHomeTheme = "forestGold";

function syncHomeWorldThemeState() {
  const home = document.getElementById("home");
  const homeVisible = !!home && home.style.display !== "none";
  const active = homeVisible && homeBackgroundEffectsEnabled;
  const config = HOME_WORLD_BACKGROUND_EFFECTS[currentHomeTheme] || HOME_WORLD_BACKGROUND_EFFECTS.forestGold;

  for (const cls of Array.from(document.body.classList)) {
    if (cls.startsWith("home-bg-")) document.body.classList.remove(cls);
  }

  document.body.classList.toggle("home-background-effects-on", active);

  if (!active) {
    document.body.style.removeProperty("--home-bg-filter");
    document.body.style.removeProperty("--home-bg-overlay");
    document.body.style.removeProperty("--home-bg-overlay-size");
    document.body.style.removeProperty("--home-bg-overlay-position");
    document.body.style.removeProperty("--home-bg-overlay-opacity");
    document.body.style.removeProperty("--home-bg-blend");
    document.body.style.removeProperty("--home-bg-overlay-animation");
    document.body.style.removeProperty("--home-bg-canvas-animation");
    return;
  }

  document.body.classList.add("home-bg-" + currentHomeTheme);
  document.body.style.setProperty("--home-bg-filter", config.filter || "none");
  document.body.style.setProperty("--home-bg-overlay", config.overlay || "transparent");
  document.body.style.setProperty("--home-bg-overlay-size", config.overlaySize || "cover");
  document.body.style.setProperty("--home-bg-overlay-position", config.overlayPosition || "center");
  document.body.style.setProperty("--home-bg-overlay-opacity", String(config.opacity ?? .28));
  document.body.style.setProperty("--home-bg-blend", config.blend || "normal");
  document.body.style.setProperty("--home-bg-overlay-animation", config.overlayAnimation || "homeWorldOverlayBreathe 8s ease-in-out infinite alternate");
  document.body.style.setProperty("--home-bg-canvas-animation", config.canvasAnimation || "homeWorldCanvasBreathe 8s ease-in-out infinite alternate");
  updateHomeBackgroundEffectsToggle();
}

function applyHomeTheme(themeId, save = false) {
  const theme = HOME_THEMES[themeId] || HOME_THEMES.forestGold;
  const home = document.getElementById("home");
  if (!home) return;

  currentHomeTheme = HOME_THEMES[themeId] ? themeId : "forestGold";
  home.classList.add("home-themed");
  home.classList.toggle("theme-glitch", currentHomeTheme === "glitch");

  const vars = {
    "--ht-bg": theme.bg,
    "--ht-panel": theme.panel,
    "--ht-panel2": theme.panel2,
    "--ht-primary": theme.primary,
    "--ht-primary2": theme.primary2,
    "--ht-secondary": theme.secondary,
    "--ht-secondary2": theme.secondary2,
    "--ht-accent": theme.accent,
    "--ht-text": theme.text,
    "--ht-muted": theme.muted,
    "--ht-special": theme.special,
  };
  for (const [key,val] of Object.entries(vars)) {
    home.style.setProperty(key,val);
    document.documentElement.style.setProperty(key,val);
  }
  document.body.classList.toggle("home-ui-glitch", currentHomeTheme === "glitch");

  if (save) localStorage.setItem(HOME_THEME_STORAGE_KEY, currentHomeTheme);
  buildHomeThemeGrid();
  renderHomeThemeEffects();
  updateHomeBackgroundEffectsToggle();
  syncHomeWorldThemeState();
}

function themePreviewBackground(theme) {
  if (theme === HOME_THEMES.glitch) {
    return `repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 1px,transparent 1px 5px), linear-gradient(90deg, transparent 0 18%, #FF355E 18% 19%, transparent 19% 54%, #00EAF2 54% 55%, transparent 55%), #020304`;
  }
  return `radial-gradient(circle at 85% 18%, ${theme.accent}55, transparent 34%), linear-gradient(145deg, ${theme.bg}, ${theme.panel} 56%, ${theme.panel2})`;
}

function buildHomeThemeGrid() {
  const grid = document.getElementById("homeThemeGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const elementThemeOrder = [
    "fireElement",
    "waterElement",
    "windElement",
    "plantElement",
    "stoneElement",
    "earthElement",
    "soundElement"
  ];

  const cuteThemeOrder = ["strawberryMilk","peachBunny","bubblegumSky","honeyBee","cozyPlush"];
  const coolThemeOrder = ["arcticPulse","chromeWave","nightDrive","toxicReactor","solarPunk"];
  const epicThemeOrder = ["dragonForge","celestialCrown","titanStorm","goldenEclipse"];
  const relaxingThemeOrder = ["sakuraBreeze","lavenderDream","rainyWindow","quietMeadow"];
  const featuredThemeIds = [...elementThemeOrder,...cuteThemeOrder,...coolThemeOrder,...epicThemeOrder,...relaxingThemeOrder];
  const otherThemeOrder = Object.keys(HOME_THEMES).filter(id => !featuredThemeIds.includes(id));
  const themeOrder = [...featuredThemeIds, ...otherThemeOrder];

  for (const id of themeOrder) {
    const theme = HOME_THEMES[id];
    if (!theme) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    const isElementTheme = elementThemeOrder.includes(id);
    const moodBadge = isElementTheme ? "ELEMENT"
      : cuteThemeOrder.includes(id) ? "CUTE"
      : coolThemeOrder.includes(id) ? "COOL"
      : epicThemeOrder.includes(id) ? "EPIC"
      : relaxingThemeOrder.includes(id) ? "RELAX"
      : "";
    btn.className = "theme-choice" + (id === currentHomeTheme ? " selected" : "") + (isElementTheme ? " element-theme-choice" : "") + (moodBadge ? " themed-mood-choice" : "");
    btn.innerHTML = `
      <span class="theme-choice-bg" style="background:${themePreviewBackground(theme)}"></span>
      <span class="theme-choice-content">
        ${moodBadge ? `<span class="theme-element-badge theme-badge-${moodBadge.toLowerCase()}">${moodBadge}</span>` : ``}
        <span class="theme-choice-name">${theme.name}</span>
        <span class="theme-choice-desc">${theme.desc}</span>
      </span>
      <span class="theme-swatch-row">
        <span class="theme-mini-swatch" style="background:${theme.primary}"></span>
        <span class="theme-mini-swatch" style="background:${theme.secondary}"></span>
        <span class="theme-mini-swatch" style="background:${theme.accent}"></span>
        <span class="theme-selected-pill">Selected</span>
      </span>
    `;
    btn.addEventListener("click", () => applyHomeTheme(id, true));
    grid.appendChild(btn);
  }
}

function openHomeThemes() {
  if (game.started && !game.over) return;
  buildHomeThemeGrid();
  document.getElementById("homeThemeOverlay").classList.add("show");
}

function closeHomeThemes() {
  document.getElementById("homeThemeOverlay").classList.remove("show");
}


const TIME_PHASES = [
  { name: "Day",      duration: 120, safe: true, spawn: false, strong: false, color: "#f4e8c0", sky: 0 },
  { name: "Dawn",     duration: 18, safe: true,  spawn: false, strong: false, color: "#e8a060", sky: 0.3 },
  { name: "Night",    duration: 56, safe: false, spawn: true,  strong: false, color: "#3a4a6a", sky: 0.7 },
  { name: "Midnight", duration: 36, safe: false, spawn: true,  strong: true,  color: "#1a2035", sky: 0.9 },
  { name: "Morning",  duration: 18, safe: true,  spawn: false, strong: false, color: "#c0d8e8", sky: 0.4 },
];

const PET_TYPES = {
  dog:   { name: "Dog",   emoji: "🐕", elem: "Stone", color: "#c9a06a", abilityCd: 14,
           desc: "Raises a long-lasting spiked stone wall", startUnlock: true, baseSpeed: 78, friendly: true,
           sizeMul: 1.15, flee: false, style: "wall",
           coats: ["#c9a06a","#8b6914","#e8d5b7","#5c4033","#d2b48c"] },
  cat:   { name: "Cat",   emoji: "🐈", elem: "Sound", color: "#e8b8a0", abilityCd: 12,
           desc: "Sonic ring — push & stun", startUnlock: true, baseSpeed: 72, friendly: true,
           sizeMul: 1.0, flee: true, style: "ring",
           coats: ["#e8b8a0","#f5d0a9","#c4a882","#8b7355","#f0e6d2"] },
  dragon:{ name: "Bearded Dragon", emoji: "🦎", elem: "Fire", color: "#d4a050", abilityCd: 16,
           desc: "Ring of fire", startUnlock: true, baseSpeed: 38, friendly: true,
           sizeMul: 1.05, flee: true, style: "ring",
           coats: ["#d4a050","#c4783a","#e8b86d","#a06030"] },
  fox:   { name: "Fox",   emoji: "🦊", elem: "Lightning", color: "#e07a40", abilityCd: 13,
           desc: "Chain zap — bounces between foes", baseSpeed: 92, friendly: true,
           sizeMul: 1.08, flee: false, style: "chain",
           coats: ["#e07a40","#d4652a","#f09550","#c85820"] },
  wolf:  { name: "Wolf",  emoji: "🐺", elem: "Ice", color: "#7a8a9a", abilityCd: 15,
           desc: "Howl freezes nearby enemies solid", baseSpeed: 88, friendly: false,
           sizeMul: 1.35, flee: false, style: "freeze",
           coats: ["#7a8a9a","#9aa8b5","#5a6a7a","#b0bcc8","#4a5560"] },
  bear:  { name: "Bear",  emoji: "🐻", elem: "Water", color: "#8a6040", abilityCd: 17,
           desc: "Tidal roar — huge knockback wave", baseSpeed: 48, friendly: false,
           sizeMul: 1.55, flee: false, style: "wave",
           coats: ["#8a6040","#6b4423","#a07850","#5c3a1e","#c4a882"] },
  rabbit:{ name: "Rabbit", emoji: "🐇", elem: "Plant", color: "#e8e0d4", abilityCd: 11,
           desc: "Leaf shot — hurts foes, heals team", baseSpeed: 108, friendly: true,
           sizeMul: 0.85, flee: true, style: "blast",
           coats: ["#e8e0d4","#f5f0e8","#d4c8b8","#c9b8a0","#fff8f0"] },
  owl:   { name: "Horned Owl", emoji: "🦉", elem: "Wind", color: "#c4a882", abilityCd: 13,
           desc: "Gust lifts & shoves enemies away", baseSpeed: 70, friendly: true,
           sizeMul: 1.05, flee: true, style: "gust",
           coats: ["#c4a882","#a89070","#e8d5b7","#8b7355"] },
  snake: { name: "Viper", emoji: "🐍", elem: "Poison", color: "#5cb85c", abilityCd: 14,
           desc: "Venom spit — DoT on one target", baseSpeed: 68, friendly: false,
           sizeMul: 1.1, flee: false, style: "venom",
           coats: ["#5cb85c","#3a8a40","#7ec850","#2d6a30"] },
  deer:  { name: "Deer", emoji: "🦌", elem: "Light", color: "#c9a06a", abilityCd: 15,
           desc: "Beacon — heals allies, blinds foes", baseSpeed: 85, friendly: true,
           sizeMul: 1.2, flee: true, style: "beacon",
           coats: ["#c9a06a","#a07850","#e8d5b7","#8b6914"] },
  boar:  { name: "Boar", emoji: "🐗", elem: "Earth", color: "#6b4423", abilityCd: 16,
           desc: "Root trap — stuns enemies in mud", baseSpeed: 55, friendly: false,
           sizeMul: 1.4, flee: false, style: "root",
           coats: ["#6b4423","#8a6040","#5c3a1e","#a07850"] },
  saber: { name: "Sabertooth", emoji: "🐯", elem: "Combat", color: "#d4a060", abilityCd: 11,
           desc: "Dash strike — high burst damage", baseSpeed: 100, friendly: false,
           sizeMul: 1.45, flee: false, style: "dash",
           coats: ["#d4a060","#c49050","#e8c080","#a07040","#f0d0a0"] },
};

// Species are intentionally different instead of sharing one generic health pool.
// hpMul = natural toughness, damageTaken < 1 = better defense, attack = base bite power.
// This also makes babies naturally different from one another before they grow.
const ANIMAL_BALANCE = {
  dog:    { hpMul:1.15, damageTaken:0.88, attack:6.5 },
  cat:    { hpMul:0.90, damageTaken:1.05, attack:7.2 },
  dragon: { hpMul:1.05, damageTaken:0.93, attack:6.2 },
  fox:    { hpMul:0.92, damageTaken:1.05, attack:8.5 },
  wolf:   { hpMul:1.20, damageTaken:0.82, attack:9.5 },
  bear:   { hpMul:1.45, damageTaken:0.72, attack:8.5 },
  rabbit: { hpMul:0.72, damageTaken:1.15, attack:4.25 },
  owl:    { hpMul:0.88, damageTaken:1.02, attack:6.0 },
  snake:  { hpMul:0.84, damageTaken:1.10, attack:9.0 },
  deer:   { hpMul:1.08, damageTaken:0.94, attack:6.0 },
  boar:   { hpMul:1.30, damageTaken:0.80, attack:9.0 },
  saber:  { hpMul:1.00, babyHpMul:1.78, damageTaken:0.98, attack:12.0 },
};

const ANIMAL_STAGE_HP = { baby:28, adult:100, boss:320, superboss:900, bigmomma:1900 };
const ANIMAL_STAGE_ATTACK = { baby:0.55, adult:1.15, boss:1.80, superboss:2.45, bigmomma:3.00 };
const ANIMAL_STAGE_DAMAGE_TAKEN = { baby:1.04, adult:1.00, boss:0.96, superboss:0.92, bigmomma:0.88 };


const PET_STAT_UPGRADE_MAX = 10;
const PET_STAT_UPGRADE_INFO = {
  health:  { name:"Health",  icon:"❤", desc:"More maximum health.", per:0.08 },
  defense: { name:"Defense", icon:"🛡", desc:"Takes less damage from attacks.", per:0.045 },
  attack:  { name:"Attack",  icon:"⚔", desc:"Stronger normal attacks.", per:0.075 },
  weight:  { name:"Weight",  icon:"◆", desc:"Harder for players and animals to push around.", per:0.12 },
  regen:   { name:"Regen",   icon:"✚", desc:"Recovers health faster over time.", per:0.12 },
  speed:   { name:"Speed",   icon:"➜", desc:"Moves and follows you faster.", per:0.04 },
};
function ensurePetStatUpgrades(type) {
  if (!meta.petStatUpgrades) meta.petStatUpgrades = {};
  if (!meta.petStatUpgrades[type]) meta.petStatUpgrades[type] = {};
  for (const stat of Object.keys(PET_STAT_UPGRADE_INFO)) {
    const v = Number(meta.petStatUpgrades[type][stat]) || 0;
    meta.petStatUpgrades[type][stat] = clamp(Math.floor(v), 0, PET_STAT_UPGRADE_MAX);
  }
  return meta.petStatUpgrades[type];
}
function petStatLevel(type, stat) { return Number(ensurePetStatUpgrades(type)[stat]) || 0; }
function petStatUpgradeCost(type, stat) {
  const level = petStatLevel(type, stat);
  return level >= PET_STAT_UPGRADE_MAX ? 0 : 5 + level * 5;
}
function petUpgradeMultiplier(type, stat) {
  const level = petStatLevel(type, stat);
  const info = PET_STAT_UPGRADE_INFO[stat];
  if (!info || level <= 0) return 1;
  if (stat === "defense") return Math.max(0.55, 1 - info.per * level);
  return 1 + info.per * level;
}
function upgradedPetMaxHp(type, stage) { return Math.max(12, Math.round(typeHp(type, stage) * petUpgradeMultiplier(type, "health"))); }
function upgradedPetSpeed(type, stage) { return animalSpeed(type, stage, true) * petUpgradeMultiplier(type, "speed"); }
function upgradedPetDamageTaken(p, rawDamage) { return animalDamageTaken(p.type, p.stage, rawDamage) * petUpgradeMultiplier(p.type, "defense"); }
function applyOwnedPetCardStats(p, refillHealth = false) {
  if (!p || !p.type) return p;
  const oldMax = Math.max(1, Number(p.maxHp) || typeHp(p.type, p.stage));
  const newMax = upgradedPetMaxHp(p.type, p.stage);
  const hpRatio = clamp((Number(p.hp) || oldMax) / oldMax, 0, 1);
  p.maxHp = newMax;
  p.hp = refillHealth ? newMax : Math.min(newMax, Math.max(1, newMax * hpRatio));
  p.speed = upgradedPetSpeed(p.type, p.stage);
  return p;
}

function animalBalance(type) {
  return ANIMAL_BALANCE[type] || { hpMul:1, babyHpMul:1, damageTaken:1, attack:7 };
}
function animalDamageTaken(type, stage, rawDamage) {
  const raw = Math.max(0, Number(rawDamage) || 0);
  if (raw <= 0) return 0;
  const b = animalBalance(type);
  const stageMul = ANIMAL_STAGE_DAMAGE_TAKEN[stage] ?? 1;
  return Math.max(0.1, raw * b.damageTaken * stageMul);
}
function dogWallStats(stage) {
  if (stage === "baby") return { hp:90, spikeDmg:4.0 };
  if (stage === "adult") return { hp:120, spikeDmg:6.0 };
  if (stage === "boss") return { hp:165, spikeDmg:8.5 };
  if (stage === "superboss") return { hp:220, spikeDmg:11.5 };
  return { hp:280, spikeDmg:14.0 };
}
function wallDamageForTool(toolName, wall) {
  const t = TOOLS[toolName] || TOOLS.Fist;
  return wall && wall.kind === "stoneSpike" ? (t.stoneWall || 0.5) : (t.woodWall || 1);
}

const PET_UNLOCK = {
  dog:    { cards: 0,  servs: 0,    rarity: "Starter" },
  cat:    { cards: 0,  servs: 0,    rarity: "Starter" },
  dragon: { cards: 0,  servs: 0,    rarity: "Starter" },
  rabbit: { cards: 55, servs: 600,  rarity: "Common" },
  fox:    { cards: 55, servs: 650,  rarity: "Common" },
  owl:    { cards: 60, servs: 750,  rarity: "Common" },
  deer:   { cards: 70, servs: 900,  rarity: "Uncommon" },
  wolf:   { cards: 80, servs: 1100, rarity: "Uncommon" },
  snake:  { cards: 85, servs: 1200, rarity: "Uncommon" },
  boar:   { cards: 95, servs: 1400, rarity: "Rare" },
  bear:   { cards: 110,servs: 1800, rarity: "Rare" },
  saber:  { cards: 120,servs: 2200, rarity: "Legendary" },
};
const PET_CARD_STAGE_ORDER = ["baby", "adult", "boss", "superboss"];
const PET_CARD_STAGE_COST = {
  adult: 20,
  boss: 50,
  superboss: 100,
};

function cardsNeeded(type) {
  return (PET_UNLOCK[type] && PET_UNLOCK[type].cards) || 50;
}
function normalizePetCardStage(stage) {
  return PET_CARD_STAGE_ORDER.includes(stage) ? stage : "baby";
}
function starterStageFor(type) {
  if (!type || !meta || !meta.petStages) return "baby";
  return normalizePetCardStage(meta.petStages[type]);
}
function nextPetCardStage(stage) {
  const i = PET_CARD_STAGE_ORDER.indexOf(normalizePetCardStage(stage));
  return i >= 0 && i < PET_CARD_STAGE_ORDER.length - 1 ? PET_CARD_STAGE_ORDER[i + 1] : null;
}
function petStageUpgradeCost(nextStage) {
  return PET_CARD_STAGE_COST[nextStage] || 0;
}

function servsUnlockPrice(type) {
  return (PET_UNLOCK[type] && PET_UNLOCK[type].servs) || 500;
}
function isBossTier(stage) {
  return stage === "boss" || stage === "superboss" || stage === "bigmomma";
}
function stageDisplayName(stage) {
  if (stage === "superboss") return "Super Boss";
  if (stage === "bigmomma") return "Big Momma";
  return stage ? stage.charAt(0).toUpperCase() + stage.slice(1) : "";
}
function animalRadius(type, stage) {
  const mul = (PET_TYPES[type] && PET_TYPES[type].sizeMul) || 1;
  let base = 18;
  if (stage === "adult") base = 36;
  else if (stage === "boss") base = 52;
  else if (stage === "superboss") base = 68;
  else if (stage === "bigmomma") base = 92;

  let extra = 1;
  if (stage === "boss" || stage === "superboss" || stage === "bigmomma") {
    extra = (type === "bear" || type === "saber") ? 1.28 : (type === "wolf" || type === "boar") ? 1.18 : 1.1;
  }
  return base * mul * extra;
}
function uploadedAnimalVisibleDimensions(type, stage) {
  const baseR = animalRadius(type, stage);
  const speciesHeight = {
    dog: 1.06, cat: 1.02, dragon: 1.00,
    fox: 1.06, wolf: 1.10, bear: 1.18, rabbit: 0.98, owl: 1.48, snake: 0.68,
    deer: 0.98
  }[type];

  // Non-uploaded species keep using the original radius-based collision model.
  if (!speciesHeight) return null;

  const stageScale = {
    baby: 1.78,
    adult: 1.52,
    boss: 1.43,
    superboss: 1.40,
    bigmomma: 1.38
  }[stage] || 1.45;

  const lengthMul = {
    dog: 1.62, cat: 1.58, dragon: 1.92,
    fox: 1.70, wolf: 1.72, bear: 1.42, rabbit: 1.42, owl: 1.05, snake: 3.70,
    deer: 1.78
  }[type] || 1.55;

  const h = baseR * speciesHeight * stageScale;
  return { h, w: h * lengthMul };
}

function animalWeight(aOrType, stageMaybe = null) {
  const type = typeof aOrType === "string" ? aOrType : (aOrType?.type || "dog");
  const stage = stageMaybe || (typeof aOrType === "object" ? aOrType?.stage : null) || "adult";

  // Stage is the main weight jump.
  const stageMass = {
    baby: 0.78,
    adult: 1.35,
    boss: 2.10,
    superboss: 3.25,
    bigmomma: 5.10
  }[stage] || 1.35;

  // Species density/shape. Rabbits remain light even when visually large;
  // bears/wolves are harder to shove.
  const speciesMass = {
    rabbit: 0.58,
    cat: 0.72,
    fox: 0.82,
    dragon: 0.88,
    dog: 1.00,
    owl: 0.72,
    deer: 1.05,
    snake: 0.78,
    wolf: 1.28,
    boar: 1.42,
    saber: 1.38,
    bear: 1.75
  }[type] || 1;

  // Tie weight to visible size too, but keep it controlled so art proportions
  // don't make one species absurdly heavy.
  const dims = uploadedAnimalVisibleDimensions(type, stage);
  let sizeMass = 1;
  if (dims) {
    const area = Math.max(1, dims.w * dims.h);
    sizeMass = Math.max(0.82, Math.min(1.42, Math.sqrt(area / 4200)));
  } else {
    const r = animalRadius(type, stage);
    sizeMass = Math.max(0.85, Math.min(1.4, r / 34));
  }

  let result = Math.max(0.35, stageMass * speciesMass * sizeMass);
  if (typeof aOrType === "object" && aOrType?.owned) result *= petUpgradeMultiplier(type, "weight");
  return result;
}

function animalPushMobility(a) {
  // 1.0 = very easy to push, near 0 = extremely heavy.
  const w = animalWeight(a);
  return Math.max(0.08, Math.min(0.92, 1 / (0.55 + w)));
}

function animalHitboxFit(type, stage) {
  // Fine-tune collision so it follows the visible animal size proportionately.
  // Bigger stages get slightly larger length/height fit, and each species keeps
  // its own body style (long dragon, stocky bear, etc).
  const stageFit = {
    baby:      { len: 1.04, body: 1.04, head: 1.08 },
    adult:     { len: 0.90, body: 0.90, head: 0.88 },
    boss:      { len: 1.04, body: 1.04, head: 1.08 },
    superboss: { len: 1.06, body: 1.05, head: 1.10 },
    bigmomma:  { len: 1.08, body: 1.06, head: 1.12 }
  }[stage] || { len: 1.04, body: 1.04, head: 1.08 };

  const speciesFit = {
    dog:    { len: 1.02, body: 1.03, head: 1.04 },
    cat:    { len: 1.02, body: 1.00, head: 1.04 },
    dragon: { len: 1.07, body: 0.99, head: 1.08 },
    fox:    { len: 1.03, body: 1.01, head: 1.05 },
    wolf:   { len: 1.03, body: 1.04, head: 1.05 },
    bear:   { len: 0.99, body: 1.08, head: 1.05 },
    rabbit: { len: 1.02, body: 1.00, head: 1.08 },
    snake:  { len: 1.08, body: 0.98, head: 1.08 },
    boar:   { len: 1.03, body: 1.04, head: 1.06 },
    saber:  { len: 1.03, body: 1.04, head: 1.06 },
    deer:   { len: 0.98, body: 0.88, head: 0.90 },
    owl:    { len: 1.00, body: 1.02, head: 1.05 }
  }[type] || { len: 1.02, body: 1.02, head: 1.05 };

  return {
    len: stageFit.len * speciesFit.len,
    body: stageFit.body * speciesFit.body,
    head: stageFit.head * speciesFit.head
  };
}

function animalSpawnFootprint(type, stage) {
  const fit = animalHitboxFit(type, stage);
  const dims = uploadedAnimalVisibleDimensions(type, stage);
  if (dims) {
    // Use the same proportional fit as the actual physical hitbox.
    return Math.hypot(dims.w * 0.5 * fit.len, dims.h * 0.5 * Math.max(fit.body, fit.head)) * 0.92;
  }

  const r = animalRadius(type, stage);
  const stagePad =
    stage === "bigmomma" ? 1.62 :
    stage === "superboss" ? 1.52 :
    stage === "boss" ? 1.44 :
    stage === "adult" ? 1.36 : 1.28;
  return r * stagePad * Math.max(fit.len, fit.body, fit.head);
}
function typeHp(type, stage) {
  const base = ANIMAL_STAGE_HP[stage] ?? ANIMAL_STAGE_HP.adult;
  const b = animalBalance(type);
  const babyMul = stage === "baby" ? (b.babyHpMul || 1) : 1;
  return Math.max(12, Math.round(base * b.hpMul * babyMul));
}
function typeDmg(type, stage) {
  const b = animalBalance(type);
  const stageMul = ANIMAL_STAGE_ATTACK[stage] ?? 1;
  return b.attack * stageMul;
}
function animalSpeed(type, stage, owned) {
  const base = (PET_TYPES[type] && PET_TYPES[type].baseSpeed) || 60;
  let stageMul = 1.08;
  if (stage === "adult") stageMul = 0.95;
  else if (stage === "boss") stageMul = 0.72;
  else if (stage === "superboss") stageMul = 0.62;
  else if (stage === "bigmomma") stageMul = 0.72;
  const followBoost = owned ? 1.55 : 1;
  return base * stageMul * followBoost;
}

function animalAttackCooldown(type, stage, owned = false) {
  if (type === "rabbit") {
    return owned
      ? (stage === "baby" ? 0.46 : stage === "adult" ? 0.35 : stage === "boss" ? 0.28 : 0.24)
      : (stage === "bigmomma" ? 0.84 : stage === "superboss" ? 0.74 : stage === "boss" ? 0.62 : 0.78);
  }
  return owned
    ? (stage === "baby" ? 0.55 : stage === "adult" ? 0.4 : stage === "boss" ? 0.32 : 0.28)
    : (stage === "bigmomma" ? 1.25 : stage === "superboss" ? 0.95 : stage === "boss" ? 0.8 : 1.05);
}

// Physical animal melee only connects when the attacker's HEAD overlaps the target.
// This mirrors the visible head geometry closely enough that bites feel contact-based.
function animalHeadHitbox(a) {
  // One clear face/head damage zone. It reaches the visible head while leaving
  // the very tip of the snout cosmetic.
  const r = a.r || 18;
  let forward = 1.14;
  let radiusMul = 0.46;

  if (a.type === "bear") { forward = 1.08; radiusMul = 0.49; }
  else if (a.type === "rabbit") { forward = 1.12; radiusMul = 0.42; }
  else if (a.type === "cat") { forward = 1.17; radiusMul = 0.43; }
  else if (a.type === "fox") { forward = 1.20; radiusMul = 0.44; }
  else if (a.type === "wolf" || a.type === "dog") { forward = 1.20; radiusMul = 0.44; }
  else if (a.type === "owl") { forward = 1.05; radiusMul = 0.49; }
  else if (a.type === "deer") { forward = 1.18; radiusMul = 0.40; }
  else if (a.type === "boar" || a.type === "saber") { forward = 1.18; radiusMul = 0.45; }
  else if (a.type === "snake") { forward = 1.26; radiusMul = 0.29; }
  else if (a.type === "dragon") { forward = 1.22; radiusMul = 0.40; }

  const stageMul = a.stage === "baby" ? 1.04 :
    a.stage === "boss" ? 1.05 :
    a.stage === "superboss" ? 1.07 :
    a.stage === "bigmomma" ? 1.09 : 1;

  const angle = a.angle || 0;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const side = 0.10; // a small local-down shift under the visible snout

  return {
    x: a.x + ca * r * forward - sa * r * side,
    y: a.y + sa * r * forward + ca * r * side,
    r: Math.max(8, r * radiusMul * stageMul),
  };
}
function animalHeadTouches(a, tx, ty, tr) {
  const h = animalHeadHitbox(a);
  // Bite contact is intentionally tighter than normal body collision.
  // The animal's face must actually reach the target; no large invisible buffer.
  const targetR = Math.max(2, (tr || 0) * 0.78);
  return dist(h.x, h.y, tx, ty) <= h.r + targetR + 3;
}
function animalHeadTouchesTarget(a, target) {
  if (!a || !target) return false;
  return animalHeadTouches(a, target.x, target.y, target.r || PLAYER_R);
}

function petAtkDmg(p) {
  const stageMul = p.stage === "baby" ? 0.55 : p.stage === "adult" ? 1 : p.stage === "boss" ? 1.65 : p.stage === "superboss" ? 2.25 : 2.6;
  const lvlBonus = 1 + (p.level || 1) * 0.12;
  const speciesMul = clamp(animalBalance(p.type).attack / 7.5, 0.72, 1.55);
  return (6 + (p.r || 15) * 0.15) * stageMul * lvlBonus * speciesMul * petUpgradeMultiplier(p.type, "attack");
}

function expToNext(stage, level) {
  if (stage === "baby") return 40 + level * 8;
  if (stage === "adult") return 70 + level * 12;
  if (stage === "boss") return 160 + level * 26;
  if (stage === "superboss") return 420 + level * 45;
  return 9999;
}

function givePetExp(p, amount) {
  if (!p || p.dead || p.stage === "bigmomma") return;
  amount = Math.max(0, Number(amount) || 0) * runPetXpMul();
  if (amount > 0) p._xpBarShownAt = performance.now();
  p.exp = (p.exp || 0) + amount;
  const need = expToNext(p.stage, p.level || 1);
  if (p.exp < need) return;

  p.exp -= need;
  p.level = (p.level || 1) + 1;

  if (p.stage === "baby" && p.level >= 4) {
    p.stage = "adult";
    p.r = animalRadius(p.type, "adult");
    p.maxHp = upgradedPetMaxHp(p.type, "adult"); p.hp = p.maxHp;
    p.speed = upgradedPetSpeed(p.type, "adult");
    p.level = 1;
    banner(`${petDisplayName(p)} grew into an Adult!`);
    spark(p.x, p.y, "#7be08a", 14, 120);
    floatText(p.x, p.y - 30, "ADULT!", "#7be08a");
  } else if (p.stage === "adult" && p.level >= 5) {
    p.stage = "boss";
    p.r = animalRadius(p.type, "boss");
    p.maxHp = upgradedPetMaxHp(p.type, "boss"); p.hp = p.maxHp;
    p.speed = upgradedPetSpeed(p.type, "boss");
    p.level = 1;
    banner(`${petDisplayName(p)} became a Boss!`);
    spark(p.x, p.y, "#f2c94c", 18, 140);
    floatText(p.x, p.y - 34, "BOSS!", "#f2c94c");
  } else if (p.stage === "boss" && p.level >= 6) {
    p.stage = "superboss";
    p.r = animalRadius(p.type, "superboss");
    p.maxHp = upgradedPetMaxHp(p.type, "superboss"); p.hp = p.maxHp;
    p.speed = upgradedPetSpeed(p.type, "superboss");
    p.level = 1;
    banner(`${petDisplayName(p)} became a SUPER BOSS!`);
    spark(p.x, p.y, "#ffe66d", 26, 175);
    floatText(p.x, p.y - 42, "SUPER BOSS!", "#ffe66d");
  } else {
    floatText(p.x, p.y - p.r - 12, "Lv " + p.level, p.stage === "superboss" ? "#ffe66d" : "#a0e0ff");
  }
  syncPetCards();
}

// ---------- utility ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function segmentCircleT(x0,y0,x1,y1,cx,cy,r) {
  const dx=x1-x0, dy=y1-y0, len2=dx*dx+dy*dy;
  let t=len2>1e-8?((cx-x0)*dx+(cy-y0)*dy)/len2:0;
  t=clamp(t,0,1);
  const qx=x0+dx*t, qy=y0+dy*t;
  return dist(qx,qy,cx,cy)<=r ? t : null;
}
function animalProjectileSegmentT(a,x0,y0,x1,y1,radius=0) {
  let best=null;
  for (const h of animalBodyHitboxes(a)) {
    const t=segmentCircleT(x0,y0,x1,y1,h.x,h.y,radius+h.r);
    if (t!=null && (best==null || t<best)) best=t;
  }
  return best;
}
function resourceProjectileSegmentT(r,x0,y0,x1,y1,radius=0) {
  if (!r || !r.alive) return null;
  const hits=r.type==="log"?logSolidHitboxes(r):[{...resourceSolidCenter(r),r:r.solidR}];
  let best=null;
  for(const h of hits){const t=segmentCircleT(x0,y0,x1,y1,h.x,h.y,radius+h.r);if(t!=null&&(best==null||t<best))best=t;}
  return best;
}
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = ((b - a + Math.PI) % TAU) - Math.PI; return d < -Math.PI ? d + TAU : d; };

function pickWeighted(list) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let r = rand(0, total);
  for (const item of list) { if ((r -= item.w) <= 0) return item.v; }
  return list[list.length - 1].v;
}

// ---------- save / meta ----------
const META_KEY = "cubeSurvivalMeta_v2";
function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw);
      // migrate old generic petCards → speciesCards
      if (!m.speciesCards) {
        m.speciesCards = { dog: 0, cat: 0, dragon: 0, fox: 0, wolf: 0, bear: 0, rabbit: 0 };
        if (m.petCards) {
          // spread old cards into free starters as a soft migration
          m.speciesCards.dog = Math.min(3, m.petCards);
        }
      }
      if (!m.ownedStarters) m.ownedStarters = {};
      if (!m.petStages) m.petStages = {};
      if (!m.petStatUpgrades) m.petStatUpgrades = {};
      for (const k of Object.keys(PET_TYPES)) {
        if (m.speciesCards[k] == null) m.speciesCards[k] = 0;
        if (!PET_CARD_STAGE_ORDER.includes(m.petStages[k])) m.petStages[k] = "baby";
        if (!m.petStatUpgrades[k]) m.petStatUpgrades[k] = {};
        for (const stat of ["health","defense","attack","weight","regen","speed"]) {
          const n = Number(m.petStatUpgrades[k][stat]) || 0;
          m.petStatUpgrades[k][stat] = Math.max(0, Math.min(10, Math.floor(n)));
        }
      }
      return m;
    }
  } catch (e) {}
  return {
    servs: 0, username: "Cube", color: COLORS[0],
    ownedStarters: {},
    speciesCards: { dog: 0, cat: 0, dragon: 0, fox: 0, wolf: 0, bear: 0, rabbit: 0 },
    petStages: {},
    petStatUpgrades: {},
    lastDaily: null,
  };
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) {}
}
let meta = loadMeta();


// ---------- safe multiplayer chat ----------
const CHAT_MAX_LENGTH = 120;
const CHAT_MAX_LINES = 45;
const CHAT_COOLDOWN_MS = 650;
let lastChatSentAt = 0;

// Chat is intentionally stricter than player display names.
// This protects the public chat without removing player names from the game.
const CHAT_BLOCKED_WORDS = [
  "fuck","fucker","fucking","shit","bullshit","bitch","bitches","asshole","ass",
  "dick","cock","pussy","cunt","motherfucker","nigger","nigga","faggot",
  "retard","whore","slut","bum",
  // Requested phonetic / workaround spellings.
  "ahh","fuh","fah","greened","dih","puh"
];

const CHAT_BLOCKED_SOCIALS = [
  "discord","disscord","dischord",
  "snapchat","snap",
  "instagram","insta",
  "tiktok",
  "telegram",
  "whatsapp",
  "signal",
  "kik",
  "facebook",
  "messenger",
  "twitter",
  "reddit",
  "youtube",
  "twitch",
  "steam",
  "roblox",
  "guilded",
  "revolt",
  "bereal",
  "wechat",
  "lineapp",
  "viber",
  "groupme",
  "skype",
  "teamspeak",
  "yubo",
  "hoop",
  "wink",
  "meetme"
];

const CHAT_BLOCKED_CHAT_TERMS = [
  "username","user name","user-name",
  "handle","gamertag","gamer tag",
  "email","e mail","e-mail",
  "gmail","outlook","hotmail","protonmail",
  "phone number","phone #","cell number",
  "private chat","private message",
  "dm me","d m me","pm me","p m me",
  "message me","text me","call me",
  "add me","follow me","contact me",
  "find me on","talk to me on","chat with me on",
  "my snap","your snap","my insta","your insta",
  "my discord","your discord","my telegram","your telegram",
  "send me your","give me your",
  "what is your username","whats your username","what's your username",
  "what is your user name","whats your user name","what's your user name",
  "real name","full name",
  "where do you live","what city do you live","what state do you live",
  "how old are you","what age are you","what is your age",
  "send a pic","send pic","send a photo","send photo",
  "meet up","meet in real life","meet irl"
];

// Sexual / adult-content terms get their own stricter category.
// These are blocked even when they are not conventional curse words.
const CHAT_BLOCKED_SEXUAL_TERMS = [
  "porn","porno","pornography","pornographic",
  "xxx","nsfw","adult content","adult site","adult video","adult videos",
  "hentai","rule34","rule 34","r34",
  "nude","nudes","naked","nudity",
  "sex","sexual","sexy","sext","sexting","sextortion",
  "erotic","erotica","horny",
  "onlyfans","fansly","pornhub","xvideos","xnxx","redtube","youporn",
  "camgirl","cam boy","camboy","webcam sex","sex cam",
  "strip","stripper","stripping",
  "fetish","kink","bdsm",
  "boob","boobs","breast","breasts","tits","tit",
  "penis","vagina","vulva","anus","anal",
  "dildo","vibrator",
  "blowjob","handjob","rimjob",
  "orgasm","cum","semen",
  "masturbate","masturbation","jerk off",
  "69","sixty nine",
  "send nudes","send nude","send naked","send sexy",
  "show me your body","show your body","take your clothes off",
  "take off your clothes","what are you wearing",
  "sexual roleplay","sex roleplay","erp","erotic roleplay"
];

// Terms and patterns that commonly signal grooming, sextortion, or attempts
// to get private sexual material/contact. These are intentionally strict.
const CHAT_BLOCKED_GROOMING_TERMS = [
  "keep this secret","dont tell your parents","don't tell your parents",
  "dont tell your mom","don't tell your mom",
  "dont tell your dad","don't tell your dad",
  "our secret","between us","no one has to know",
  "prove you trust me","if you love me","if you trust me",
  "send another pic","send another photo",
  "send me a picture","send me a photo",
  "send me a video","send a video",
  "turn on your camera","turn your camera on",
  "video call me","facetime me",
  "are you alone","home alone","parents home",
  "meet me","come meet me","meet in person","meet irl",
  "hotel","motel","pick you up",
  "ill pay you","i'll pay you","pay you for pics","pay for pics",
  "gift card for pics","money for pics",
  "delete the messages","delete this chat","clear the chat"
];

// Extra off-platform / identity services and adult-content sites.
// Keeping these separate makes it easy to expand without touching display names.
const CHAT_BLOCKED_SITE_TERMS = [
  "omegle","ome tv","ometv","chatroulette","monkey app","monkeyapp",
  "onlyfans","fansly","pornhub","xvideos","xnxx","redtube","youporn",
  "discord","snapchat","instagram","tiktok","telegram","whatsapp",
  "signal","kik","facebook","messenger","twitter","x dot com",
  "reddit","youtube","twitch","steam","roblox","guilded","revolt",
  "bereal","wechat","line","viber","groupme","skype","teamspeak",
  "yubo","hoop","wink","meetme"
];

// Brainrot / meme-slang category.
// Kept separate from profanity and safety categories so it can be maintained independently.
const CHAT_BLOCKED_BRAINROT_TERMS = [
  "brainrot","brain rot",
  "skibidi","skibidi toilet",
  "rizz","w rizz","l rizz","unspoken rizz",
  "gyat","gyatt",
  "sigma grindset","what the sigma","sigma boy",
  "fanum","fanum tax","fanum taxed",
  "only in ohio","ohio final boss",
  "aura farming","negative aura","infinite aura",
  "mewing",
  "looksmaxxing","looks maxxing","looksmax",
  "67","6 7","6-7","six seven","six-seven",
  "huzz",
  "crash out","crashout",
  "delulu",
  "low taper fade","taper fade meme",
  "mogging","mogged",
  "gooning",
  "glazing","glazer",
  "ratioed",
  "grimace shake",
  "baby gronk","livvy dunne",
  "kai cenat","ishowspeed",
  "rizzler",
  "goofy ahh","goofy ah",
  "opium bird",
  "smurf cat",
  "sticking out your gyat",
  "goon",
  "sigma",
  "beta male",
  "alpha male"
];



function chatAsciiFold(value) {
  return String(value || "")
    // Remove invisible formatting characters commonly used to split words.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Common Greek/Cyrillic lookalikes.
    .replace(/[аɑα]/g, "a")
    .replace(/[еε]/g, "e")
    .replace(/[іι]/g, "i")
    .replace(/[оο]/g, "o")
    .replace(/[рρ]/g, "p")
    .replace(/[сϲ]/g, "c")
    .replace(/[хχ]/g, "x")
    .replace(/[уγ]/g, "y")
    .replace(/[кκ]/g, "k")
    .replace(/[мμ]/g, "m")
    .replace(/[н]/g, "h")
    .replace(/[тτ]/g, "t");
}

function normalizeChatForFilter(value) {
  return chatAsciiFold(value)
    .replace(/[@4]/g, "a")
    .replace(/[3]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[7+]/g, "t")
    .replace(/[8]/g, "b")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactChatForFilter(value) {
  return normalizeChatForFilter(value).replace(/\s+/g, "");
}

function collapseChatRepeats(value) {
  return String(value || "").replace(/([a-z0-9])\1{1,}/g, "$1");
}

function chatForms(value) {
  const spaced = normalizeChatForFilter(value);
  const compact = spaced.replace(/\s+/g, "");
  return {
    spaced,
    compact,
    collapsedSpaced: collapseChatRepeats(spaced),
    collapsedCompact: collapseChatRepeats(compact)
  };
}

function escapedRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function chatTokenList(value) {
  return normalizeChatForFilter(value).split(/\s+/).filter(Boolean);
}

function limitedEditDistance(a, b, limit = 1) {
  a = String(a || "");
  b = String(b || "");
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a === b) return 0;
  const prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j < cur.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

function chatTermMatches(value, term, fuzzy = false) {
  const forms = chatForms(value);
  const normalizedTerm = normalizeChatForFilter(term);
  if (!normalizedTerm) return false;

  const compactTerm = normalizedTerm.replace(/\s+/g, "");
  const collapsedTerm = collapseChatRepeats(compactTerm);

  if (forms.spaced.includes(normalizedTerm)) return true;
  if (forms.collapsedSpaced.includes(collapseChatRepeats(normalizedTerm))) return true;
  if (compactTerm.length >= 4 && forms.compact.includes(compactTerm)) return true;
  if (collapsedTerm.length >= 4 && forms.collapsedCompact.includes(collapsedTerm)) return true;

  // Catch f.u.c.k / p o r n / n-s-f-w and similar inserted separators.
  if (compactTerm.length >= 3) {
    const splitPattern = new RegExp(compactTerm.split("").map(escapedRegex).join("\\s*"));
    if (splitPattern.test(forms.spaced.replace(/\s+/g, " "))) return true;
  }

  // Small edit-distance matching catches one-character substitutions/deletions
  // and two edits on long high-risk terms without trying to fuzzy-match every word.
  if (fuzzy && compactTerm.length >= 5) {
    const limit = compactTerm.length >= 9 ? 2 : 1;
    const tokens = chatTokenList(value);
    const candidates = new Set([
      ...tokens,
      ...tokens.map(collapseChatRepeats),
      forms.compact,
      forms.collapsedCompact
    ]);
    for (const candidate of candidates) {
      if (candidate.length < 4) continue;
      if (limitedEditDistance(candidate, compactTerm, limit) <= limit) return true;
    }
  }
  return false;
}

function chatHasSexualContent(value) {
  return CHAT_BLOCKED_SEXUAL_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatHasGroomingContent(value) {
  return CHAT_BLOCKED_GROOMING_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatHasBlockedSite(value) {
  return CHAT_BLOCKED_SITE_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatHasBlockedWord(value) {
  return CHAT_BLOCKED_WORDS.some(word => {
    const compact = compactChatForFilter(word);
    // Short terms can create false positives inside innocent words, so keep them exact.
    if (compact.length < 4) {
      const forms = chatForms(value);
      return forms.spaced.split(/\s+/).includes(compact) ||
             forms.collapsedSpaced.split(/\s+/).includes(collapseChatRepeats(compact));
    }
    return chatTermMatches(value, word, true);
  });
}

function chatHasBlockedSocial(value) {
  return CHAT_BLOCKED_SOCIALS.some(name => chatTermMatches(value, name, true)) ||
         chatHasBlockedSite(value);
}

function chatHasBlockedContactPhrase(value) {
  const forms = chatForms(value);
  return CHAT_BLOCKED_CHAT_TERMS.some(term => {
    const t = normalizeChatForFilter(term);
    if (!t) return false;
    if (forms.spaced.includes(t) || forms.collapsedSpaced.includes(collapseChatRepeats(t))) return true;
    const tc = t.replace(/\s+/g, "");
    return tc.length >= 5 &&
      (forms.compact.includes(tc) || forms.collapsedCompact.includes(collapseChatRepeats(tc)));
  });
}

function chatHasLinkOrContact(value) {
  const raw = chatAsciiFold(value).trim();
  const normalized = normalizeChatForFilter(value);
  const squashed = raw.replace(/\s+/g, "");
  const compact = compactChatForFilter(value);

  // URLs / domains / invites.
  if (/\b(?:https?|ftp)\s*:\s*\/\//i.test(raw)) return true;
  if (/\bwww\s*(?:\.|dot)\s*/i.test(raw)) return true;
  if (/\b(?:discord\s*(?:\.|dot)\s*gg|discord\s*(?:\.|dot)\s*com\s*\/\s*invite|t\s*(?:\.|dot)\s*me|youtu\s*(?:\.|dot)\s*be)\b/i.test(raw)) return true;
  if (/\b[a-z0-9][a-z0-9-]{0,62}\s*(?:\.|\bdot\b|\bd0t\b)\s*(?:com|net|org|gg|io|co|app|dev|me|tv|xyz|us|uk|ca|edu|gov)\b/i.test(raw)) return true;

  // Email / handles / IPv4 / likely phone numbers.
  if (/\b[a-z0-9._%+-]+\s*@\s*[a-z0-9.-]+\s*(?:\.|\bdot\b)\s*[a-z]{2,}\b/i.test(raw)) return true;
  if (/@/.test(raw)) return true;
  if (/\b(?:\d{1,3}\s*\.\s*){3}\d{1,3}(?::\d{2,5})?\b/.test(raw)) return true;
  if (/(?:^|\D)(?:\+?\d[\s().-]*){7,15}(?:\D|$)/.test(raw)) return true;

  // Spoken / disguised URL pieces.
  if (/\b(?:dot|d0t|period)\s+(?:com|net|org|gg|io|co|app|dev|me|tv|xyz)\b/i.test(normalized)) return true;
  if (/\b(?:slash|forward slash)\s+(?:invite|join)\b/i.test(normalized)) return true;
  // Common written-out contact/address evasions.
  if (/\b(?:at|at sign)\s+[a-z0-9._-]+\s+(?:dot|d0t|period)\s+[a-z]{2,}\b/i.test(normalized)) return true;
  if (/\b(?:my|add|follow|message|dm|text)\s+[a-z0-9._-]{2,}\s+(?:on|at)\b/i.test(normalized)) return true;
  // Long digit strings with separators or number words often represent phone/contact info.
  if (/(?:^|\D)(?:\d[\s()._\-]*){6,16}(?:\D|$)/.test(raw)) return true;
  if (/\b(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)){5,}\b/i.test(normalized)) return true;
  // "dotcom", "d0tcom", etc. after normalization.
  if (/(?:dot|d0t)(?:com|net|org|gg|io|co|app|dev|me|tv|xyz)/i.test(compact)) return true;

  return false;
}


function chatHasBrainrot(value) {
  return CHAT_BLOCKED_BRAINROT_TERMS.some(term => chatTermMatches(value, term, true));
}

function chatBlockReason(value) {
  if (chatHasSexualContent(value)) return "sexual/adult content";
  if (chatHasGroomingContent(value)) return "unsafe private-contact request";
  if (chatHasBrainrot(value)) return "brainrot/meme slang";
  if (chatHasLinkOrContact(value)) return "links/contact info";
  if (chatHasBlockedSocial(value)) return "social apps/sites";
  if (chatHasBlockedContactPhrase(value)) return "contact/private-chat requests";
  if (chatHasBlockedWord(value)) return "language";
  return "";
}

function chatHasLink(value) {
  return chatHasLinkOrContact(value) || chatHasBlockedSocial(value) || chatHasBlockedContactPhrase(value);
}

function cleanChatText(value) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHAT_MAX_LENGTH);
}

function appendChatLine(name, message, type = "player") {
  const log = document.getElementById("chatLog");
  if (!log) return;
  const line = document.createElement("div");
  line.className = `chat-line ${type === "player" ? "" : type}`.trim();
  if (type === "player") {
    const n = document.createElement("span");
    n.className = "chat-name";
    n.textContent = `${String(name || "Cube").slice(0, 14)}: `;
    const m = document.createElement("span");
    m.textContent = String(message || "");
    line.append(n, m);
  } else {
    line.textContent = String(message || "");
  }
  log.appendChild(line);
  while (log.children.length > CHAT_MAX_LINES) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
}

function setChatOpen(open, focus = true) {
  const box = document.getElementById("chatBox");
  const input = document.getElementById("chatInput");
  if (!box || !input) return;
  box.classList.toggle("show", !!open);
  if (open) {
    keys.clear();
    mouse.down = false;
    mouse.rdown = false;
    if (focus) requestAnimationFrame(() => input.focus());
  } else if (document.activeElement === input) {
    input.blur();
  }
}


function resetChatForNewRun() {
  const log = document.getElementById("chatLog");
  const input = document.getElementById("chatInput");
  if (log) log.innerHTML = "";
  if (input) input.value = "";
  lastChatSentAt = 0;
  setChatOpen(false, false);
}

function receiveChatMessage(data = {}) {
  const message = cleanChatText(data.message ?? data.text ?? "");
  if (!message || chatBlockReason(message)) return;
  const username = cleanChatText(data.username || data.name || "Cube").slice(0, 14) || "Cube";
  appendChatLine(username, message, "player");
}

function sendChatMessage() {
  const input = document.getElementById("chatInput");
  if (!input) return;
  const message = cleanChatText(input.value);
  if (!message) return;
  const blockedFor = chatBlockReason(message);
  if (blockedFor) {
    appendChatLine("", "That message is blocked by the chat safety filter.", "error");
    return;
  }
  const now = performance.now();
  if (now - lastChatSentAt < CHAT_COOLDOWN_MS) {
    appendChatLine("", "Slow down a little before sending another message.", "error");
    return;
  }
  lastChatSentAt = now;
  input.value = "";

  if (net.room) {
    try {
      net.room.send("chat", { message });
      // The server should broadcast the "chat" message to everyone including the sender.
      // If it does not echo to the sender, this local line still gives immediate feedback.
      appendChatLine(meta.username || "Cube", message, "player");
    } catch (_) {
      appendChatLine("", "Chat could not send because the server disconnected.", "error");
    }
  } else {
    appendChatLine(meta.username || "Cube", message, "player");
  }
}

// ---------- starter online multiplayer ----------
// Full online world synchronization: resources, chests, wildlife, pets, hostile cubes, builds, projectiles, combat, taming, time, and player-vs-player damage.
const net = {
  enabled: false,
  client: null,
  room: null,
  sessionId: null,
  connecting: false,
  sendAccum: 0,
  fullSyncAccum: 0,
  remoteVisuals: new Map(),
  resourceVisuals: new Map(),
  goldVisuals: new Map(),
  chestVisuals: new Map(),
  animalVisuals: new Map(),
  petVisuals: new Map(),
  remotePetVisuals: new Map(),
  enemyVisuals: new Map(),
  wallVisuals: new Map(),
  towerVisuals: new Map(),
  projectileVisuals: new Map(),
  initialPositionApplied: false,
  lastPhaseIdx: -1,
  lastStaticChestCount: -1,
  lastAnimalPushAt: 0,
  lastHurtFxAt: 0,
};

function setNetStatus(text, cls = "") {
  const node = document.getElementById("netStatus");
  if (!node) return;
  node.textContent = text;
  node.className = cls;
}

function updateOnlineModeUI() {
  const off = document.getElementById("offlineModeBtn");
  const on = document.getElementById("onlineModeBtn");
  const url = document.getElementById("serverUrl");
  if (off) off.classList.toggle("selected", !net.enabled);
  if (on) on.classList.toggle("selected", net.enabled);
  if (url) url.style.display = net.enabled ? "block" : "none";
  if (!net.room) setNetStatus(net.enabled ? "Ready" : "Offline");
}

function eachNetworkPlayer(callback) {
  const players = net.room && net.room.state && net.room.state.players;
  if (!players) return;
  if (typeof players.forEach === "function") {
    players.forEach((p, id) => callback(p, id));
  }
}


function renderPlayerLeaderboard() {
  const wrap = document.getElementById("playerLeaderboard");
  const rows = document.getElementById("leaderboardRows");
  if (!wrap || !rows) return;

  const list = [];

  if (net.enabled && net.room && net.room.state && net.room.state.players) {
    eachNetworkPlayer((p, id) => {
      list.push({
        id,
        username: String(p.username || "Cube").slice(0, 14),
        kills: Math.max(0, Number(p.kills) || 0),
        gold: Math.max(0, Number(p.gold) || 0)
      });
    });
  } else if (player) {
    list.push({
      id: "offline",
      username: String(player.username || meta.username || "Cube").slice(0, 14),
      kills: Math.max(0, Number(game.kills) || 0),
      gold: Math.max(0, Number(player.gold) || 0)
    });
  }

  list.sort((a, b) =>
    (b.kills - a.kills) ||
    (b.gold - a.gold) ||
    a.username.localeCompare(b.username)
  );

  if (!list.length) {
    rows.innerHTML = '<div class="leaderboard-empty">No players</div>';
    return;
  }

  rows.innerHTML = "";
  list.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "leaderboard-row" + (entry.id === net.sessionId ? " me" : "");

    const rankName = document.createElement("div");
    rankName.className = "leaderboard-rankname";

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = entry.username;

    const kills = document.createElement("span");
    kills.className = "leaderboard-stat leaderboard-kills";
    kills.textContent = String(entry.kills);

    const gold = document.createElement("span");
    gold.className = "leaderboard-stat leaderboard-gold";
    gold.textContent = String(entry.gold);

    rankName.append(rank, name);
    row.append(rankName, kills, gold);
    rows.appendChild(row);
  });
}

function eachNetworkCollection(name, callback) {
  const collection = net.room && net.room.state && net.room.state[name];
  if (!collection || typeof collection.forEach !== "function") return;
  collection.forEach((item, id) => callback(item, id));
}

function syncNetworkWorldResources() {
  if (!net.room || !net.room.state) return false;
  const serverResources = [];
  const serverGold = [];
  const resourceVisuals = new Map();
  const goldVisuals = new Map();

  eachNetworkCollection("resources", (s, id) => {
    const r = {
      netId: id,
      netState: s,
      type: s.type || "rock",
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      hp: Number(s.hp) || 0,
      maxHp: Number(s.maxHp) || 1,
      alive: s.alive !== false,
      respawnAt: 0,
      pulse: 0,
      gatherCredit: 0,
      solidR: Number(s.solidR) || 12,
      canopyR: Number(s.canopyR) || 0,
      scale: Number(s.scale) || 1,
      rot: Number(s.rot) || 0,
    };
    serverResources.push(r);
    resourceVisuals.set(id, r);
  });

  eachNetworkCollection("gold", (s, id) => {
    const infinite = !!s.infinite;
    const g = {
      netId: id,
      netState: s,
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      size: s.size || "small",
      r: Number(s.r) || 16,
      goldLeft: infinite ? Infinity : Math.max(0, Number(s.goldLeft) || 0),
      infinite,
      pure: !!s.pure,
      pulse: 0,
      handGatherCredit: 0,
    };
    serverGold.push(g);
    goldVisuals.set(id, g);
  });

  if (!serverResources.length || !serverGold.length) return false;
  resources = serverResources;
  goldChunks = serverGold;
  net.resourceVisuals = resourceVisuals;
  net.goldVisuals = goldVisuals;
  rebuildStaticCollisionGrid();

  // The online resource layout comes from the server, so make sure the local
  // player didn't happen to spawn inside one of the newly synchronized objects.
  if (solidOverlaps(player.x, player.y, PLAYER_R + 10)) {
    const safe = chooseRandomPlayerSpawn();
    player.x = safe.x;
    player.y = safe.y;
  }
  return true;
}

function findNetHarvestTarget(id) {
  return net.resourceVisuals.get(id) || net.goldVisuals.get(id) || null;
}

function parseNetSpots(s) {
  const raw = (s && s.spotsJson) || "[]";
  try { return JSON.parse(raw); } catch (_) { return []; }
}
function updateNetAnimalVisual(v, s, id, owned = false) {
  const fresh = !v;
  if (!v) v = {};
  v.netId = id;
  v.type = s.type || "dog";
  v.stage = s.stage || "baby";
  const sx = Number(s.x) || 0, sy = Number(s.y) || 0, sa = Number(s.angle) || 0;
  if (owned) {
    // Estimate velocity from the real time between state patches instead of
    // assuming a fixed network rate. This keeps pet motion smooth through jitter.
    const patchNow = performance.now();
    const oldX = Number.isFinite(v._netX) ? v._netX : sx;
    const oldY = Number.isFinite(v._netY) ? v._netY : sy;
    const patchDt = Math.max(0.025, Math.min(0.25, (patchNow - (v._netPatchAt || patchNow - 50)) / 1000));
    v._netPatchAt = patchNow;
    v._netVX = (sx - oldX) / patchDt;
    v._netVY = (sy - oldY) / patchDt;
    const netMoveSpeed = Math.hypot(v._netVX, v._netVY);
    const prevVisualSpeed = Number(v._visualMoveSpeed) || 0;
    v._visualMoveSpeed = prevVisualSpeed + (netMoveSpeed - prevVisualSpeed) * 0.28;
    if (v._visualMoveSpeed > 0.35) v._visualMoveAt = patchNow;
    v._netX = sx; v._netY = sy; v._netAngle = sa;
    if (fresh || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.hypot(sx - v.x, sy - v.y) > 360) {
      v.x = sx; v.y = sy; v.angle = sa;
    }
  } else {
    // Wild multiplayer animals use buffered interpolation ONLY. Do not predict
    // ahead of the server: prediction was causing late updates to create large
    // catch-up jumps that could visually skip through hitboxes.
    const patchNow = performance.now();
    const oldNetX = Number.isFinite(v._netX) ? v._netX : sx;
    const oldNetY = Number.isFinite(v._netY) ? v._netY : sy;
    const oldNetAngle = Number.isFinite(v._netAngle) ? v._netAngle : sa;
    const mdx = sx - oldNetX, mdy = sy - oldNetY;
    const moveLen = Math.hypot(mdx, mdy);
    const patchDt = Math.max(0.06, Math.min(0.30, (patchNow - (v._netPatchAt || patchNow - 100)) / 1000));
    v._netPatchAt = patchNow;

    if (fresh || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.hypot(sx - v.x, sy - v.y) > 360) {
      v.x = sx; v.y = sy; v.angle = sa;
      v._snapFromX = sx; v._snapFromY = sy;
      v._snapToX = sx; v._snapToY = sy;
      v._snapFromAngle = sa; v._snapToAngle = sa;
      v._snapStart = patchNow; v._snapDuration = 100;
      v._carryPending = false;
    } else if (Math.abs(mdx) > 0.001 || Math.abs(mdy) > 0.001 || Math.abs(sa - oldNetAngle) > 0.001) {
      // Start the next segment from the CURRENT rendered point, not the previous
      // network point. If a packet arrives late, this prevents a backwards snap.
      v._snapFromX = v.x; v._snapFromY = v.y;
      v._snapToX = sx; v._snapToY = sy;
      v._snapFromAngle = Number.isFinite(v.angle) ? v.angle : oldNetAngle;
      v._snapToAngle = sa;
      v._snapStart = patchNow;

      // Never animate faster than a believable short sprint. If one update spans
      // more distance, stretch the interpolation time instead of zooming forward.
      const normalSpeed = Math.max(35, Number(s.speed) || animalSpeed(v.type, v.stage, false) || 60);
      const maxVisualSpeed = normalSpeed * 1.85 + 30;
      const distanceMs = moveLen > 0.01 ? (moveLen / maxVisualSpeed) * 1000 : 0;
      v._snapDuration = Math.max(90, Math.min(320, Math.max(patchDt * 1050, distanceMs)));

      if (moveLen > 0.001) {
        const measuredSpeed = Math.min(maxVisualSpeed, moveLen / patchDt);
        const prevVisualSpeed = Number(v._visualMoveSpeed) || 0;
        v._visualMoveSpeed = prevVisualSpeed + (measuredSpeed - prevVisualSpeed) * 0.20;
        v._visualMoveAt = patchNow;
      }

      if (moveLen < 150) {
        v._moveDx = mdx;
        v._moveDy = mdy;
        v._carryPending = true;
      } else {
        v._carryPending = false;
      }
    }

    v._netX = sx; v._netY = sy; v._netAngle = sa;
  }
  v.r = Number(s.r) || animalRadius(v.type, v.stage);
  v.hp = Math.max(0, Number(s.hp) || 0); v.maxHp = Math.max(1, Number(s.maxHp) || 1);
  v.coat = s.coat || (PET_TYPES[v.type] && PET_TYPES[v.type].color) || "#c9a06a";
  v.spotCol = s.spotCol || shadeColor(v.coat, -30);
  if (v._spotsJson !== s.spotsJson) { v._spotsJson = s.spotsJson; v.spots = parseNetSpots(s); }
  v.speed = Number(s.speed) || animalSpeed(v.type, v.stage, owned);
  v.sleeping = !!s.sleeping;
  if (fresh || !Number.isFinite(v.tailPhase)) v.tailPhase = Number(s.tailPhase) || 0;
  v._serverTailPhase = Number(s.tailPhase) || 0;
  v.attackAnim = Number(s.attackAnim) || 0; v.flash = Number(s.flash) || 0;
  v.atkCd = Number(s.atkCd) || 0; v.abilityCd = Number(s.abilityCd) || 0;
  v.combat = Number(s.combat) || 0; v.recentHit = Number(s.recentHit) || 0;
  v.wanderT = Number(s.wanderT) || 0; v.wanderA = Number(s.wanderA) || 0;
  v.fleeUntil = Number(s.fleeUntil) || 0; v.enraged = !!s.enraged;
  v.tameFailedAggro = !!s.tameFailedAggro; v.desperateAggro = !!s.desperateAggro;
  v.releasedWild = !!s.releasedWild;
  const nextLevel = Number(s.level) || 1;
  const nextExp = Number(s.exp) || 0;
  if (!fresh && owned) {
    const oldLevel = Number(v.level) || 1;
    const oldExp = Number(v.exp) || 0;
    if (nextLevel > oldLevel || (nextLevel === oldLevel && nextExp > oldExp + 0.001)) {
      v._xpBarShownAt = performance.now();
    }
  }
  v.level = nextLevel; v.exp = nextExp;
  v.petName = s.petName || (PET_TYPES[v.type] && PET_TYPES[v.type].name) || "Pet";

  // Multiplayer pets use the exact same local renderer/design tables as offline
  // pets. Keep all skin-driving state on the visual object so remote pets retain
  // their species, stage, coat, spots, sleep pose, head/tail motion and split art.
  v.skinType = v.type;
  v.skinStage = v.stage;
  v.dead = !!s.dead; v.owned = owned;
  if (owned) {
    v.ownerId = s.ownerId || "";
    v.orderMode = s.orderMode || "follow";
    v.follow = v.orderMode === "follow" || v.orderMode === "defend";
    v.targetX = Number(s.targetX) >= 0 ? Number(s.targetX) : null;
    v.targetY = Number(s.targetY) >= 0 ? Number(s.targetY) : null;
  }
  return v;
}

function updateNetworkAnimalInterpolation(dt) {
  if (!net.room) return;
  const now = performance.now();

  for (const a of net.animalVisuals.values()) {
    if (!a || !Number.isFinite(a._netX) || !Number.isFinite(a._netY)) continue;

    // Off-screen animals do not need interpolation work.
    if (!inView(a._netX, a._netY, 420)) {
      a.x = a._netX;
      a.y = a._netY;
      a.angle = a._netAngle || a.angle || 0;
      a._renderVX = 0;
      a._renderVY = 0;
      continue;
    }

    const fromX = Number.isFinite(a._snapFromX) ? a._snapFromX : a.x;
    const fromY = Number.isFinite(a._snapFromY) ? a._snapFromY : a.y;
    const toX = Number.isFinite(a._snapToX) ? a._snapToX : a._netX;
    const toY = Number.isFinite(a._snapToY) ? a._snapToY : a._netY;
    const startAt = Number(a._snapStart) || now;
    const duration = Math.max(1, Number(a._snapDuration) || 120);
    const t = clamp((now - startAt) / duration, 0, 1);

    // Linear snapshot interpolation gives consistent speed and does not overshoot.
    const prevX = a.x, prevY = a.y;
    a.x = lerp(fromX, toX, t);
    a.y = lerp(fromY, toY, t);

    // Keep the rendered wildlife outside static collision geometry. This is only
    // a visual guard; the server remains authoritative for actual collisions.
    resolveAnimalWorld(a);

    const frameDt = Math.max(1 / 240, dt);
    const rvx = (a.x - prevX) / frameDt;
    const rvy = (a.y - prevY) / frameDt;
    const velocityBlend = 1 - Math.exp(-7 * dt);
    a._renderVX = (Number(a._renderVX) || 0) + (rvx - (Number(a._renderVX) || 0)) * velocityBlend;
    a._renderVY = (Number(a._renderVY) || 0) + (rvy - (Number(a._renderVY) || 0)) * velocityBlend;

    let fromA = Number.isFinite(a._snapFromAngle) ? a._snapFromAngle : (a.angle || 0);
    let toA = Number.isFinite(a._snapToAngle) ? a._snapToAngle : (a._netAngle || 0);
    let da = toA - fromA;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    a.angle = fromA + da * t;

    const measuredRatio = Math.max(0, Math.min(1.5, Math.hypot(a._renderVX, a._renderVY) / Math.max(1, a.speed || 1)));
    const oldAnimRatio = Number(a._netAnimMoveRatio) || 0;
    const animFollow = 1 - Math.exp(-4.2 * dt);
    a._netAnimMoveRatio = oldAnimRatio + (measuredRatio - oldAnimRatio) * animFollow;
    a._netAnimPhase = (Number(a._netAnimPhase) || Number(a.tailPhase) || 0) +
      dt * (1.45 + a._netAnimMoveRatio * 5.2);
    a.tailPhase = a._netAnimPhase;

    const renderSpeed = Math.hypot(a._renderVX, a._renderVY);
    const oldVisual = Number(a._visualMoveSpeed) || 0;
    a._visualMoveSpeed = oldVisual + (renderSpeed - oldVisual) * (1 - Math.exp(-4.5 * dt));
    if (a._visualMoveSpeed > 0.3) a._visualMoveAt = now;
  }
}

function updateNetworkPetInterpolation(dt) {
  if (!net.room) return;
  for (const p of net.petVisuals.values()) {
    if (!p || p.dead || !Number.isFinite(p._netX) || !Number.isFinite(p._netY)) continue;

    // A ridden pet needs to stay exactly under its rider.
    if (p.ownerId === net.sessionId && player.riding === p) {
      p.x = player.x; p.y = player.y; p.angle = player.angle;
      p._renderVX = 0; p._renderVY = 0;
      continue;
    }

    const targetVX = Number(p._netVX) || 0;
    const targetVY = Number(p._netVY) || 0;
    const ownPet = p.ownerId === net.sessionId;

    // Smooth velocity itself, not only position. This is the important part for
    // following pets because the visual keeps moving between network patches.
    const velFollow = 1 - Math.exp(-(ownPet ? 11 : 9) * dt);
    p._renderVX = (Number(p._renderVX) || 0) + (targetVX - (Number(p._renderVX) || 0)) * velFollow;
    p._renderVY = (Number(p._renderVY) || 0) + (targetVY - (Number(p._renderVY) || 0)) * velFollow;

    p.x += p._renderVX * dt;
    p.y += p._renderVY * dt;

    const predict = ownPet ? 0.035 : 0.030;
    const authX = p._netX + targetVX * predict;
    const authY = p._netY + targetVY * predict;
    const dx = authX - p.x, dy = authY - p.y;
    const d = Math.hypot(dx, dy);

    if (d > 300) {
      p.x = p._netX; p.y = p._netY;
      p._renderVX = targetVX; p._renderVY = targetVY;
      p.angle = p._netAngle || 0;
      continue;
    }

    // Own pets correct a little quicker, but still gradually enough to avoid
    // rubber-band stepping while they follow the player.
    const correction = 1 - Math.exp(-(ownPet ? 8.5 : 6.5) * dt);
    p.x += dx * correction;
    p.y += dy * correction;

    let da = (p._netAngle || 0) - (p.angle || 0);
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const angleFollow = 1 - Math.exp(-12 * dt);
    p.angle = (p.angle || 0) + da * angleFollow;

    // Local continuous pet animation instead of server snapshot phase.
    const renderSpeed = Math.hypot(p._renderVX, p._renderVY);
    const measuredRatio = Math.max(0, Math.min(1.5, renderSpeed / Math.max(1, p.speed || 1)));
    const oldAnimRatio = Number(p._netAnimMoveRatio) || 0;
    const animFollow = 1 - Math.exp(-4.4 * dt);
    p._netAnimMoveRatio = oldAnimRatio + (measuredRatio - oldAnimRatio) * animFollow;
    p._netAnimPhase = (Number(p._netAnimPhase) || Number(p.tailPhase) || 0) +
      dt * (1.5 + p._netAnimMoveRatio * 5.4);
    p.tailPhase = p._netAnimPhase;

    const oldVisual = Number(p._visualMoveSpeed) || 0;
    p._visualMoveSpeed = oldVisual + (renderSpeed - oldVisual) * (1 - Math.exp(-4.8 * dt));
    if (p._visualMoveSpeed > 0.3) p._visualMoveAt = performance.now();
  }
}
function updateNetworkProjectileMotion(dt) {
  if (!net.room) return;
  for (const p of net.projectileVisuals.values()) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    p.x += (Number(p.vx) || 0) * dt;
    p.y += (Number(p.vy) || 0) * dt;
    p.life = Math.max(0, (Number(p.life) || 0) - dt);
  }
}

function applyNetworkWildlifeMovementCarry() {
  if (!net.room || player.dead) return;

  // The server sends authoritative animalPush messages. Patch-derived carry is
  // only a fallback if no push message arrived recently, preventing double-push
  // jitter when both a state patch and a push event describe the same movement.
  if (performance.now() - (net.lastAnimalPushAt || 0) < 220) {
    for (const a of net.animalVisuals.values()) if (a) a._carryPending = false;
    return;
  }

  let carried = false;
  for (const a of net.animalVisuals.values()) {
    if (!a || a.dead || !a._carryPending) continue;
    a._carryPending = false;

    // Running away always beats body carry. This keeps latency from making an
    // attacking animal feel like it has hooked the player into its body.
    if (localMoveEscapingAnimal(a)) continue;

    const dx = Number(a._moveDx) || 0;
    const dy = Number(a._moveDy) || 0;
    const moveLen = Math.hypot(dx, dy);
    if (moveLen < 0.001 || moveLen > 120) continue;

    const hit = deepestAnimalPhysicalOverlap(a, player.x, player.y, PLAYER_R * 0.82);
    if (!hit) continue;

    player.x = clamp(player.x + dx, PLAYER_R, WORLD_W - PLAYER_R);
    player.y = clamp(player.y + dy, PLAYER_R, WORLD_H - PLAYER_R);
    carried = true;
  }

  if (carried) resolveSolidCollisions();
}

function updateNetEnemyVisual(v, s, id) {
  const fresh = !v;
  if (!v) v = {};
  v.netId = id; v._netKind = "enemy";
  const sx = Number(s.x) || 0, sy = Number(s.y) || 0, sa = Number(s.angle) || 0;
  const now = performance.now();
  const oldX = Number.isFinite(v._netX) ? v._netX : sx;
  const oldY = Number.isFinite(v._netY) ? v._netY : sy;
  const patchDt = Math.max(0.025, Math.min(0.25, (now - (v._netPatchAt || now - 50)) / 1000));
  v._netPatchAt = now;
  v._netVX = (sx - oldX) / patchDt;
  v._netVY = (sy - oldY) / patchDt;
  v._netX = sx; v._netY = sy; v._netAngle = sa;

  if (fresh || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.hypot(sx-v.x,sy-v.y)>320) {
    v.x=sx; v.y=sy; v.angle=sa;
  }

  v.r = Number(s.r) || 17; v.speed = Number(s.speed) || 60; v.weapon = s.weapon || "Fist";
  v.dmg = Number(s.dmg) || 6; v.hp = Math.max(0, Number(s.hp) || 0); v.maxHp = Math.max(1, Number(s.maxHp) || 1);
  v.strong = !!s.strong; v.armed = !!s.armed; v.ranged = !!s.ranged; v.hue = s.hue || "#e0563f";
  v.hasGuard = !!s.hasGuard; v.guardPetId = s.guardPetId || ""; v.ridingPetId = s.ridingPetId || "";
  v.attackAnim = Number(s.attackAnim) || 0; v.flash = Number(s.flash) || 0; v.atkCd = Number(s.atkCd) || 0;
  v.wanderA = Number(s.wanderA) || 0; v.wanderT = Number(s.wanderT) || 0; v.strafeDir = Number(s.strafeDir) || 1; v.strafeT = Number(s.strafeT) || 0;
  v.dead = !!s.dead;
  return v;
}

function updateNetworkEnemyInterpolation(dt) {
  if (!net.room) return;
  for (const en of net.enemyVisuals.values()) {
    if (!en || en.dead || !Number.isFinite(en._netX) || !Number.isFinite(en._netY)) continue;
    if (!inView(en._netX, en._netY, 420)) {
      en.x=en._netX; en.y=en._netY; en.angle=en._netAngle||en.angle||0;
      continue;
    }
    const predict = 0.045;
    const tx = en._netX + (Number(en._netVX)||0) * predict;
    const ty = en._netY + (Number(en._netVY)||0) * predict;
    const dx = tx-en.x, dy=ty-en.y;
    const d = Math.hypot(dx,dy);
    if (d > 300) {
      en.x=en._netX; en.y=en._netY; en.angle=en._netAngle||0;
      continue;
    }
    const follow = 1-Math.exp(-17*dt);
    en.x += dx*follow;
    en.y += dy*follow;
    let da=(en._netAngle||0)-(en.angle||0);
    da=Math.atan2(Math.sin(da),Math.cos(da));
    en.angle=(en.angle||0)+da*follow;
  }
}

function syncNetworkFullWorld(force = false) {
  if (!net.room || !net.room.state) return false;
  const state = net.room.state;

  const own = state.players && typeof state.players.get === "function" ? state.players.get(net.sessionId) : null;
  if (own) {
    if (!net.initialPositionApplied || force) {
      player.x = Number(own.x) || player.x; player.y = Number(own.y) || player.y;
      net.initialPositionApplied = true;
    }

    // While an animal's moving body is carrying the player, the server owns
    // player position. This prevents local movement/input from visually
    // cancelling the carry on the very next frame.
    const animalCarryT = Math.max(0, Number(own.animalCarryT) || 0);
    if (animalCarryT > 0 && !localPlayerEscapingAnyAnimal()) {
      const sx = Number(own.x), sy = Number(own.y);
      if (Number.isFinite(sx)) player.x = sx;
      if (Number.isFinite(sy)) player.y = sy;
    }

    const newHp = Math.max(0, Number(own.health));
    const maxHp = Math.max(1, Number(own.maxHealth) || 100);
    if (Number.isFinite(newHp)) {
      const oldHp = Number(player.health) || maxHp;
      if (newHp < oldHp - 0.01 && !player.dead) {
        player.hurtFlash = 0.22; game.shake = 8; sfx.hurt();
        player._healthBarShownAt = performance.now();
      }
      if (newHp < maxHp - 0.01) player._healthBarShownAt = performance.now();
      else if (oldHp < maxHp - 0.01 && newHp >= maxHp - 0.01) player._healthBarHealedAt = performance.now();
      player.health = newHp; player.maxHealth = maxHp;
    }
    const serverGold = Number(own.gold);
    if (Number.isFinite(serverGold)) player.gold = Math.max(0, serverGold);
    if (!!own.dead && !player.dead) { player.dead = true; player.splitT = 0; if (!game.deathCamTarget && game.deathCamTargetId) game.deathCamTarget = resolveNetworkDeathCamTarget(game.deathCamTargetKind, game.deathCamTargetId); sfx.die(); }
    if (!own.dead && player.dead && !game.over) { player.dead = false; player.splitT = 0; }
  }

  const chestSeen = new Set();
  eachNetworkCollection("chests", (s, id) => {
    chestSeen.add(id);
    let v = net.chestVisuals.get(id);
    if (!v) { v = { netId:id }; net.chestVisuals.set(id, v); }
    v.x = Number(s.x)||0; v.y = Number(s.y)||0; v.r = Number(s.r)||18;
    v.hp = Math.max(0, Number(s.hp)||0); v.maxHp = Math.max(1, Number(s.maxHp)||4);
    v.opened = !!s.opened; v.pulse = Number(s.pulse)||0; v.shine = Number(s.shine)||0; v.chipSide = s.chipSide||"wood";
  });
  for (const id of Array.from(net.chestVisuals.keys())) if (!chestSeen.has(id)) net.chestVisuals.delete(id);
  chests = Array.from(net.chestVisuals.values());

  const animalSeen = new Set();
  eachNetworkCollection("animals", (s,id)=>{
    animalSeen.add(id);
    let v = net.animalVisuals.get(id);
    v = updateNetAnimalVisual(v,s,id,false);
    net.animalVisuals.set(id,v);
  });
  for (const id of Array.from(net.animalVisuals.keys())) if (!animalSeen.has(id)) net.animalVisuals.delete(id);
  animals = Array.from(net.animalVisuals.values());

  const petSeen = new Set(), ownPets = [], remotePets = [];
  eachNetworkCollection("pets", (s,id)=>{
    petSeen.add(id);
    let v = net.petVisuals.get(id);
    v = updateNetAnimalVisual(v,s,id,true);
    net.petVisuals.set(id,v);
    if (v.ownerId === net.sessionId) ownPets.push(v); else remotePets.push(v);
  });
  for (const id of Array.from(net.petVisuals.keys())) if (!petSeen.has(id)) net.petVisuals.delete(id);
  player.pets = ownPets.filter(p=>!p.dead);
  net.remotePetVisuals.clear();
  for (const p of remotePets) if (!p.dead) net.remotePetVisuals.set(p.netId,p);
  if (own && own.ridingPetId) player.riding = net.petVisuals.get(own.ridingPetId) || null;
  else if (player.riding && !net.petVisuals.has(player.riding.netId)) player.riding = null;

  const enemySeen = new Set();
  eachNetworkCollection("enemies", (s,id)=>{ enemySeen.add(id); let v=net.enemyVisuals.get(id); v=updateNetEnemyVisual(v,s,id); net.enemyVisuals.set(id,v); });
  for (const id of Array.from(net.enemyVisuals.keys())) if (!enemySeen.has(id)) net.enemyVisuals.delete(id);
  enemies = Array.from(net.enemyVisuals.values());

  const wallSeen = new Set();
  eachNetworkCollection("walls",(s,id)=>{wallSeen.add(id);let v=net.wallVisuals.get(id)||{netId:id};v.x=Number(s.x)||0;v.y=Number(s.y)||0;v.r=Number(s.r)||20;v.ttl=Number(s.ttl);if(!Number.isFinite(v.ttl))v.ttl=-1;v.ownerId=s.ownerId||"";v.hp=Math.max(0,Number(s.hp)||0);v.maxHp=Math.max(1,Number(s.maxHp)||1);v.kind=s.kind||"wood";v.spiked=!!s.spiked;v.spikeDmg=Number(s.spikeDmg)||0;v.sourcePetId=s.sourcePetId||"";net.wallVisuals.set(id,v);});
  for(const id of Array.from(net.wallVisuals.keys()))if(!wallSeen.has(id))net.wallVisuals.delete(id); walls=Array.from(net.wallVisuals.values());

  const towerSeen = new Set();
  eachNetworkCollection("towers",(s,id)=>{towerSeen.add(id);let v=net.towerVisuals.get(id)||{netId:id};v.x=Number(s.x)||0;v.y=Number(s.y)||0;v.cd=Number(s.cd)||0;v.ownerId=s.ownerId||"";net.towerVisuals.set(id,v);});
  for(const id of Array.from(net.towerVisuals.keys()))if(!towerSeen.has(id))net.towerVisuals.delete(id); towers=Array.from(net.towerVisuals.values());

  const projSeen = new Set(), normal=[], blasts=[];
  eachNetworkCollection("projectiles",(s,id)=>{
    projSeen.add(id);let v=net.projectileVisuals.get(id)||{netId:id};
    const sx=Number(s.x)||0, sy=Number(s.y)||0;
    const serverMoved=!Number.isFinite(v._serverX)||!Number.isFinite(v._serverY)||Math.abs(sx-v._serverX)>.001||Math.abs(sy-v._serverY)>.001;
    if(serverMoved){v.x=sx;v.y=sy;v._serverX=sx;v._serverY=sy;}
    v.vx=Number(s.vx)||0;v.vy=Number(s.vy)||0;v.life=Number(s.life)||0;v.r=Number(s.r)||5;
    v.hostile=!!s.hostile;v.kind=s.kind||"arrow";v.color=s.color||"#7ec0ee";v.dmg=Number(s.dmg)||0;v.ownerId=s.ownerId||"";v.petBlast=!!s.petBlast;v.knock=Number(s.knock)||0;
    net.projectileVisuals.set(id,v); (v.petBlast?blasts:normal).push(v);
  });
  for(const id of Array.from(net.projectileVisuals.keys()))if(!projSeen.has(id))net.projectileVisuals.delete(id);
  projectiles=normal; petBlasts=blasts;

  const phaseIdx = Number(state.dayPhase);
  if (Number.isFinite(phaseIdx)) {
    if (net.lastPhaseIdx !== phaseIdx) {
      net.lastPhaseIdx = phaseIdx;
      const phase = TIME_PHASES[phaseIdx] || TIME_PHASES[0];
      const tb = document.getElementById("timeBanner");
      if (tb) { tb.textContent = phase.name + (phase.name === "Day" ? ` ${Number(state.dayCount)||1}` : ""); tb.style.background = phase.color + "cc"; }
    }
    game.phaseIdx = phaseIdx;
  }
  game.phaseTimer = Number(state.phaseTimer) || game.phaseTimer;
  game.dayCount = Number(state.dayCount) || game.dayCount;
  game.wave = Number(state.wave) || 0;
  if (Number.isFinite(Number(state.worldTime))) game.time = Number(state.worldTime);

  if (force || net.lastStaticChestCount !== chests.length) {
    net.lastStaticChestCount = chests.length;
    rebuildStaticCollisionGrid();
  }
  return true;
}

function applyWorldReward(data={}) {
  const reward = { kind:data.kind, resource:data.resource, species:data.species, amount:Math.max(0,Number(data.amount)||0) };
  if (!reward.amount) return;
  if (reward.kind === "resource" && ["wood","stone","gold","berries"].includes(reward.resource)) {
    if (reward.resource === "gold" && Number.isFinite(Number(data.balance))) {
      player.gold = Math.max(0, Number(data.balance));
    } else {
      player[reward.resource] = (player[reward.resource]||0) + reward.amount;
    }
    if (data.x != null) floatText(Number(data.x), Number(data.y)||player.y, `+${reward.amount} ${reward.resource}`, "#efe6d2");
  } else if (reward.kind === "cards" && PET_TYPES[reward.species]) {
    if (!meta.speciesCards) meta.speciesCards = {};
    meta.speciesCards[reward.species] = (meta.speciesCards[reward.species]||0) + reward.amount;
    saveMeta(); buildCardInventory();
    banner(`+${reward.amount} ${PET_TYPES[reward.species].name} Card${reward.amount===1?"":"s"}!`);
  } else if (reward.kind === "cubits") {
    meta.servs = (meta.servs||0) + reward.amount; saveMeta();
  }
  if (data.kill) game.kills++;
  syncHud(); syncHotbar();
}
function applyChestNetworkReward(data={}) {
  const reward = data.reward;
  if (!reward) return;
  awardChestReward(reward); saveMeta(); syncHud(); syncHotbar(); buildCardInventory(); showLootPopup([reward]);
  const c=net.chestVisuals.get(data.id); if(c){spark(c.x,c.y-6,"#ffd85f",18,130);sfx.chestOpen();}
}
function applyTameNetworkResult(data={}) {
  if (data.pending) { game.tamePending = true; banner(`Taming…${Number.isFinite(Number(data.chance)) ? " "+Math.round(Number(data.chance)*100)+"% chance" : ""}`); return; }
  game.tamePending = false;
  if (data.reason === "max") { banner("Max 4 pets!", true); return; }
  if (data.success) { if (sfx.tame) sfx.tame(); banner(`Tamed ${PET_TYPES[data.type]?.name||"pet"}!`); }
  else if (data.type) { banner(`${PET_TYPES[data.type]?.name||"Animal"} resisted taming`, true); }
}
function applyWorldFx(data={}) {
  const x=Number(data.x)||0,y=Number(data.y)||0;
  if(data.kind==="hit"){spark(x,y,data.color||"#f2836a",net.room?3:5,80);if(data.text)floatText(x,y-24,String(data.text),data.color||"#f2836a");}
  else if(data.kind==="chest"){spark(x,y,"#ffd85f",net.room?9:14,120);}
}
function applyAbilityEvent(data={}) {
  const elem=data.elem||""; const x=Number(data.x)||0,y=Number(data.y)||0,r=Number(data.r)||20;
  const map={Stone:"stone",Sound:"sound",Fire:"fire",Lightning:"lightning",Ice:"ice",Water:"water",Plant:"plant",Wind:"wind",Poison:"poison",Light:"light",Earth:"earth",Combat:"cast"};
  const type=map[elem]||"cast"; abilityFx.push({type,x,y,life:0.7,maxLife:0.7,r:r+32,baseR:r+32,color:ELEM_GLOW[elem]||"#ffffff",phase:0,tick:0});
  spark(x,y,ELEM_GLOW[elem]||"#ffffff",10,100); if(data.ownerId===net.sessionId)sfx.ability();
}
function applyPhaseNetworkEvent(data={}) {
  const phase=TIME_PHASES[Number(data.phase)||0]; if(!phase)return;
  if(phase.name==="Night")sfx.night();
  if(phase.name==="Midnight")banner("Midnight — stronger triangles appear!");
}
function drawRemotePets(){ for(const p of net.remotePetVisuals.values()) if(inView(p.x,p.y,60)) drawAnimal(p); }

function applyNetworkHarvestReward(data = {}) {
  const kind = data.kind;
  const amount = Math.max(0, Number(data.amount) || 0);
  const target = findNetHarvestTarget(data.id);
  const tx = target ? target.x : player.x;
  const ty = target ? target.y : player.y;

  if (kind === "wood" || kind === "stone" || kind === "berries" || kind === "gold") {
    if (amount > 0) {
      if (kind === "gold" && Number.isFinite(Number(data.balance))) {
        player.gold = Math.max(0, Number(data.balance));
      } else {
        player[kind] = (player[kind] || 0) + amount;
      }
      const col = kind === "wood" ? "#c99a5b" : kind === "stone" ? "#a9b3bd" : kind === "berries" ? "#f283a6" : "#f2c94c";
      const label = kind === "gold" && data.pure ? "+" + amount + " PURE GOLD" : "+" + amount + (kind === "gold" ? " gold" : kind === "berries" ? " berries" : "");
      floatText(tx, ty - 24, label, col);
      if (kind === "gold") spark(tx, ty, data.pure ? "#fff19a" : "#ffd23f", data.pure ? 12 : 7, data.pure ? 135 : 90);
    } else if (kind === "gold" && data.tiny) {
      floatText(tx, ty - 24, "tiny chip", "#d8bd65");
      spark(tx, ty, "#d8bd65", 3, 45);
    } else if ((kind === "wood" || kind === "stone") && data.tiny) {
      floatText(tx, ty - 20, "tiny chip", "#b7aa98");
    }
    syncHud();
    syncHotbar();
  }
}

function ensureNetworkStarterPet() {
  if (!net.room || !game.startPet || !PET_TYPES[game.startPet]) return;
  // First resync what the server already has. If the initial join patch arrived
  // late, this is enough. Otherwise ask the server for an idempotent repair.
  syncNetworkFullWorld(true);
  const hasStarter = player.pets.some(p => p && !p.dead && p.ownerId === net.sessionId && p.type === game.startPet);
  if (hasStarter) return;
  try {
    net.room.send("ensureStarterPet", {
      type: game.startPet,
      stage: starterStageFor(game.startPet)
    });
  } catch (_) {}
}

async function connectMultiplayer() {
  if (!net.enabled) return false;
  if (net.room) return true;
  if (net.connecting) return false;
  net.connecting = true;
  setNetStatus("Connecting…");
  try {
    if (!window.Colyseus || !window.Colyseus.Client) {
      throw new Error("Colyseus client did not load");
    }
    const serverUrl = saveMultiplayerServerInput();
    const client = new window.Colyseus.Client(serverUrl);
    const room = await client.joinOrCreate("world", {
      username: meta.username || "Cube",
      color: meta.color || COLORS[0],
      startPet: game.startPet || "",
      startPetStage: game.startPet ? starterStageFor(game.startPet) : "baby",
      petStatUpgrades: JSON.stringify(meta.petStatUpgrades || {}),
    });
    net.client = client;
    net.room = room;
    net.sessionId = room.sessionId;
    net.sendAccum = 0;
    net.fullSyncAccum = 0;
    net.remoteVisuals.clear();
    net.resourceVisuals.clear(); net.goldVisuals.clear(); net.chestVisuals.clear(); net.animalVisuals.clear();
    net.petVisuals.clear(); net.remotePetVisuals.clear(); net.enemyVisuals.clear(); net.wallVisuals.clear();
    net.towerVisuals.clear(); net.projectileVisuals.clear(); net.initialPositionApplied = false; net.lastPhaseIdx = -1;
    room.onMessage("resourceReward", applyNetworkHarvestReward);
    room.onMessage("worldReward", applyWorldReward);
    room.onMessage("chestReward", applyChestNetworkReward);
    room.onMessage("tameResult", applyTameNetworkResult);
    room.onMessage("runShopResult", (data={})=>{
      if(!data.success){banner(data.reason==="gold"?"Not enough gold":"Shop purchase failed",true);return;}
      applyRunShopPurchase(String(data.id||""),data.gold);
    });
    room.onMessage("worldFx", applyWorldFx);
    room.onMessage("worldFxBatch", (items = []) => {
      if (!Array.isArray(items)) return;
      // Cosmetic hit effects are deliberately capped per network batch. Combat
      // state still arrives fully; this only prevents particle/text bursts from
      // stalling a frame when several players and pets attack at once.
      let shown = 0;
      for (const fx of items) {
        if (shown >= 20) break;
        const x = Number(fx && fx.x), y = Number(fx && fx.y);
        if (Number.isFinite(x) && Number.isFinite(y) && !inView(x, y, 220)) continue;
        applyWorldFx(fx || {});
        shown++;
      }
    });
    room.onMessage("abilityEvent", applyAbilityEvent);
    room.onMessage("phaseEvent", applyPhaseNetworkEvent);
    room.onMessage("playerHit", (data = {}) => {
      // Apply the server-authoritative health immediately so bites feel instant,
      // then the normal room-state patch keeps everything synchronized.
      const hp = Number(data.health);
      const maxHp = Number(data.maxHealth);
      if (Number.isFinite(maxHp) && maxHp > 0) player.maxHealth = maxHp;
      if (Number.isFinite(hp)) player.health = clamp(hp, 0, player.maxHealth);
      const hitDmg = Math.max(0, Number(data.dmg) || 0);
      if (hitDmg > 0) floatText(player.x, player.y - 34, `-${Math.ceil(hitDmg)}`, "#ff8a72");
      if (!player.dead) {
        player.hurtFlash = Math.max(player.hurtFlash || 0, 0.22);
        const nowFx = performance.now();
        if (nowFx - (net.lastHurtFxAt || 0) > 105) {
          net.lastHurtFxAt = nowFx;
          game.shake = Math.max(game.shake || 0, 7);
          sfx.hurt();
        }
      }
      if (player.health <= 0 && !player.dead) {
        player.health = 0;
        player.dead = true;
        player.splitT = 0;
        const attackerKind = String(data.attackerKind || "");
        const attackerId = String(data.attackerId || "");
        const killer = resolveNetworkDeathCamTarget(attackerKind, attackerId);
        setKilledBy(player, killer);
        beginDeathCamera(killer, attackerKind, attackerId);
        sfx.die();
      }
    });
    room.onMessage("spectateKill", (data = {}) => {
      const victimKind = String(data.victimKind || "");
      const victimId = String(data.victimId || "");
      const killerKind = String(data.killerKind || "");
      const killerId = String(data.killerId || "");

      let victim = resolveNetworkDeathCamTarget(victimKind, victimId);
      // The visual may already have been removed from a map, but the camera can
      // still hold its object reference.
      if (!victim && game.deathCamTargetId === victimId) victim = game.deathCamTarget;

      const killer = resolveNetworkDeathCamTarget(killerKind, killerId);
      if (victim && killer) setKilledBy(victim, killer);

      if (player.dead && game.deathCamTargetId === victimId && killer) {
        setDeathCameraTarget(killer, killerKind, killerId);
      }
    });
    room.onMessage("animalPush", (data = {}) => {
      // Pure movement collision. The authoritative push is applied unless the
      // player is actively running away from that animal.
      if (player.dead) return;
      net.lastAnimalPushAt = performance.now();

      const animalId = String(data.animalId || "");
      const a = animalId ? net.animalVisuals.get(animalId) : null;
      if (a) {
        a._carryPending = false;
        if (localMoveEscapingAnimal(a)) return;
      }

      const sx = Number(data.x), sy = Number(data.y);
      const dx = Number(data.dx), dy = Number(data.dy);
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        player.x = clamp(sx, PLAYER_R, WORLD_W - PLAYER_R);
        player.y = clamp(sy, PLAYER_R, WORLD_H - PLAYER_R);
      } else if (Number.isFinite(dx) && Number.isFinite(dy)) {
        player.x = clamp(player.x + dx, PLAYER_R, WORLD_W - PLAYER_R);
        player.y = clamp(player.y + dy, PLAYER_R, WORLD_H - PLAYER_R);
      }
    });
    room.onMessage("petGrew", d => banner(`${PET_TYPES[d.type]?.name||"Pet"} became ${stageDisplayName(d.stage)}!`));
    room.onMessage("petReleased", d => banner(`${d.name||"Pet"} was released`));
    room.onMessage("starterPetEnsured", () => {
      setTimeout(() => syncNetworkFullWorld(true), 60);
    });
    room.onMessage("chat", receiveChatMessage);
    const syncedResources = syncNetworkWorldResources();
    if (!syncedResources) setTimeout(() => syncNetworkWorldResources(), 120);
    syncNetworkFullWorld(true);
    setTimeout(() => syncNetworkFullWorld(true), 100);
    setTimeout(ensureNetworkStarterPet, 240);
    setTimeout(ensureNetworkStarterPet, 900);
    setNetStatus("Online • shared world • PvP", "good");

    room.onError((code, message) => {
      console.warn("Multiplayer error", code, message);
      setNetStatus("Server error", "bad");
    });
    room.onLeave(() => {
      net.room = null;
      net.client = null;
      net.sessionId = null;
      net.remoteVisuals.clear();
      setNetStatus(net.enabled ? "Disconnected" : "Offline", net.enabled ? "bad" : "");
    });
    return true;
  } catch (err) {
    console.warn("Multiplayer connection failed", err);
    setNetStatus("No server", "bad");
    net.room = null;
    net.client = null;
    net.sessionId = null;
    return false;
  } finally {
    net.connecting = false;
  }
}

function disconnectMultiplayer() {
  const room = net.room;
  net.room = null;
  net.client = null;
  net.sessionId = null;
  net.remoteVisuals.clear();
  net.resourceVisuals.clear(); net.goldVisuals.clear(); net.chestVisuals.clear(); net.animalVisuals.clear();
  net.petVisuals.clear(); net.remotePetVisuals.clear(); net.enemyVisuals.clear(); net.wallVisuals.clear();
  net.towerVisuals.clear(); net.projectileVisuals.clear(); net.initialPositionApplied = false; net.fullSyncAccum = 0;
  if (room) {
    try { room.leave(true); } catch (e) {}
  }
  setNetStatus(net.enabled ? "Ready" : "Offline");
}

function currentMoveVector() {
  let x = 0, y = 0;
  if (keys.has("a") || keys.has("arrowleft")) x -= 1;
  if (keys.has("d") || keys.has("arrowright")) x += 1;
  if (keys.has("w") || keys.has("arrowup")) y -= 1;
  if (keys.has("s") || keys.has("arrowdown")) y += 1;
  if (mobileMode && joyActive) { x += joyDX; y += joyDY; }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

function localMoveEscapingAnimal(a) {
  if (!a) return false;
  const mv = currentMoveVector();
  const ml = Math.hypot(mv.x, mv.y);
  if (ml < 0.08) return false;
  let ax = player.x - a.x, ay = player.y - a.y;
  const al = Math.hypot(ax, ay) || 1;
  ax /= al; ay /= al;
  return (mv.x / ml) * ax + (mv.y / ml) * ay > 0.02;
}

function localPlayerEscapingAnyAnimal() {
  const mv = currentMoveVector();
  if (Math.hypot(mv.x, mv.y) < 0.08) return false;
  const list = net.room ? net.animalVisuals.values() : animals;
  for (const a of list) {
    if (!a || a.dead) continue;
    const rr = (a.r || 18) * 2.25 + PLAYER_R + 34;
    const dx = player.x - a.x, dy = player.y - a.y;
    if (dx * dx + dy * dy > rr * rr) continue;
    const hit = deepestAnimalPhysicalOverlap(a, player.x, player.y, PLAYER_R * 0.82);
    if (hit && localMoveEscapingAnimal(a)) return true;
  }
  return false;
}

function sendNetworkInput(dt) {
  if (!net.room || !game.started || game.over) return;
  net.sendAccum += dt;
  if (net.sendAccum < 1 / 20) return;
  net.sendAccum = 0;
  const mv = currentMoveVector();
  try {
    net.room.send("input", {
      moveX: mv.x,
      moveY: mv.y,
      moving: Math.hypot(mv.x, mv.y) > 0.05,
      x: player.x,
      y: player.y,
      angle: player.angle,
      color: player.color,
      tool: player.heldSpecial || player.tool || "Fist",
      ridingPetId: player.riding && player.riding.netId ? player.riding.netId : "",
      attacking: !!mouse.down,
    });
  } catch (e) {}
}

function updateRemotePlayers(dt) {
  if (!net.room) return;
  const seen = new Set();
  eachNetworkPlayer((p, id) => {
    if (!p || id === net.sessionId) return;
    seen.add(id);
    let v = net.remoteVisuals.get(id);
    if (!v) {
      v = {
        id,
        netId: id,
        _netKind: "player",
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        angle: Number(p.angle) || 0,
        username: p.username || "Cube",
        color: p.color || "#3fa7ff",
        health: Number.isFinite(Number(p.health)) ? Number(p.health) : 100,
        maxHealth: Number.isFinite(Number(p.maxHealth)) ? Number(p.maxHealth) : 100,
        tool: p.tool || "Fist",
        dead: !!p.dead,
        moving: !!p.moving,
        ridingPetId: String(p.ridingPetId || ""),
        walkPhase: Math.random() * TAU,
      };
      net.remoteVisuals.set(id, v);
    }
    const sx = Number(p.x) || 0, sy = Number(p.y) || 0;
    const now = performance.now();
    const changed = !Number.isFinite(v._netX) || !Number.isFinite(v._netY) ||
      Math.abs(sx-v._netX) > 0.001 || Math.abs(sy-v._netY) > 0.001;
    if (changed) {
      const oldX = Number.isFinite(v._netX) ? v._netX : sx;
      const oldY = Number.isFinite(v._netY) ? v._netY : sy;
      const patchDt = Math.max(0.025, Math.min(0.25, (now-(v._netPatchAt||now-50))/1000));
      v._netPatchAt=now;
      v._netVX=(sx-oldX)/patchDt;
      v._netVY=(sy-oldY)/patchDt;
      v._netX=sx; v._netY=sy;
    }
    v._netAngle=Number(p.angle)||0;

    const predict = 0.045;
    const tx=(v._netX ?? sx)+(Number(v._netVX)||0)*predict;
    const ty=(v._netY ?? sy)+(Number(v._netVY)||0)*predict;
    const d = Math.hypot(tx - v.x, ty - v.y);
    const follow = 1 - Math.exp(-18 * dt);
    if (d > 300) { v.x = sx; v.y = sy; }
    else { v.x += (tx - v.x) * follow; v.y += (ty - v.y) * follow; }
    let da = (v._netAngle || 0) - v.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    v.angle += da * follow;
    v.username = p.username || "Cube";
    v.color = p.color || "#3fa7ff";
    v.health = Number.isFinite(Number(p.health)) ? Number(p.health) : 100;
    v.maxHealth = Number.isFinite(Number(p.maxHealth)) ? Number(p.maxHealth) : 100;
    v.tool = p.tool || "Fist";
    v.dead = !!p.dead;
    v.moving = !!p.moving;
    v.ridingPetId = String(p.ridingPetId || "");
    if (v.moving) v.walkPhase = (v.walkPhase || 0) + dt * 12.0;
  });
  for (const id of Array.from(net.remoteVisuals.keys())) {
    if (!seen.has(id)) net.remoteVisuals.delete(id);
  }
}

function drawRemotePlayer(v) {
  // Dead multiplayer players stay in network state for spectator/kill-chain logic,
  // but their body is not drawn at all.
  if (!v || v.dead || (Number(v.health) || 0) <= 0 || !inView(v.x, v.y, 90)) return;

  const moving = !!v.moving;
  const phase = moving ? (v.walkPhase || game.time * 12) : 0;
  const bob = moving ? Math.sin(phase) * 2.0 : 0;
  const armWalk = moving ? Math.sin(phase) * 3.2 : 0;

  ctx.save();
  ctx.translate(v.x, v.y + bob);
  if (v.ridingPetId) ctx.translate(0, -12);
  ctx.rotate(v.angle || 0);

  const body = v.color || "#3fa7ff";
  const arm = shadeColor(body, -30);
  const holding = v.tool || "Fist";

  // Use the same arm/tool geometry as the local player.
  if (holding === "Fist") {
    drawArm(1, 0, arm, null, false, -armWalk);
    drawArm(-1, 0, arm, null, false, armWalk);
  } else {
    drawTwoHandWeapon(holding, arm, 0, armWalk);
  }

  // Full rounded cube body.
  ctx.fillStyle = body;
  ctx.strokeStyle = shadeColor(body, -50);
  ctx.lineWidth = 3.5;
  roundRect(-16, -16, 32, 32, 7);
  ctx.fill();
  ctx.stroke();

  // Full eyes, including the white highlights that the old multiplayer
  // renderer was missing.
  ctx.fillStyle = "#12202b";
  circ(9, -6, 3.6);
  circ(9, 6, 3.6);
  ctx.fillStyle = "#fff";
  circ(10, -7, 1.1);
  circ(10, 5, 1.1);

  ctx.restore();

  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "900 15px -apple-system, sans-serif";
  const nameY = v.y - (v.ridingPetId ? 46 : 35);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0,0,0,0.82)";
  ctx.strokeText(v.username || "Cube", v.x, nameY);
  ctx.fillStyle = "#fff7df";
  ctx.fillText(v.username || "Cube", v.x, nameY);

  const maxHp = Math.max(1, Number(v.maxHealth) || 100);
  const hp = clamp((Number(v.health) || 0) / maxHp, 0, 1);
  if (hp < 0.999) {
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    roundRect(v.x - 25, v.y - 27, 50, 6, 2);
    ctx.fill();
    ctx.fillStyle = "#f2836a";
    roundRect(v.x - 24, v.y - 26, 48 * hp, 4, 1);
    ctx.fill();
  }
  ctx.restore();
}

function drawRemotePlayers() {
  for (const v of net.remoteVisuals.values()) drawRemotePlayer(v);
}

// ---------- input ----------
const keys = new Set();
const mouse = { sx: W / 2, sy: H / 2, down: false, rdown: false };
let mobileMode = false;
let joyActive = false, joyDX = 0, joyDY = 0, joyRawDX = 0, joyRawDY = 0, joyTouchId = null;

function gameplayKeyboardActive() {
  return !!(game.started && !game.over);
}
function textEntryFocused() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = String(active.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || !!active.isContentEditable;
}

window.addEventListener("keydown", e => {
  const ci = document.getElementById("chatInput");
  if (ci && document.activeElement === ci) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); sendChatMessage(); }
    else if (e.key === "Escape") { e.preventDefault(); setChatOpen(false); }
    return;
  }

  // No gameplay shortcuts on the home screen, death screen, or before a run.
  // Text fields (for example pet rename) also consume their own keystrokes.
  if (!gameplayKeyboardActive() || textEntryFocused()) return;

  if (e.key === "Enter") {
    e.preventDefault();
    setChatOpen(true);
    return;
  }

  if (["1","2","3","4","5","6","7","8","9","0"].includes(e.key)) handleHotkey(e.key);
  if (e.key.toLowerCase() === "c") toggleCraft();
  if (e.key.toLowerCase() === "e") toggleInv();
  if (e.key.toLowerCase() === "t") tryTameNearby();
  if (e.key.toLowerCase() === "g") commandPets();
  if (e.key.toLowerCase() === "b") selectBerry();
  if (e.key.toLowerCase() === "p") toggleRunShop();

  // Movement / attack / ride keys are also recorded only during active gameplay.
  keys.add(e.key.toLowerCase());
});
window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
canvas.addEventListener("mousemove", e => { mouse.sx = e.clientX; mouse.sy = e.clientY; });
canvas.addEventListener("mousedown", e => {
  if (e.button === 0) mouse.down = true;
  if (e.button === 2) {
    mouse.rdown = true;
    const wx = e.clientX + game.camX;
    const wy = e.clientY + game.camY;
    const clickedAnimal = animalUnderWorldPoint(wx, wy);
    if (clickedAnimal && focusAllPetsOnAnimal(clickedAnimal)) {
      e.preventDefault();
      return;
    }
    fireBow();
  }
});
window.addEventListener("mouseup", e => {
  if (e.button === 0) mouse.down = false;
  if (e.button === 2) mouse.rdown = false;
});
canvas.addEventListener("contextmenu", e => e.preventDefault());

// mobile joy
const joyBase = document.getElementById("joyBase");
const joyKnob = document.getElementById("joyKnob");

function mobileTouchById(list, id) {
  if (!list) return null;
  for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
  return null;
}
function joySetRawFromTouch(t) {
  if (!t) return;
  const rect = joyBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let dx = t.clientX - cx, dy = t.clientY - cy;
  const max = Math.max(34, rect.width * 0.34);
  const len = Math.hypot(dx, dy) || 1;
  if (len > max) { dx = dx / len * max; dy = dy / len * max; }

  // Small deadzone prevents tiny thumb movements from making the player jitter.
  let nx = dx / max, ny = dy / max;
  const mag = Math.hypot(nx, ny);
  const dead = 0.10;
  if (mag <= dead) {
    nx = 0; ny = 0;
  } else {
    const scaled = (mag - dead) / (1 - dead);
    nx = nx / mag * scaled;
    ny = ny / mag * scaled;
  }

  joyRawDX = nx; joyRawDY = ny;
  joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}
function joyStart(e) {
  if (!game.started || game.over) return;
  e.preventDefault();
  const t = (e.changedTouches && e.changedTouches[0]) || (e.targetTouches && e.targetTouches[0]);
  if (!t) return;
  joyTouchId = t.identifier;
  joyActive = true;
  joySetRawFromTouch(t);
}
function joyMove(e) {
  if (!joyActive) return;
  e.preventDefault();
  const t = mobileTouchById(e.touches, joyTouchId) || mobileTouchById(e.targetTouches, joyTouchId);
  if (t) joySetRawFromTouch(t);
}
function joyEnd(e) {
  if (e && joyTouchId != null) {
    const stillThere = mobileTouchById(e.touches, joyTouchId);
    if (stillThere) return;
  }
  joyActive = false;
  joyTouchId = null;
  joyRawDX = 0; joyRawDY = 0;
  joyKnob.style.transform = "translate(-50%,-50%)";
}
function updateMobileInput(dt) {
  // Frame-rate independent smoothing keeps analog motion stable even when touch
  // events arrive irregularly on phones.
  const targetX = joyActive ? joyRawDX : 0;
  const targetY = joyActive ? joyRawDY : 0;
  const follow = 1 - Math.exp(-18 * Math.max(0, dt));
  joyDX += (targetX - joyDX) * follow;
  joyDY += (targetY - joyDY) * follow;
  if (!joyActive && Math.hypot(joyDX, joyDY) < 0.003) { joyDX = 0; joyDY = 0; }
}

joyBase.addEventListener("touchstart", joyStart, { passive: false });
joyBase.addEventListener("touchmove", joyMove, { passive: false });
joyBase.addEventListener("touchend", joyEnd, { passive: false });
joyBase.addEventListener("touchcancel", joyEnd, { passive: false });

const mobileAttackBtn = document.getElementById("mAttack");
const mobileShootBtn = document.getElementById("mShoot");
const mobileCraftBtn = document.getElementById("mCraft");

function mobileAttackStart(e) {
  if (!game.started || game.over) return;
  e.preventDefault();
  mouse.down = true;
}
function mobileAttackEnd(e) {
  if (e) e.preventDefault();
  mouse.down = false;
}
mobileAttackBtn.addEventListener("touchstart", mobileAttackStart, { passive: false });
mobileAttackBtn.addEventListener("touchend", mobileAttackEnd, { passive: false });
mobileAttackBtn.addEventListener("touchcancel", mobileAttackEnd, { passive: false });

mobileShootBtn.addEventListener("touchstart", e => {
  if (!game.started || game.over) return;
  e.preventDefault();
  fireBow();
}, { passive: false });

mobileCraftBtn.addEventListener("touchstart", e => {
  if (!game.started || game.over) return;
  e.preventDefault();
  toggleCraft();
}, { passive: false });

// If the browser interrupts touches (app switch, notification shade, etc.), never
// leave movement or attack stuck on.
window.addEventListener("blur", () => {
  mouse.down = false;
  joyActive = false; joyTouchId = null;
  joyRawDX = joyRawDY = joyDX = joyDY = 0;
  if (joyKnob) joyKnob.style.transform = "translate(-50%,-50%)";
});

// ---------- audio ----------
let actx = null;
function beep(freq, dur, type, vol) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type || "sine"; o.frequency.value = freq;
    g.gain.value = vol == null ? 0.05 : vol;
    o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch (e) {}
}
function noiseBurst(dur = 0.08, vol = 0.035, cutoff = 900) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const frames = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, frames, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = actx.createBufferSource();
    const filter = actx.createBiquadFilter();
    const gain = actx.createGain();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(filter); filter.connect(gain); gain.connect(actx.destination);
    src.start();
  } catch (e) {}
}
function impactNoise({dur=0.07, vol=0.05, low=180, high=2200, q=0.7, crack=0.0, delay=0} = {}) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime + delay;
    const frames = Math.max(1, Math.floor(actx.sampleRate * dur));
    const buf = actx.createBuffer(1, frames, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const n = Math.random() * 2 - 1;
      const env = Math.pow(1 - i / frames, 2.6);
      const click = i < 14 ? (1 - i / 14) * crack * (Math.random() * 2 - 1) : 0;
      data[i] = n * env + click;
    }
    const src = actx.createBufferSource();
    const hp = actx.createBiquadFilter();
    const lp = actx.createBiquadFilter();
    const gain = actx.createGain();
    hp.type = "highpass"; hp.frequency.value = low; hp.Q.value = q;
    lp.type = "lowpass"; lp.frequency.value = high; lp.Q.value = q;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.buffer = buf;
    src.connect(hp); hp.connect(lp); lp.connect(gain); gain.connect(actx.destination);
    src.start(t0);
  } catch (e) {}
}
const sfx = {
  hit: () => beep(180, 0.08, "square", 0.05),
  chop: () => beep(340, 0.06, "triangle", 0.04),
  treeHit: () => {
    impactNoise({dur:0.105, vol:0.082, low:65, high:820, q:0.45, crack:0.72});
    impactNoise({dur:0.05, vol:0.02, low:260, high:1500, q:0.7, crack:0.5, delay:0.01});
  },
  logHit: () => {
    impactNoise({dur:0.072, vol:0.07, low:120, high:1700, q:0.52, crack:0.95});
    impactNoise({dur:0.03, vol:0.022, low:800, high:2600, q:0.72, crack:0.95, delay:0.004});
  },
  bushHit: () => {
    impactNoise({dur:0.06, vol:0.042, low:380, high:3600, q:0.55, crack:0.18});
    impactNoise({dur:0.032, vol:0.018, low:1200, high:5200, q:0.95, crack:0.08, delay:0.007});
  },
  stoneHit: () => {
    impactNoise({dur:0.055, vol:0.085, low:420, high:4200, q:1.1, crack:1.25});
    impactNoise({dur:0.03, vol:0.045, low:1500, high:6500, q:1.5, crack:1.1, delay:0.006});
  },
  goldHit: () => {
    impactNoise({dur:0.065, vol:0.065, low:300, high:5000, q:1.0, crack:1.15});
    impactNoise({dur:0.09, vol:0.028, low:900, high:7200, q:2.2, crack:0.25, delay:0.008});
  },
  chestHit: () => {
    impactNoise({dur:0.072, vol:0.07, low:120, high:1700, q:0.52, crack:0.95});
    impactNoise({dur:0.03, vol:0.022, low:800, high:2600, q:0.72, crack:0.95, delay:0.004});
  },
  chestOpen: () => {
    impactNoise({dur:0.09, vol:0.075, low:110, high:1800, q:0.55, crack:1.15});
    impactNoise({dur:0.04, vol:0.03, low:900, high:3200, q:0.95, crack:1.1, delay:0.05});
    impactNoise({dur:0.05, vol:0.018, low:500, high:1800, q:0.7, crack:0.55, delay:0.085});
  },
  craft: () => beep(520, 0.12, "sine", 0.05),
  shoot: () => beep(660, 0.08, "sawtooth", 0.03),
  hurt: () => beep(120, 0.18, "sawtooth", 0.06),
  die: () => beep(90, 0.5, "sawtooth", 0.07),
  eat: () => beep(760, 0.1, "sine", 0.04),
  tame: () => { beep(440, 0.1, "sine", 0.05); setTimeout(() => beep(660, 0.15, "sine", 0.05), 80); },
  ability: () => { beep(300, 0.08, "sawtooth", 0.04); beep(500, 0.12, "triangle", 0.04); },
  gold: () => beep(880, 0.1, "sine", 0.04),
  night: () => beep(80, 0.4, "sawtooth", 0.03),
};

// ---------- background ----------
const tile = document.createElement("canvas");
tile.width = tile.height = 256;
(function paintTile() {
  const tctx = tile.getContext("2d");
  const TILE = 256;
  let seed = 1337;
  function srand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; }
  function wrapDelta(d) {
    if (d > TILE * 0.5) d -= TILE;
    else if (d < -TILE * 0.5) d += TILE;
    return d;
  }
  function drawWrapped(x, y, pad, drawFn) {
    for (let ox = -TILE; ox <= TILE; ox += TILE) {
      for (let oy = -TILE; oy <= TILE; oy += TILE) {
        const px = x + ox, py = y + oy;
        if (px < -pad || px > TILE + pad || py < -pad || py > TILE + pad) continue;
        drawFn(px, py);
      }
    }
  }

  // Base forest floor. Use a mostly even base so the repeating tile does not show seams.
  tctx.fillStyle = "#5c7f4c";
  tctx.fillRect(0, 0, TILE, TILE);

  // Broad seamless color variation.
  for (let i = 0; i < 120; i++) {
    const x = srand() * TILE, y = srand() * TILE;
    const rx = 10 + srand() * 20;
    const ry = rx * (0.65 + srand() * 0.45);
    const rot = srand() * TAU;
    const fill = `rgba(${74 + Math.floor(srand()*24)},${118 + Math.floor(srand()*30)},${58 + Math.floor(srand()*20)},${0.07 + srand()*0.11})`;
    drawWrapped(x, y, rx + 2, (px, py) => {
      tctx.save();
      tctx.translate(px, py);
      tctx.rotate(rot);
      tctx.fillStyle = fill;
      tctx.beginPath();
      tctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      tctx.fill();
      tctx.restore();
    });
  }

  // Tiny clover / moss dots.
  for (let i = 0; i < 220; i++) {
    const x = srand() * TILE, y = srand() * TILE;
    const fill = `rgba(${96 + Math.floor(srand()*20)},${151 + Math.floor(srand()*22)},${74 + Math.floor(srand()*18)},${0.18 + srand()*0.20})`;
    drawWrapped(x, y, 2, (px, py) => {
      tctx.fillStyle = fill;
      tctx.fillRect(px, py, 1.7, 1.7);
    });
  }

  // Leaf litter and earthy bits.
  for (let i = 0; i < 165; i++) {
    const x = srand() * TILE, y = srand() * TILE;
    const w = 2 + srand() * 4, h = 1 + srand() * 2.6;
    const rot = srand() * TAU;
    const hue = srand();
    const fill = hue < 0.45 ? `rgba(92,66,38,${0.15 + srand()*0.14})` : hue < 0.8 ? `rgba(124,98,52,${0.12 + srand()*0.13})` : `rgba(86,107,50,${0.11 + srand()*0.13})`;
    drawWrapped(x, y, w + 2, (px, py) => {
      tctx.save();
      tctx.translate(px, py);
      tctx.rotate(rot);
      tctx.fillStyle = fill;
      tctx.beginPath();
      tctx.ellipse(0, 0, w, h, 0, 0, TAU);
      tctx.fill();
      tctx.restore();
    });
  }

  // Grass blades / little tufts.
  for (let i = 0; i < 245; i++) {
    const x = srand() * TILE, y = srand() * TILE;
    const h = 3 + srand() * 7;
    const sway = -2 + srand() * 4;
    const stroke = `rgba(${86 + Math.floor(srand()*20)},${145 + Math.floor(srand()*28)},${66 + Math.floor(srand()*16)},${0.16 + srand()*0.20})`;
    const lw = 1 + srand() * 0.5;
    drawWrapped(x, y, h + 4, (px, py) => {
      tctx.strokeStyle = stroke;
      tctx.lineWidth = lw;
      tctx.beginPath();
      tctx.moveTo(px, py + h * 0.45);
      tctx.quadraticCurveTo(px + sway * 0.35, py + h * 0.1, px + sway, py - h);
      tctx.stroke();
    });
  }

  // Keep decorative objects from overlapping each other, including across tile seams.
  const decoSpots = [];
  function placeDeco(radius, tries = 100) {
    for (let i = 0; i < tries; i++) {
      const x = srand() * TILE;
      const y = srand() * TILE;
      let ok = true;
      for (const d of decoSpots) {
        const dx = wrapDelta(x - d.x), dy = wrapDelta(y - d.y);
        if (dx * dx + dy * dy < (radius + d.r) * (radius + d.r)) { ok = false; break; }
      }
      if (ok) {
        decoSpots.push({ x, y, r: radius });
        return { x, y };
      }
    }
    return null;
  }

  // A few tiny twig pieces.
  for (let i = 0; i < 18; i++) {
    const spot = placeDeco(7.5);
    if (!spot) continue;
    const len = 5 + srand() * 8;
    const ang = srand() * TAU;
    const stroke = `rgba(${96 + Math.floor(srand()*22)},${70 + Math.floor(srand()*16)},${42 + Math.floor(srand()*12)},${0.28 + srand()*0.16})`;
    const lw = 1.4 + srand() * 0.8;
    const branch = srand() < 0.45;
    drawWrapped(spot.x, spot.y, len + 4, (px, py) => {
      tctx.strokeStyle = stroke;
      tctx.lineWidth = lw;
      tctx.lineCap = "round";
      tctx.beginPath();
      tctx.moveTo(px, py);
      tctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      tctx.stroke();
      if (branch) {
        tctx.beginPath();
        tctx.moveTo(px + Math.cos(ang) * len * 0.45, py + Math.sin(ang) * len * 0.45);
        tctx.lineTo(px + Math.cos(ang + 0.7) * len * 0.32, py + Math.sin(ang + 0.7) * len * 0.32);
        tctx.stroke();
      }
    });
  }

  // Small pebbles / rocks with brighter and deeper tones.
  for (let i = 0; i < 24; i++) {
    const spot = placeDeco(5.6);
    if (!spot) continue;
    const rx = 1.8 + srand() * 2.8, ry = 1.4 + srand() * 2.2;
    const rot = srand() * TAU;
    const fill = srand() < 0.55 ? `rgba(${132 + Math.floor(srand()*18)},${141 + Math.floor(srand()*18)},${149 + Math.floor(srand()*22)},${0.30 + srand()*0.14})` : `rgba(${98 + Math.floor(srand()*18)},${108 + Math.floor(srand()*18)},${118 + Math.floor(srand()*22)},${0.32 + srand()*0.16})`;
    drawWrapped(spot.x, spot.y, rx + 4, (px, py) => {
      tctx.save();
      tctx.translate(px, py);
      tctx.rotate(rot);
      tctx.fillStyle = fill;
      tctx.beginPath(); tctx.ellipse(0, 0, rx, ry, 0, 0, TAU); tctx.fill();
      tctx.fillStyle = "rgba(255,255,255,0.16)";
      tctx.beginPath(); tctx.ellipse(-rx * 0.18, -ry * 0.12, rx * 0.35, ry * 0.22, 0, 0, TAU); tctx.fill();
      tctx.restore();
    });
  }

  // Fewer, smaller flower patches, spaced away from twigs and pebbles.
  const flowerColors = ["rgba(255,245,224,0.84)", "rgba(221,236,255,0.82)", "rgba(255,229,171,0.82)", "rgba(215,243,212,0.80)"];
  for (let i = 0; i < 12; i++) {
    const spot = placeDeco(9.5);
    if (!spot) continue;
    const blossoms = 2 + Math.floor(srand() * 3);
    const blossomData = [];
    for (let b = 0; b < blossoms; b++) {
      blossomData.push({
        dx: (srand() - 0.5) * 7,
        dy: (srand() - 0.5) * 6,
        size: 1 + srand() * 0.85,
        petals: 4 + (srand() > 0.55 ? 1 : 0),
        color: flowerColors[Math.floor(srand() * flowerColors.length)],
        stemDx: (srand() - 0.5) * 1.2,
        stemLen: 4 + srand() * 2.5
      });
    }
    drawWrapped(spot.x, spot.y, 12, (px, py) => {
      for (const bl of blossomData) {
        const x = px + bl.dx, y = py + bl.dy;
        for (let p = 0; p < bl.petals; p++) {
          const a = (p / bl.petals) * TAU;
          tctx.fillStyle = bl.color;
          tctx.beginPath();
          tctx.arc(x + Math.cos(a) * bl.size * 1.3, y + Math.sin(a) * bl.size * 1.3, bl.size, 0, TAU);
          tctx.fill();
        }
        tctx.fillStyle = "rgba(255,201,74,0.92)";
        tctx.beginPath(); tctx.arc(x, y, bl.size * 0.62, 0, TAU); tctx.fill();
        tctx.strokeStyle = "rgba(68,105,46,0.22)";
        tctx.lineWidth = 1;
        tctx.beginPath(); tctx.moveTo(x, y + bl.size * 0.9); tctx.lineTo(x + bl.stemDx, y + bl.stemLen); tctx.stroke();
      }
    });
  }
})();
const bgPattern = ctx.createPattern(tile, "repeat");



