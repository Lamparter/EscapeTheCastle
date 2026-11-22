import type { Rect, Solid } from "./physics";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * Level 1 - The Nursery (tutorial).
 * Puzzle: the slide hatch is padlocked and the key hangs from the chandelier, out of reach of a
 * normal jump + double jump. Sink into the bouncy floor (hold S), spring up and double jump to
 * knock the key loose. It bounces away wildly; catch it (E), then climb the wardrobe to the shelf
 * and carry the key into the hatch.
 */

export const ROOM = { w: 1920, h: 760 };

export const FLOOR_Y = 700;
export const WALL_L = 64;
export const WALL_R = ROOM.w - 64;
export const CEIL_Y = 84;

export type FixedKind = "floor" | "wall" | "ceiling" | "bed" | "wardrobe" | "shelf" | "nightstand";

/** A rendered sprite placed in the room: left edge x and the floor line it stands on. */
export interface SpriteArt {
	sprite: SpriteName;
	left: number;
	bottom: number;
}

export interface FixedPiece extends Solid {
	kind: FixedKind;
	art?: SpriteArt;
}

// Furniture placement. Hitboxes follow the rendered sprites (tools/sprites.json).
const BED_LEFT = 96;
const WARDROBE_W = Math.round(SPRITES.wardrobe.w - 8);
const WARDROBE_RIGHT = 1662;
const NIGHTSTAND_LEFT = 470;

export const FIXED: FixedPiece[] = [
	{ id: "floor", kind: "floor", x: 0, y: FLOOR_Y, w: ROOM.w, h: ROOM.h - FLOOR_Y + 200, bounce: 0.86 },
	{ id: "wallL", kind: "wall", x: -200, y: -200, w: WALL_L + 200, h: ROOM.h + 400, bounce: 0.82 },
	{ id: "wallR", kind: "wall", x: WALL_R, y: -200, w: 200 + 64, h: ROOM.h + 400, bounce: 0.82 },
	{ id: "ceiling", kind: "ceiling", x: 0, y: -200, w: ROOM.w, h: CEIL_Y + 200, bounce: 0.7 },
	// Only the mattress is solid; the carved head- and footboards are scenery you pass in front of.
	{
		id: "bed", kind: "bed", x: BED_LEFT + 14, y: FLOOR_Y - 70, w: Math.round(SPRITES.bed.w * 0.84), h: 70, bounce: 0.7,
		art: { sprite: "bed", left: BED_LEFT, bottom: FLOOR_Y + 2 },
	},
	{
		id: "wardrobe", kind: "wardrobe", x: WARDROBE_RIGHT - WARDROBE_W, y: FLOOR_Y - 280, w: WARDROBE_W, h: 280, bounce: 0.3,
		art: { sprite: "wardrobe", left: WARDROBE_RIGHT - WARDROBE_W - 4, bottom: FLOOR_Y + 2 },
	},
	{
		id: "nightstand", kind: "nightstand", x: NIGHTSTAND_LEFT + 4, y: FLOOR_Y - 76, w: Math.round(SPRITES.nightstand.w - 8), h: 76, bounce: 0.3,
		art: { sprite: "nightstand", left: NIGHTSTAND_LEFT, bottom: FLOOR_Y + 2 },
	},
	{
		id: "shelf", kind: "shelf", x: 1672, y: 250, w: WALL_R - 1672, h: 16, bounce: 0.3,
		art: { sprite: "shelf", left: 1668, bottom: 248 + SPRITES.shelf.h },
	},
];

export type ItemKind = "chest" | "stool" | "pillow" | "key";

export interface ItemDef {
	id: string;
	kind: ItemKind;
	name: string;
	x: number; // centre x
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
	/** Rendered sprite (drawn bottom-centred on the hitbox); falls back to shape art. */
	sprite?: SpriteName;
}

/** Hitbox for a sprite-backed item: the sprite minus its transparent render margin. */
const fit = (s: SpriteName) => ({ w: Math.round(SPRITES[s].w - 3), h: Math.round(SPRITES[s].h - 2), sprite: s });

export const ITEMS: ItemDef[] = [
	{ id: "chest", kind: "chest", name: "toy chest", x: 990, ...fit("chest"), restOn: FLOOR_Y, bounce: 0.3, carrySpeed: 0.72, bounceScale: 0.45 },
	{ id: "stool", kind: "stool", name: "stool", x: 1260, ...fit("stool"), restOn: FLOOR_Y, bounce: 0.35, carrySpeed: 0.85, bounceScale: 0.6 },
	{ id: "pillow", kind: "pillow", name: "cushions", x: 190, ...fit("pillow"), restOn: FLOOR_Y - 70, bounce: 0.9, carrySpeed: 0.93, bounceScale: 0.9 },
	{ id: "key", kind: "key", name: "key", x: 900, ...fit("key"), restOn: 300, bounce: 0.6, carrySpeed: 0.97, bounceScale: 1, hidden: true },
];

/** Touching this rect (on the shelf) while carrying the key takes the player down the slide. */
export const HATCH: Rect = { x: 1748, y: 148, w: 86, h: 102 };

/** The chandelier sprite hangs by its chain from the ceiling rose at (x, y); len = distance to its bottom finial. */
export const CHANDELIER = { x: 900, y: 20, len: SPRITES.chandelier.h };
/** Bumping into the chandelier's candle tier or the dangling key knocks the key loose (bottom edge at y=300). */
export const CHANDELIER_HIT: Rect = { x: 822, y: 150, w: 156, h: 150 };
/** Where the key hangs (centre), relative to the chandelier's bottom finial. */
export const KEY_HANG = { dx: 0, dy: 30 };

/** Player hitbox half-size (1.5x the original child). */
export const PLAYER_SIZE = { hw: 19, hh: 33 };
export const PLAYER_START = { x: 600, y: FLOOR_Y - PLAYER_SIZE.hh };

export const ROOM_TITLE = "The Nursery";
export const ROOM_NUMBER = "Room I";

/** Dollhouse room art: theme (wallpaper/colours), how far the art extends above y=0, and back-wall windows. */
export const ROOM_THEME = "nursery";
export const ROOM_ART_TOP = 140;
export const ROOM_WINDOWS = [
	{ x: 610, y: 170, w: 170, h: 210, moon: true },
	{ x: 1485, y: 160, w: 130, h: 150 },
];
