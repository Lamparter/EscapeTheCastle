# Escape Hollybank Manor

You're a porcelain doll trapped in a Victorian dollhouse. The floor is soft, springy and wildly bouncy, the candles keep failing, and something lives beneath the floorboards. Bounce, spring and climb your way out of each room before it decides to come closer.

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
- `src/sprites.ts` - hitboxes from each rendered sprite's visible pixels
- `src/ui.ts` - UI built from photo materials (dark wood, brass)
- `src/doll.ts` - the player: a real antique doll photo (Rijksmuseum, CC0) cut into parts and animated as a cut-out rig
- `tools/cut_doll.py` - cuts the doll photo into head/arms/legs/body layers, re-proportions her like a dancer and makes her a goth ballerina (black curls, rendered satin bodice, lace ruff, tulle tutu and pointe shoes)
- `tools/pose_sheet.py` - renders the doll rig in every animation pose to one image, to check her proportions and joints
- `src/draw.ts` - draws the rendered images (furniture, portrait, hatch, chandelier, player) and image-based light effects
- `src/config.ts` - tuning values and the colour palette
- `src/sprites.generated.ts` - sizes and visible-pixel hitboxes of every rendered image (generated)
- `tools/` - model download and Blender sprite-render scripts

## Development

```sh
pnpm run dev
```

starts a dev server at http://localhost:3001. In dev builds, `window.__etc` in the browser console lets you inspect and teleport the player; `__etc.fx(false)` hides the vignette to inspect the art and `__etc.hitboxes(true)` outlines every hitbox and `__etc.zoom(4)` zooms the camera in on the doll.

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

Art rule: no vector graphics. Everything on screen is a photoreal image (renders that use real CC0 photo textures, photo textures, or public-domain scans); animation and lighting are effects applied to those images. The room itself (walls with a real 1883 Morris & Co. wallpaper scan, cornice, windows with a real night-sky photo, parquet floor) is modelled and rendered in Blender too. Pieces with no suitable free model (player, key, rocking horse, hatch, shelf, the room) are built procedurally in `tools/procedural.py`. Hitboxes come from each render's visible pixels. The first command downloads the models and photo textures listed in `tools/sprites.json` into `art/source/` (git-ignored). The second renders them into `public/sprites/nursery/` with a shared camera, lighting and colour grade, and regenerates `src/sprites.generated.ts` (sprite sizes in game units). Add names after `--` to re-render only some sprites. Credits are in `CREDITS.md`.

## Distribution

```sh
pnpm run zip
```

builds into `dist/` and packs it into `game.zip` (with `index.html` at the root), ready to upload to itch.io as an HTML game.
