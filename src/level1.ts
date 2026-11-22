import type { Solid } from "./physics";
import { bboxOf, spriteSolids } from "./sprites";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * Level 1 - The Nursery (tutorial).
 * Puzzle: the slide hatch is padlocked and the key hangs from the chandelier, out of reach of a
 * normal jump + double jump. Sink into the bouncy floor (hold S), spring up and double jump to
 * knock the key loose. It bounces away wildly; catch it (E), then climb the wardrobe to the shelf
 * and carry the key into the hatch.
 *
 * All furniture hitboxes come from the visible pixels of the rendered sprites (tools/render_sprites.py).
 */

export const ROOM = { w: 1920, h: 760 };

export const FLOOR_Y = 700;
export const WALL_L = 64;
export const WALL_R = ROOM.w - 64;
export const CEIL_Y = 84;

/** A piece of solid furniture: its sprite, where it stands, and how bouncy it is. */
export interface Furniture {
	id: string;
	sprite: SpriteName;
	left: number;
	/** World y of the sprite's bottom edge (its feet). */
	bottom: number;
	bounce: number;
}

export const FURNITURE: Furniture[] = [
	{ id: "bed", sprite: "bed", left: 96, bottom: FLOOR_Y + 2, bounce: 0.7 },
	{ id: "nightstand", sprite: "nightstand", left: 470, bottom: FLOOR_Y + 2, bounce: 0.3 },
	{ id: "wardrobe", sprite: "wardrobe", left: 1662 - SPRITES.wardrobe.w, bottom: FLOOR_Y + 2, bounce: 0.3 },
	{ id: "shelf", sprite: "shelf", left: 1668, bottom: 272 + SPRITES.shelf.h, bounce: 0.3 }, // headroom for the doll
];

const furnitureTop = (f: Furniture) => f.bottom - SPRITES[f.sprite].h;

/** Every static solid: the room box plus each furniture sprite's visible-pixel rectangles. */
export const FIXED: Solid[] = [
	{ id: "floor", x: 0, y: FLOOR_Y, w: ROOM.w, h: ROOM.h - FLOOR_Y + 200, bounce: 0.86 },
	{ id: "wallL", x: -200, y: -200, w: WALL_L + 200, h: ROOM.h + 400, bounce: 0.82 },
	{ id: "wallR", x: WALL_R, y: -200, w: 200 + 64, h: ROOM.h + 400, bounce: 0.82 },
	{ id: "ceiling", x: 0, y: -200, w: ROOM.w, h: CEIL_Y + 200, bounce: 0.7 },
	...FURNITURE.flatMap((f) => spriteSolids(f.sprite, f.id, f.left, furnitureTop(f), f.bounce)),
];

export type ItemKind = "chest" | "stool" | "pillow" | "key";

export interface ItemDef {
	id: string;
	kind: ItemKind;
	name: string;
	sprite: SpriteName;
	x: number; // centre x
	/** Size of the item's body: the tight box around its sprite's visible pixels. */
	w: number;
	h: number;
	restOn: number; // y of the surface it starts on
	bounce: number;
	/** Carrying it multiplies your jump and drift speed by this. */
	carrySpeed: number;
	/** How much of a surface's bounce it keeps (heavy things bounce less). */
	bounceScale: number;
	/** Not in the room until something releases it (the key on the chandelier). */
	hidden?: boolean;
}

const body = (s: SpriteName) => ({ sprite: s, w: bboxOf(s).w, h: bboxOf(s).h });

export const ITEMS: ItemDef[] = [
	{ id: "chest", kind: "chest", name: "toy chest", x: 990, ...body("chest"), restOn: FLOOR_Y, bounce: 0.3, carrySpeed: 0.72, bounceScale: 0.45 },
	{ id: "stool", kind: "stool", name: "stool", x: 1260, ...body("stool"), restOn: FLOOR_Y, bounce: 0.35, carrySpeed: 0.85, bounceScale: 0.6 },
	{ id: "pillow", kind: "pillow", name: "cushions", x: 190, ...body("pillow"), restOn: FLOOR_Y - 130, // dropped onto the bed at the start
		 bounce: 0.9, carrySpeed: 0.93, bounceScale: 0.9 },
	{ id: "key", kind: "key", name: "key", x: 900, ...body("key"), restOn: 300, bounce: 0.6, carrySpeed: 0.97, bounceScale: 1, hidden: true },
];

/** The slide hatch sits on the shelf: bottom-centre of its sprite. Touching its visible pixels with the key escapes. */
export const HATCH = { cx: 1791, bottom: 278 };

/** The chandelier sprite hangs by its chain from the ceiling rose at (x, y); len = distance to its bottom finial. */
export const CHANDELIER = { x: 900, y: 0, len: SPRITES.chandelier.h };
/** Where the key hangs (centre), relative to the chandelier's bottom finial. */
export const KEY_HANG = { dx: 0, dy: 14 };

/** The portrait on the back wall (top-left corner); its sitter turns to watch the player. */
export const PORTRAIT = { x: 1086, y: 186 };
export const ROCKING_HORSE = { x: 760 };

/** Player body: the tight box around the doll's visible pixels (all her parts, at rest). */
export const PLAYER_SIZE = { hw: bboxOf("pdoll").w / 2, hh: bboxOf("pdoll").h / 2 };
export const PLAYER_START = { x: 610, y: FLOOR_Y - PLAYER_SIZE.hh };

export const ROOM_TITLE = "The Nursery";
export const ROOM_NUMBER = "Room I";
