import type { Rect, Solid } from "./physics";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * Hitboxes that follow each rendered sprite's visible (non-transparent) pixels.
 * The render script stores, per sprite, a tight bbox and a set of merged rectangles covering the
 * opaque pixels (game units, from the sprite's top-left corner). These helpers place them in the world.
 */

export type SpriteInfo = (typeof SPRITES)[SpriteName];

export const spriteKey = (name: SpriteName) => `nursery_${name}`;

/** Tight box around the visible pixels, relative to the sprite's top-left (mirrored if flipped). */
export function bboxOf(name: SpriteName, flip = false): Rect {
	const s = SPRITES[name] as { w: number; bbox?: readonly number[] };
	const b = s.bbox ?? [0, 0, s.w, (SPRITES[name] as { h: number }).h];
	return { x: flip ? s.w - b[0] - b[2] : b[0], y: b[1], w: b[2], h: b[3] };
}

/** The visible-pixel rectangles of a sprite whose top-left corner is at (left, top), as world rects. */
export function spriteRects(name: SpriteName, left: number, top: number, flip = false, scale = 1): Rect[] {
	const s = SPRITES[name] as { w: number; rects?: readonly (readonly number[])[] };
	return (s.rects ?? []).map((r) => ({
		x: left + (flip ? s.w - r[0] - r[2] : r[0]) * scale,
		y: top + r[1] * scale,
		w: r[2] * scale,
		h: r[3] * scale,
	}));
}

/** The same rectangles as physics solids. */
export function spriteSolids(name: SpriteName, id: string, left: number, top: number, bounce: number): Solid[] {
	return spriteRects(name, left, top).map((r) => ({ ...r, id, bounce }));
}

/** Top-left corner to draw a sprite so that its visible bbox sits on the given world box. */
export function spriteOrigin(name: SpriteName, box: Rect, flip = false) {
	const b = bboxOf(name, flip);
	const scale = box.w / b.w;
	return { x: box.x - b.x * scale, y: box.y - b.y * scale, scale };
}
