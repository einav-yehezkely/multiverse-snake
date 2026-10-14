# Multiverse Snake

Snake played across the six faces of a floating 3D cube. Each face is a different world. When the snake crawls over an edge it wraps onto the next face and the camera swings round to follow. Its body can stretch across several worlds at once.

**Play it here:** https://einav-yehezkely.github.io/multiverse-snake/

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | Arrow keys or WASD | Swipe, or use the on-screen d-pad |
| Start / restart | Enter, Space, or the Play button | Tap Play |
| Pause / resume | P, Space, Esc, or the pause button | Pause button |
| Mute | M or the speaker button | Speaker button |
| Quick restart | R | – |

Steering is always relative to the screen. "Up" means up on your display, even after the cube has turned.

## Gameplay

- **12 × 12 grid on every face** (864 cells in total). The snake moves at a fixed tick rate, and the tick gets shorter with each crystal you eat (165 ms down to 72 ms).
- **Energy crystals** (green): there are always 10 on the board, spread evenly across the faces. Each gives +10 points and makes the snake 2 segments longer. Eat one and a replacement appears straight away on a random free cell the snake can reach. Crystals never appear inside the snake, on a portal or on top of another crystal. If fewer than 10 valid cells are free, the game uses the ones it has and keeps going.
- **Portals** (an orange and blue pair, always on two different faces). Enter one and your head comes out of the other. The body follows over the next ticks, and the camera turns to the destination face. A portal won't send you out facing straight into your own body. If every exit direction is blocked, it acts like an ordinary cell. Once the whole snake has passed through, the pair moves to new spots.
- **Ghost crystals** (white-violet) appear after every 4th energy crystal and fade after 11 s. Eating one gives +25 points and 6 s of ghost mode: you can pass through your own body. The body turns translucent and a countdown shows in the HUD. Both flash during the final 1.5 s.
- **Worlds**: Neon City, Emerald Jungle, Void Nebula, Molten Core, Frost Peak and Dune Sea. Each has its own procedural texture, floating particles, colour and soundtrack key. The music changes key when you enter a new world.
- Running into your own body ends the run. Your best score is kept in `localStorage`.

## How it works

```
src/cube.js    cube surface maths (pure)
src/game.js    game rules and state (pure, no DOM)
src/themes.js  world palettes and procedural face textures
src/render.js  Three.js scene, camera, effects
src/audio.js   Web Audio synth music and sound effects
src/main.js    input, HUD, main loop
```

Every cell is stored as an integer 3D point in "doubled" units, with the cube spanning [−12, 12] on each axis. Exactly one coordinate is ±12, which tells you the face. A move is `P + 2d`. If that would leave the face, the snake wraps over the edge with a single rule:

```
P' = P + d − n      n' = d      d' = −n
```

Here `n` is the face normal and `d` is the direction of travel. That one rule handles all 24 directed edges with no special cases. The camera is stored as a basis `{n, up}`. When the snake crosses an edge, `up` is rotated by the same 90° rotation that carries the old face onto the new one. That's why the controls stay screen-relative after a crossing.

Three.js r160 (MIT) is included in `vendor/`, so the site makes no CDN requests at runtime. There is no build step, and every path is relative, so the site works at any GitHub Pages project URL.

## Run locally

ES modules need an HTTP server (opening the file with `file://` won't work):

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

Any static server works, e.g. `npx serve .`.

## Tests

The tests use Node's built-in test runner and need Node 18 or newer. There are no dependencies.

```bash
npm test                       # unit tests for cube maths + game rules
node scripts/check-site.mjs .  # verify all asset/module paths are relative and exist
```

The tests cover:

- every move from every cell in every direction, including the reverse move returning you to where you started
- all 24 edge transitions, and looping right round the cube
- body continuity across faces and through portals
- growth, collisions, tail-chasing and reversal prevention
- crystal count, spread, reachability and replacement, including a nearly full board
- portal placement and safety
- pause, restart, scoring and best-score persistence, including when storage throws
- screen-relative controls after every kind of crossing
- a random-play fuzz test

## Deployment

On every push to `main`, `.github/workflows/deploy.yml` runs the tests, assembles `_site/`, checks the asset paths and deploys to GitHub Pages.

## Known limitations

- It needs a browser with WebGL. Without WebGL you get a message instead of the game.
- Bloom post-processing runs at full resolution. Very old or low-power GPUs may get a lower frame rate. The game logic still runs at the correct speed.
- The face themes are visual only: every world follows the same movement rules.
