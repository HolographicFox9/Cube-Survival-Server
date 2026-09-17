// Rebuild js/game.js from the separated editable source fragments.
// Run from this folder with: node build-game.js
const fs = require("fs");
const path = require("path");
const parts = [
  "01-core.part.js",
  "02-deer-art.part.js",
  "03-animal-costumes.part.js",
  "04-custom-animal-sprites.part.js",
  "05-gameplay.part.js",
];
const source = parts.map(name => fs.readFileSync(path.join(__dirname, "src", name), "utf8")).join("");
fs.mkdirSync(path.join(__dirname, "js"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "js", "game.js"), source, "utf8");
console.log("Rebuilt js/game.js from", parts.length, "source parts.");
