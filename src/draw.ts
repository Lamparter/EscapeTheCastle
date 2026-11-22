import type { Color, KAPLAYCtx, Vec2 } from "kaplay";
import { CHANDELIER, FLOOR_Y, HATCH, KEY_HANG, PORTRAIT, ROCKING_HORSE, type Furniture } from "./level1";
import type { Rect } from "./physics";
import { bboxOf, spriteKey, spriteOrigin, spriteRects } from "./sprites";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * Everything in the world is a photoreal image (rendered with real photo textures, or a photo).
 * Light, glow and darkness are image effects: the soft "glow" and "shade" images, tinted and faded.
 * Every function draws in world coordinates.
 */
export { spriteKey };

/** Soft additive-looking light: the glow image, tinted. */
export function glow(k: KAPLAYCtx, pos: Vec2, radius: number, color: Color, opacity: number) {
	k.drawSprite({ sprite: "glow", pos, width: radius * 2, height: radius * 2, anchor: "center", color, opacity });
}

export function makeRoomArt(k: KAPLAYCtx) {
	const v = k.vec2;
	const warm = k.rgb(255, 196, 120);
	const moon = k.rgb(150, 175, 215);

	/** The sitter's head turns to follow the player: cross-fade between renders at five head angles. */
	const TURNS: SpriteName[] = ["painting_l2", "painting_l1", "painting", "painting_r1", "painting_r2"];
	function portrait(px: number) {
		const s = SPRITES.painting;
		const f = Math.max(-2, Math.min(2, (px - (PORTRAIT.x + s.w / 2)) / 320)) + 2;
		const i0 = Math.min(3, Math.floor(f)), frac = f - i0;
		k.drawSprite({ sprite: spriteKey(TURNS[i0]), pos: v(PORTRAIT.x, PORTRAIT.y), width: s.w, height: s.h });
		if (frac > 0.01) k.drawSprite({ sprite: spriteKey(TURNS[i0 + 1]), pos: v(PORTRAIT.x, PORTRAIT.y), width: s.w, height: s.h, opacity: frac });
	}

	const hatchTopLeft = () => v(HATCH.cx - SPRITES.hatch.w / 2, HATCH.bottom - SPRITES.hatch.h);
	/** World rects of the hatch's visible pixels (frame and opening). */
	const hatchRects = (): Rect[] => spriteRects("hatch", hatchTopLeft().x, hatchTopLeft().y);

	/** lockFall: 0 = chained shut; 0..1 = the chains and padlock dropping away after unlocking. */
	function hatch(t: number, open: boolean, lockFall: number) {
		const s = SPRITES.hatch, p = hatchTopLeft();
		k.drawSprite({ sprite: spriteKey("hatch"), pos: p, width: s.w, height: s.h });
		// Faint draught of moonlight from the slide beyond
		glow(k, v(HATCH.cx, HATCH.bottom - s.h * 0.45), s.w * 0.45, moon, 0.1 + 0.05 * Math.sin(t * 2) + (open ? 0.25 : 0));
		if (lockFall < 1) {
			const drop = 160 * lockFall * lockFall;
			k.pushTransform();
			k.pushTranslate(HATCH.cx, p.y + s.h * 0.6 + drop);
			k.pushRotate(lockFall * 35);
			k.drawSprite({ sprite: spriteKey("hatch_lock"), pos: v(-s.w / 2, -s.h * 0.6), width: s.w, height: s.h, opacity: 1 - lockFall });
			k.popTransform();
		}
	}

	const swingAngle = (t: number, swing: number) => Math.sin(t * 0.9) * 0.05 + swing;

	/** World position of the chandelier's bottom finial for a given extra swing angle (radians). */
	function chandelierPos(t: number, swing: number) {
		const a = swingAngle(t, swing);
		return v(CHANDELIER.x + Math.sin(a) * CHANDELIER.len, CHANDELIER.y + Math.cos(a) * CHANDELIER.len);
	}

	/** World rects of the chandelier's visible pixels, following its swing (plus the hanging key). */
	function chandelierRects(t: number, swing: number, hasKey: boolean): Rect[] {
		const s = SPRITES.chandelier, a = swingAngle(t, swing);
		const rects = spriteRects("chandelier", CHANDELIER.x - s.w / 2, CHANDELIER.y).map((r) => {
			const depth = r.y + r.h / 2 - CHANDELIER.y;
			return { ...r, x: r.x + Math.sin(a) * depth, y: r.y - (1 - Math.cos(a)) * depth };
		});
		if (hasKey) rects.push(hangingKeyBox(t, swing));
		return rects;
	}

	function hangingKeyBox(t: number, swing: number): Rect {
		const f = chandelierPos(t, swing), b = bboxOf("key");
		return { x: f.x + KEY_HANG.dx - b.w / 2, y: f.y + KEY_HANG.dy - b.h / 2, w: b.w, h: b.h };
	}

	/** A piece of furniture standing on its floor line. */
	function furniture(f: Furniture) {
		const s = SPRITES[f.sprite];
		k.drawSprite({ sprite: spriteKey(f.sprite), pos: v(f.left, f.bottom - s.h), width: s.w, height: s.h });
	}

	function chandelier(t: number, swing: number, hasKey: boolean) {
		const s = SPRITES.chandelier;
		const a = swingAngle(t, swing);
		if (hasKey) {
			// The key hangs from the bottom finial, catching the candlelight.
			const kb = hangingKeyBox(t, swing);
			drawItem(k, "key", kb);
			glow(k, v(kb.x + kb.w * 0.75, kb.y + kb.h * 0.3), 6 + Math.abs(Math.sin(t * 3)) * 5, warm, 0.8);
		}
		k.pushTransform();
		k.pushTranslate(CHANDELIER.x, CHANDELIER.y);
		k.pushRotate(-k.rad2deg(a));
		k.drawSprite({ sprite: spriteKey("chandelier"), pos: v(0, 0), width: s.w, height: s.h, anchor: "top" });
		// Flickering candle flames (positions measured on the rendered sprite).
		const tips = [-0.4, -0.25, -0.1, 0.1, 0.25, 0.4];
		tips.forEach((fx, i) => {
			const flick = 0.55 + 0.45 * Math.sin(t * 13 + i * 2.1) * Math.sin(t * 7.3 + i);
			const p = v(fx * s.w, s.h * (0.58 + (i % 2) * 0.05));
			glow(k, p, 26, warm, 0.35 * flick);
			glow(k, p, 7, warm, 0.8 * flick);
		});
		k.popTransform();
	}

	function rockingHorse(t: number, sink = 0) {
		const s = SPRITES.rocking_horse;
		const rock = Math.sin(t * 0.6) * 0.06;
		k.pushTransform();
		k.pushTranslate(ROCKING_HORSE.x, FLOOR_Y + 2 + sink);
		k.pushRotate(k.rad2deg(rock));
		k.drawSprite({ sprite: spriteKey("rocking_horse"), pos: v(0, 0), width: s.w, height: s.h, anchor: "bot" });
		k.popTransform();
	}

	return { portrait, hatch, hatchRects, chandelier, chandelierPos, chandelierRects, hangingKeyBox, furniture, rockingHorse };
}

/** Draw an item so its visible pixels fill the given world box (its body). */
export function drawItem(k: KAPLAYCtx, sprite: SpriteName, box: Rect, opacity = 1, color?: Color) {
	const s = SPRITES[sprite];
	const o = spriteOrigin(sprite, box);
	k.drawSprite({ sprite: spriteKey(sprite), pos: k.vec2(o.x, o.y), width: s.w * o.scale, height: s.h * o.scale, opacity, color });
}
