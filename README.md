# Escape The Castle

A horror game inside a bouncy castle. Low gravity, a very bouncy floor and something lurking under the vinyl: bounce your way out of each room.
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
- `src/castleArt.ts` - procedural vector art for the bouncy castle interior (rendered once to canvases)
- `src/draw.ts` - placeholder furniture/character art drawn with shapes (to be replaced by hand-drawn sprites)
- `src/config.ts` - tuning values and the colour palette

## Development

```sh
pnpm run dev
```

starts a dev server at http://localhost:3001. In dev builds, `window.__etc` in the browser console lets you inspect and teleport the player; `__etc.fx(false)` hides the vignette to inspect the art.

```sh
pnpm run check
```

type-checks the project.

## Distribution

```sh
pnpm run zip
```

builds into `dist/` and packs it into `game.zip` (with `index.html` at the root), ready to upload to itch.io as an HTML game.
