import type { Rect, Solid } from "./physics";

/**
 * Level 1 - The Nursery (tutorial).
 * Puzzle: the wardrobe (320 tall) is just out of reach of a full-power jump from the floor (~300).
 * Carry the toy chest (or stool) next to it, stand on it, jump onto the wardrobe, then up to
 * the shelf with the slide hatch.
 */

export const ROOM = { w: 1920, h: 760 };

export const FLOOR_Y = 700;
export const WALL_L = 48;
export const WALL_R = ROOM.w - 48;
export const CEIL_Y = 40;

export type FixedKind = "floor" | "wall" | "ceiling" | "bed" | "wardrobe" | "shelf";

export interface FixedPiece extends Solid {
	kind: FixedKind;
}

export const FIXED: FixedPiece[] = [
	{ id: "floor", kind: "floor", x: 0, y: FLOOR_Y, w: ROOM.w, h: ROOM.h - FLOOR_Y + 200, bounce: 0.45 },
	{ id: "wallL", kind: "wall", x: -200, y: -200, w: WALL_L + 200, h: ROOM.h + 400, bounce: 0.55 },
	{ id: "wallR", kind: "wall", x: WALL_R, y: -200, w: 200 + 48, h: ROOM.h + 400, bounce: 0.55 },
	{ id: "ceiling", kind: "ceiling", x: 0, y: -200, w: ROOM.w, h: CEIL_Y + 200, bounce: 0.4 },
	{ id: "bed", kind: "bed", x: 110, y: 600, w: 330, h: 100, bounce: 0.7 },
	{ id: "wardrobe", kind: "wardrobe", x: 1480, y: 380, w: 160, h: 320, bounce: 0.3 },
	{ id: "shelf", kind: "shelf", x: 1700, y: 230, w: WALL_R - 1700, h: 16, bounce: 0.3 },
];

export type ItemKind = "chest" | "stool" | "pillow";

export interface ItemDef {
	id: string;
	kind: ItemKind;
	name: string;
	x: number; // centre x
	w: number;
	h: number;
	restOn: number; // y of the surface it starts on
	bounce: number;
}

export const ITEMS: ItemDef[] = [
	{ id: "chest", kind: "chest", name: "toy chest", x: 990, w: 100, h: 110, restOn: FLOOR_Y, bounce: 0.3 },
	{ id: "stool", kind: "stool", name: "stool", x: 1260, w: 60, h: 56, restOn: FLOOR_Y, bounce: 0.35 },
	{ id: "pillow", kind: "pillow", name: "pillow", x: 230, w: 70, h: 24, restOn: 600, bounce: 0.9 },
];

/** Touching this rect (on the shelf) takes the player down the slide. */
export const HATCH: Rect = { x: 1748, y: 128, w: 86, h: 102 };

export const PLAYER_START = { x: 560, y: FLOOR_Y - 20 };

export const ROOM_TITLE = "The Nursery";
export const ROOM_NUMBER = "Room I";
