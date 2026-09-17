Cube Survival — Game 444 Modular

This package preserves the last confirmed-working Game 444 runtime code.

Runtime files:
  index.html
  styles.css
  js/game.js

Editable source is separated under src/:
  01-core.part.js
  02-deer-art.part.js
  03-animal-costumes.part.js
  04-custom-animal-sprites.part.js
  05-gameplay.part.js

Why game.js is still one runtime file:
Game 444 wraps all JavaScript inside one IIFE. Loading the fragments as separate script tags would change scope and risk breaking the working game. Instead, build-game.js concatenates the source fragments in the exact original order into js/game.js.

After editing a src file, run:
  node build-game.js

Do not reorder the src parts.
