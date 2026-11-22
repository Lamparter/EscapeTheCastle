import type { Rect, Solid } from "./physics";

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

export type FixedKind = "floor" | "wall" | "ceiling" | "bed" | "wardrobe" | "shelf";

export interface FixedPiece extends Solid {
	kind: FixedKind;
}

export const FIXED: FixedPiece[] = [
	{ id: "floor", kind: "floor", x: 0, y: FLOOR_Y, w: ROOM.w, h: ROOM.h - FLOOR_Y + 200, bounce: 0.86 },
	{ id: "wallL", kind: "wall", x: -200, y: -200, w: WALL_L + 200, h: ROOM.h + 400, bounce: 0.82 },
	{ id: "wallR", kind: "wall", x: WALL_R, y: -200, w: 200 + 64, h: ROOM.h + 400, bounce: 0.82 },
	{ id: "ceiling", kind: "ceiling", x: 0, y: -200, w: ROOM.w, h: CEIL_Y + 200, bounce: 0.7 },
	{ id: "bed", kind: "bed", x: 110, y: 600, w: 330, h: 100, bounce: 0.7 },
	{ id: "wardrobe", kind: "wardrobe", x: 1480, y: 420, w: 160, h: 280, bounce: 0.3 },
	{ id: "shelf", kind: "shelf", x: 1672, y: 250, w: WALL_R - 1672, h: 16, bounce: 0.3 },
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
}

export const ITEMS: ItemDef[] = [
	{ id: "chest", kind: "chest", name: "toy chest", x: 990, w: 100, h: 110, restOn: FLOOR_Y, bounce: 0.3, carrySpeed: 0.72, bounceScale: 0.45 },
	{ id: "stool", kind: "stool", name: "stool", x: 1260, w: 60, h: 56, restOn: FLOOR_Y, bounce: 0.35, carrySpeed: 0.85, bounceScale: 0.6 },
	{ id: "pillow", kind: "pillow", name: "pillow", x: 230, w: 70, h: 24, restOn: 600, bounce: 0.9, carrySpeed: 0.93, bounceScale: 0.9 },
	{ id: "key", kind: "key", name: "key", x: 900, w: 34, h: 16, restOn: 300, bounce: 0.6, carrySpeed: 0.97, bounceScale: 1, hidden: true },
];

/** Touching this rect (on the shelf) while carrying the key takes the player down the slide. */
export const HATCH: Rect = { x: 1748, y: 148, w: 86, h: 102 };

/** The chandelier hangs from the ceiling; the key dangles below it. */
export const CHANDELIER = { x: 900, len: 150 };
/** Bumping into this knocks the key loose. */
export const CHANDELIER_HIT: Rect = { x: 828, y: 205, w: 144, h: 92 };
/** Where the key hangs (centre), relative to the chandelier body. */
export const KEY_HANG = { dx: 0, dy: 52 };

export const PLAYER_START = { x: 560, y: FLOOR_Y - 22 };

export const ROOM_TITLE = "The Nursery";
export const ROOM_NUMBER = "Room I";

/** Back-wall art layout for the procedural castle renderer. */
export const CASTLE_ART_TOP = 140;
export const CASTLE_WINDOWS = [
	{ x: 610, y: 170, w: 170, h: 210, moon: true },
	{ x: 1485, y: 160, w: 130, h: 150 },
];
export const CASTLE_BUTTRESSES = [420, 800, 1290, 1680];
