# Escape The Castle

A horror game inside a bouncy Victorian dollhouse. Low gravity, a very bouncy floor and something lurking under the floorboards: bounce your way out of each room.
This is the first mock-up: Room I (The Nursery, the tutorial).

## Controls

| Input | Action |
| --- | --- |
| A / D or Left / Right | Walk slowly; drift while airborne |
| W / Space / Up | Jump; press again in mid-air to double jump (one per landing) |
| Hold S on the floor | Sink into the vinyl; let go to spring up (deeper dent = higher) |
| Hold S while bouncing | Dig in and stop bouncing |
| E | Pick up / put down light furniture and the key (the pointer chooses where it goes) |
| R | Restart room |
| Esc | Pause menu |

## Folder structure

- `src/main.ts` - KAPLAY setup, title and "escaped" scenes
- `src/game.ts` - the room scene: input, walking/jumping/springing, carrying, the key puzzle, camera, HUD, pause menu
- `src/physics.ts` - small AABB physics with restitution (bouncy surfaces)
- `src/level1.ts` - The Nursery layout and puzzle data
- `src/dollhouseArt.ts` - the room as a cut-away Victorian dollhouse room: vector wallpaper, mouldings and windows, plus a photo-textured parquet floor (each room has its own theme)
- `src/draw.ts` - draws the rendered sprites (furniture, painting, hatch, player) and light effects
- `src/config.ts` - tuning values and the colour palette
- `src/sprites.generated.ts` - sizes of the rendered furniture sprites (generated)
- `tools/` - model download and Blender sprite-render scripts

## Development

```sh
pnpm run dev
```

starts a dev server at http://localhost:3001. In dev builds, `window.__etc` in the browser console lets you inspect and teleport the player; `__etc.fx(false)` hides the vignette to inspect the art.

```sh
pnpm run check
```

type-checks the project.

## Sprites from 3D models

Furniture sprites are rendered from CC0 [Poly Haven](https://polyhaven.com) models with Blender 5.2 (see `docs/ASSETS.md`):

```sh
python tools/fetch_polyhaven.py
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P tools/render_sprites.py
```

Pieces with no suitable free model (player, key, rocking horse, hatch) are built procedurally in `tools/procedural.py`. The first command downloads the models and photo textures listed in `tools/sprites.json` into `art/source/` (git-ignored). The second renders them into `public/sprites/nursery/` with a shared camera, lighting and colour grade, and regenerates `src/sprites.generated.ts` (sprite sizes in game units). Add names after `--` to re-render only some sprites. Credits are in `CREDITS.md`.

## Distribution

```sh
pnpm run zip
```

builds into `dist/` and packs it into `game.zip` (with `index.html` at the root), ready to upload to itch.io as an HTML game.
