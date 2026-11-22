import type { KAPLAYCtx } from "kaplay";
import type { Palette } from "./config";
import { CHANDELIER, FLOOR_Y, HATCH, KEY_HANG, type SpriteArt } from "./level1";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * Room objects: photoreal rendered sprites (tools/render_sprites.py) plus light effects (glows, the portrait's pupils).
 * Every function draws in world coordinates.
 */
export function makeRoomArt(k: KAPLAYCtx, pal: Palette) {
	const v = k.vec2;

	/** Where the old portrait hangs (its top-left corner) and where its blank marble eyes are on the sprite. */
	const PORTRAIT = { x: 1086, y: 186 };
	const PORTRAIT_EYES = [{ x: 0.363, y: 0.355 }, { x: 0.503, y: 0.355 }];

	function portrait(px: number, py: number) {
		const s = SPRITES.painting;
		k.drawSprite({ sprite: spriteKey("painting"), pos: v(PORTRAIT.x, PORTRAIT.y), width: s.w, height: s.h });
		// Dark pupils drift across the blank marble eyes to follow the player.
		for (const e of PORTRAIT_EYES) {
			const ex = PORTRAIT.x + e.x * s.w, ey = PORTRAIT.y + e.y * s.h;
			const dir = v(px - ex, py - ey).unit();
			k.drawCircle({ pos: v(ex + dir.x * 2.2, ey + dir.y * 1.4), radius: 1.9, color: k.rgb(14, 10, 8), opacity: 0.9 });
		}
	}

	function hatch(t: number, open: boolean, locked: boolean) {
		const s = SPRITES.hatch;
		const cx = HATCH.x + HATCH.w / 2, bottom = HATCH.y + HATCH.h + 4;
		// Faint draught of moonlight from the slide beyond, behind the frame's dark opening
		const glow = 0.06 + 0.03 * Math.sin(t * 2) + (open ? 0.12 : 0);
		k.drawSprite({ sprite: spriteKey("hatch"), pos: v(cx, bottom), width: s.w, height: s.h, anchor: "bot" });
		k.drawEllipse({ pos: v(cx, bottom - s.h * 0.45), radiusX: s.w * 0.3, radiusY: s.h * 0.32, color: pal.moon, opacity: glow });
		if (locked) k.drawSprite({ sprite: spriteKey("hatch_lock"), pos: v(cx, bottom), width: s.w, height: s.h, anchor: "bot" });
	}

	const swingAngle = (t: number, swing: number) => Math.sin(t * 0.9) * 0.05 + swing;

	/** World position of the chandelier's bottom finial for a given extra swing angle (radians). */
	function chandelierPos(t: number, swing: number) {
		const a = swingAngle(t, swing);
		return v(CHANDELIER.x + Math.sin(a) * CHANDELIER.len, CHANDELIER.y + Math.cos(a) * CHANDELIER.len);
	}

	/** A rendered furniture sprite standing on its floor line. */
	function placed(art: SpriteArt) {
		const s = SPRITES[art.sprite];
		k.drawSprite({ sprite: spriteKey(art.sprite), pos: v(art.left, art.bottom - s.h), width: s.w, height: s.h });
	}

	function chandelier(t: number, swing: number, hasKey: boolean) {
		const s = SPRITES.chandelier;
		const a = swingAngle(t, swing);
		if (hasKey) {
			// The key dangles on a ribbon below the finial, catching the candlelight.
			const f = chandelierPos(t, swing);
			const kx = f.x + KEY_HANG.dx, ky = f.y + KEY_HANG.dy;
			k.drawLine({ p1: f, p2: v(kx, ky - 8), width: 2, color: pal.red });
			drawItem(k, pal, "key", kx - 17, ky - 8, 34, 16);
			k.drawCircle({ pos: v(kx + 10, ky - 4), radius: 2 + Math.abs(Math.sin(t * 3)) * 2, color: pal.flame, opacity: 0.7 });
		}
		k.pushTransform();
		k.pushTranslate(CHANDELIER.x, CHANDELIER.y);
		k.pushRotate(-k.rad2deg(a));
		k.drawSprite({ sprite: spriteKey("chandelier"), pos: v(0, 0), width: s.w, height: s.h, anchor: "top" });
		// Flickering glow over the candle tips (positions measured on the rendered sprite).
		const tips = [-0.4, -0.25, -0.1, 0.1, 0.25, 0.4];
		tips.forEach((fx, i) => {
			const flick = 0.55 + 0.45 * Math.sin(t * 13 + i * 2.1) * Math.sin(t * 7.3 + i);
			const p = v(fx * s.w, s.h * (0.58 + (i % 2) * 0.05));
			k.drawCircle({ pos: p, radius: 16, color: pal.flame, opacity: 0.09 * flick });
			k.drawCircle({ pos: p, radius: 4, color: pal.flame, opacity: 0.35 * flick });
		});
		k.popTransform();
	}

	function rockingHorse(t: number, sink = 0) {
		const s = SPRITES.rocking_horse;
		const rock = Math.sin(t * 0.6) * 0.06;
		k.pushTransform();
		k.pushTranslate(760, FLOOR_Y + 2 + sink);
		k.pushRotate(k.rad2deg(rock));
		k.drawSprite({ sprite: spriteKey("rocking_horse"), pos: v(0, 0), width: s.w, height: s.h, anchor: "bot" });
		k.popTransform();
	}

	return { portrait, hatch, chandelier, chandelierPos, placed, rockingHorse };
}

/** KAPLAY asset name for a rendered sprite. */
export const spriteKey = (name: SpriteName) => `nursery_${name}`;

const ITEM_SPRITES: Record<string, SpriteName> = { chest: "chest", stool: "stool", pillow: "pillow", key: "key" };

export function drawItem(k: KAPLAYCtx, pal: Palette, kind: string, x: number, y: number, w: number, h: number, opacity = 1) {
	const v = k.vec2;
	const o = { opacity };
	const spr = ITEM_SPRITES[kind];
	if (spr) {
		// Sprite is a touch larger than the hitbox (render margin); keep it bottom-centred.
		const s = SPRITES[spr];
		const sw = s.w * (w / (s.w - 3)), sh = s.h * (h / (s.h - 2));
		k.drawSprite({ sprite: spriteKey(spr), pos: v(x + w / 2, y + h + 1), width: sw, height: sh, anchor: "bot", opacity });
		return;
	}
}

/** The player: a porcelain-doll child in a nightgown. Squashes and stretches with vertical speed. */
export function drawPlayer(k: KAPLAYCtx, x: number, y: number, hh: number, vy: number, facing: number, t: number) {
	const s = SPRITES.player;
	const stretch = Math.max(-0.25, Math.min(0.25, -vy / 3000));
	const sx = 1 - stretch * 0.7, sy = 1 + stretch;
	const blink = (t % 4) < 0.12;
	k.pushTransform();
	k.pushTranslate(x, y + hh + 1);
	k.pushScale(sx, sy);
	k.drawSprite({ sprite: spriteKey(blink ? "player_blink" : "player"), pos: k.vec2(0, 0), width: s.w, height: s.h, anchor: "bot", flipX: facing < 0 });
	k.popTransform();
}
