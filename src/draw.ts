import type { Color, KAPLAYCtx } from "kaplay";
import type { Palette } from "./config";
import { CEIL_Y, FLOOR_Y, HATCH, ROOM, WALL_L, WALL_R } from "./level1";
import type { Rect } from "./physics";

/**
 * All mock-up art is drawn with shapes so it can be swapped for sprites later.
 * Every function draws in world coordinates.
 */
export function makeRoomArt(k: KAPLAYCtx, pal: Palette) {
	const v = k.vec2;

	function rect(x: number, y: number, w: number, h: number, color: Color, extra: object = {}) {
		k.drawRect({ pos: v(x, y), width: w, height: h, color, ...extra });
	}

	function backWall() {
		const stripe = 80;
		for (let x = 0, i = 0; x < ROOM.w; x += stripe, i++) {
			rect(x, 0, stripe, ROOM.h, i % 2 ? pal.redDark : pal.yellowDark);
		}
		// Puffy horizontal seams
		for (let y = 120; y < FLOOR_Y; y += 140) {
			k.drawRect({ pos: v(0, y), width: ROOM.w, height: 6, color: k.BLACK, opacity: 0.25 });
		}
		// Darken towards the ceiling
		k.drawRect({
			pos: v(0, 0), width: ROOM.w, height: 320,
			gradient: [k.BLACK, k.rgb(0, 0, 0)], opacity: 0.35,
		});
	}

	function windowArt(t: number) {
		const x = 560, y = 160, w = 150, h = 210;
		rect(x - 12, y - 12, w + 24, h + 24, pal.woodDark, { radius: [80, 80, 4, 4] });
		rect(x, y, w, h, k.rgb(14, 18, 30), { radius: [70, 70, 2, 2] });
		// Moon
		k.drawCircle({ pos: v(x + 100, y + 60), radius: 22, color: pal.moon, opacity: 0.55 });
		k.drawCircle({ pos: v(x + 110, y + 54), radius: 20, color: k.rgb(14, 18, 30) });
		// Mullions
		rect(x + w / 2 - 3, y, 6, h, pal.woodDark);
		rect(x, y + h * 0.45, w, 6, pal.woodDark);
		// Curtains, gently swaying
		const sway = Math.sin(t * 0.7) * 4;
		k.drawPolygon({ pts: [v(x - 20, y - 20), v(x + 30 + sway, y - 20), v(x + 10 + sway, y + h + 20), v(x - 20, y + h + 20)], color: pal.red });
		k.drawPolygon({ pts: [v(x + w + 20, y - 20), v(x + w - 30 - sway, y - 20), v(x + w - 10 - sway, y + h + 20), v(x + w + 20, y + h + 20)], color: pal.red });
	}

	function portrait(px: number, py: number) {
		const x = 1100, y = 200, w = 120, h = 150;
		rect(x - 10, y - 10, w + 20, h + 20, pal.gold, { radius: 6 });
		rect(x, y, w, h, k.rgb(26, 22, 24));
		// Shadowy sitter
		k.drawEllipse({ pos: v(x + w / 2, y + h), radiusX: 46, radiusY: 50, color: k.rgb(40, 34, 36) });
		k.drawCircle({ pos: v(x + w / 2, y + 58), radius: 26, color: k.rgb(54, 46, 46) });
		// The eyes follow the player.
		const dir = v(px - (x + w / 2), py - (y + 55)).unit().scale(2.5);
		for (const ex of [-9, 9]) {
			k.drawCircle({ pos: v(x + w / 2 + ex, y + 55), radius: 4, color: k.rgb(170, 160, 140) });
			k.drawCircle({ pos: v(x + w / 2 + ex + dir.x, y + 55 + dir.y), radius: 2, color: k.BLACK });
		}
	}

	function hatch(t: number, open: boolean) {
		const { x, y, w, h } = HATCH;
		rect(x - 8, y - 8, w + 16, h + 8, pal.gold, { radius: [40, 40, 0, 0] });
		rect(x, y, w, h, k.rgb(4, 3, 6), { radius: [34, 34, 0, 0] });
		// Faint draught of light from the slide beyond
		const glow = 0.12 + 0.05 * Math.sin(t * 2) + (open ? 0.1 : 0);
		k.drawRect({ pos: v(x + 8, y + 20), width: w - 16, height: h - 20, color: pal.moon, opacity: glow, radius: [28, 28, 0, 0] });
		// Slide lip
		k.drawPolygon({ pts: [v(x + 6, y + h), v(x + w - 6, y + h), v(x + w - 20, y + h - 30), v(x + 20, y + h - 30)], color: pal.yellow, opacity: 0.6 });
	}

	function chandelier(t: number) {
		const ax = 900, ay = CEIL_Y;
		const swing = Math.sin(t * 0.9) * 0.05;
		const len = 150;
		const cx = ax + Math.sin(swing) * len, cy = ay + Math.cos(swing) * len;
		k.drawLine({ p1: v(ax, ay), p2: v(cx, cy), width: 3, color: pal.gold });
		k.drawEllipse({ pos: v(cx, cy + 10), radiusX: 70, radiusY: 14, color: pal.gold, fill: false, outline: { width: 4, color: pal.gold } });
		k.drawCircle({ pos: v(cx, cy + 6), radius: 10, color: pal.gold });
		for (let i = -3; i <= 3; i++) {
			const fx = cx + i * 22, fy = cy + 4 - Math.abs(i) * 2;
			rect(fx - 3, fy - 14, 6, 14, pal.linen);
			const flick = 0.6 + 0.4 * Math.sin(t * 13 + i * 2.1) * Math.sin(t * 7.3 + i);
			k.drawCircle({ pos: v(fx, fy - 20), radius: 14, color: pal.flame, opacity: 0.12 * flick });
			k.drawEllipse({ pos: v(fx, fy - 19), radiusX: 3, radiusY: 6, color: pal.flame, opacity: 0.8 * flick + 0.2 });
		}
	}

	function sidePillars() {
		for (const [x0, x1] of [[0, WALL_L], [WALL_R, ROOM.w]] as const) {
			rect(x0, 0, x1 - x0, ROOM.h, pal.blueDark);
			for (let y = CEIL_Y; y < FLOOR_Y; y += 60) {
				rect(x0 + 4, y + 4, x1 - x0 - 8, 52, pal.blue, { radius: 18 });
			}
			// Turret cap
			const cx = (x0 + x1) / 2;
			k.drawPolygon({ pts: [v(x0 - 10, CEIL_Y + 10), v(x1 + 10, CEIL_Y + 10), v(cx, CEIL_Y - 70)], color: pal.yellowDark });
		}
	}

	function ceiling() {
		rect(0, 0, ROOM.w, CEIL_Y, pal.redDark);
		for (let x = 30; x < ROOM.w; x += 60) {
			k.drawCircle({ pos: v(x, CEIL_Y), radius: 30, color: pal.red, start: 0, end: 180 });
		}
	}

	function floor() {
		rect(0, FLOOR_Y, ROOM.w, ROOM.h - FLOOR_Y, pal.greenDark);
		for (let x = 0; x < ROOM.w; x += 120) {
			rect(x + 3, FLOOR_Y + 3, 114, 46, pal.green, { radius: 20 });
		}
	}

	function shelf(s: Rect) {
		rect(s.x, s.y, s.w, s.h, pal.wood);
		rect(s.x, s.y + s.h, s.w, 4, pal.woodDark);
		// Brackets
		for (const bx of [s.x + 20, s.x + s.w - 40]) {
			k.drawPolygon({ pts: [v(bx, s.y + s.h), v(bx + 20, s.y + s.h), v(bx + 20, s.y + s.h + 30)], color: pal.woodDark });
		}
	}

	function bed(s: Rect) {
		// Headboard and footboard (decor)
		rect(s.x - 14, s.y - 110, 24, s.h + 110, pal.woodDark, { radius: [10, 10, 0, 0] });
		k.drawCircle({ pos: v(s.x - 2, s.y - 116), radius: 10, color: pal.gold });
		rect(s.x + s.w - 10, s.y - 40, 20, s.h + 40, pal.woodDark, { radius: [8, 8, 0, 0] });
		// Mattress + blanket
		rect(s.x, s.y, s.w, 34, pal.linen, { radius: 8 });
		rect(s.x + 90, s.y + 4, s.w - 96, 44, pal.blue, { radius: 8 });
		rect(s.x, s.y + 34, s.w, s.h - 34, pal.wood);
		for (let x = s.x + 20; x < s.x + s.w - 20; x += 40) rect(x, s.y + 60, 20, 6, pal.woodDark);
	}

	function wardrobe(s: Rect) {
		rect(s.x - 8, s.y - 18, s.w + 16, 22, pal.woodDark, { radius: [12, 12, 0, 0] });
		rect(s.x, s.y, s.w, s.h, pal.wood);
		rect(s.x + 10, s.y + 14, s.w / 2 - 14, s.h - 60, pal.woodDark, { radius: 6 });
		rect(s.x + s.w / 2 + 4, s.y + 14, s.w / 2 - 14, s.h - 60, pal.woodDark, { radius: 6 });
		k.drawCircle({ pos: v(s.x + s.w / 2 - 10, s.y + s.h / 2), radius: 4, color: pal.gold });
		k.drawCircle({ pos: v(s.x + s.w / 2 + 10, s.y + s.h / 2), radius: 4, color: pal.gold });
		rect(s.x, s.y + s.h - 36, s.w, 6, pal.woodDark);
	}

	function rockingHorse(t: number) {
		const x = 760, y = FLOOR_Y;
		const rock = Math.sin(t * 0.6) * 0.06;
		k.pushTransform();
		k.pushTranslate(x, y - 6);
		k.pushRotate(k.rad2deg(rock));
		k.drawEllipse({ pos: v(0, 0), radiusX: 70, radiusY: 10, color: pal.woodDark, start: 180, end: 360, fill: false, outline: { width: 6, color: pal.woodDark } });
		k.drawLine({ p1: v(-30, -4), p2: v(-20, -50), width: 6, color: pal.woodDark });
		k.drawLine({ p1: v(30, -4), p2: v(20, -50), width: 6, color: pal.woodDark });
		k.drawEllipse({ pos: v(0, -60), radiusX: 40, radiusY: 18, color: pal.linenDark });
		k.drawPolygon({ pts: [v(28, -66), v(48, -110), v(66, -100), v(46, -60)], color: pal.linenDark });
		k.drawCircle({ pos: v(56, -100), radius: 3, color: k.BLACK });
		k.drawLine({ p1: v(-40, -64), p2: v(-58, -40), width: 5, color: pal.redDark });
		k.popTransform();
	}

	return { backWall, windowArt, portrait, hatch, chandelier, sidePillars, ceiling, floor, shelf, bed, wardrobe, rockingHorse };
}

export function drawItem(k: KAPLAYCtx, pal: Palette, kind: string, x: number, y: number, w: number, h: number, opacity = 1) {
	const v = k.vec2;
	const o = { opacity };
	if (kind === "chest") {
		k.drawRect({ pos: v(x, y), width: w, height: h, color: pal.red, radius: 4, ...o });
		k.drawRect({ pos: v(x, y), width: w, height: 18, color: pal.redDark, radius: [6, 6, 0, 0], ...o });
		k.drawRect({ pos: v(x, y + 26), width: w, height: 5, color: pal.gold, ...o });
		k.drawRect({ pos: v(x + w / 2 - 7, y + 14), width: 14, height: 16, color: pal.gold, radius: 3, ...o });
		k.drawText({ text: "ABC", pos: v(x + w / 2, y + h - 22), size: 16, anchor: "center", color: pal.yellow, ...o });
	} else if (kind === "stool") {
		k.drawRect({ pos: v(x, y), width: w, height: 14, color: pal.wood, radius: 5, ...o });
		k.drawRect({ pos: v(x + 4, y + 14), width: 8, height: h - 14, color: pal.woodDark, ...o });
		k.drawRect({ pos: v(x + w - 12, y + 14), width: 8, height: h - 14, color: pal.woodDark, ...o });
		k.drawRect({ pos: v(x + 8, y + h - 20), width: w - 16, height: 5, color: pal.woodDark, ...o });
	} else if (kind === "pillow") {
		k.drawRect({ pos: v(x, y), width: w, height: h, color: pal.linen, radius: 10, ...o });
		k.drawRect({ pos: v(x + 8, y + 6), width: w - 16, height: h - 12, color: pal.linenDark, radius: 6, opacity: 0.4 * opacity });
	}
}

/** The player: a child in a nightgown. Squashes and stretches with vertical speed. */
export function drawPlayer(k: KAPLAYCtx, pal: Palette, x: number, y: number, hw: number, hh: number, vy: number, facing: number, t: number) {
	const v = k.vec2;
	const stretch = Math.max(-0.25, Math.min(0.25, -vy / 3000));
	const sx = 1 - stretch * 0.7, sy = 1 + stretch;
	k.pushTransform();
	k.pushTranslate(x, y + hh);
	k.pushScale(sx, sy);
	// Gown
	const g = hh * 2 - 22;
	k.drawPolygon({ pts: [v(-hw - 1, 0), v(hw + 1, 0), v(hw - 5, -g), v(-hw + 5, -g)], color: pal.gown });
	// Head
	k.drawCircle({ pos: v(0, -g - 11), radius: 12, color: pal.skin });
	// Hair
	k.drawCircle({ pos: v(-facing * 3, -g - 16), radius: 11, color: k.rgb(52, 36, 28), start: 180, end: 360 });
	// Eyes (blink now and then)
	const blink = (t % 4) < 0.12;
	for (const ex of [-4, 4]) {
		k.drawRect({ pos: v(ex + facing * 3 - 1.5, -g - 12), width: 3, height: blink ? 1 : 4, color: k.rgb(20, 16, 16) });
	}
	k.popTransform();
}
