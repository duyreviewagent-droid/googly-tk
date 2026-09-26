# Googly TK — Googly Tower Knockdown

One-player 3D cannon game: fire googlys at towers of wood, stone, glass, ice and tin cans, and knock them off their pedestals. Levels never end: every level number builds its own towers from a seed, and they get bigger, heavier and further away as you go.

- **Play in a browser:** open `web/public/index.html` through any static server (`node web/server.js`), or the Render site.
- **Mac app:** `mac/build.sh` builds `Googly TK.app` (plays offline).
- **Controls:** move the mouse to aim · hold click to power up · let go to fire · click mid-air for the special move · right-click or Z to zoom · C to look at the towers · Esc to pause · R to restart the level.
- **Tests:** `node test/solve.mjs 1 20` has a bot beat levels with the exact physics; `node test/cdp.mjs "level=5&auto=1" "..." 60 out.png` takes a screenshot.
