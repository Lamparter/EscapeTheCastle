/**
 * The room as a cut-away Victorian dollhouse room, like a cross-section of a real dollhouse:
 * wallpapered back wall, cornice and picture rail, side walls in perspective, sash windows,
 * skirting board, gilt trim on the cut edges of the box, and a photo-textured parquet floor.
 *
 * Walls/mouldings/windows are vector drawings (Canvas 2D, rendered once). The floor uses a real
 * CC0 photo texture. Each room has its own theme (wallpaper and colours), like the reference dollhouse.
 */

export const ART_RES = 1.5; // canvas pixels per world unit

export type WallpaperKind = "botanical";

export interface RoomTheme {
	wallpaper: WallpaperKind;
	/** Wallpaper ground and motif colours (already dark and desaturated). */
	ground: string;
	leaves: string[];
	fruit: string[];
	flowers: string[];
	vine: string;
	/** Painted plaster for ceiling and cornice. */
	plaster: string;
	/** Wood for skirting and picture rail. */
	wood: string;
	gilt: string;
}

export const THEMES: Record<string, RoomTheme> = {
	nursery: {
		wallpaper: "botanical",
		ground: "#1d2420",
		leaves: ["#34493a", "#41573f", "#2c3d33", "#4d5f45"],
		fruit: ["#6e3f2c", "#7d6a3c", "#5d3a3a"],
		flowers: ["#7a5c5c", "#6c6a7e", "#86724f"],
		vine: "#36432f",
		plaster: "#6f675a",
		wood: "#2e1d15",
		gilt: "#8a6a32",
	},
};

export interface RoomLayout {
	w: number;
	h: number;
	floorY: number;
	ceilY: number;
	wallL: number;
	wallR: number;
	/** How far above y=0 the art extends. */
	top: number;
	windows: { x: number; y: number; w: number; h: number; moon?: boolean }[];
	theme: RoomTheme;
	seed: number;
}

/** Ceiling band (seen from below) and where the cornice meets the wallpaper. */
export const CEILING_Y = 22;
export const SKIRTING_TOP = 628;

type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
	let s = seed >>> 0;
	return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function shade(hex: string, f: number, a = 1): string {
	const n = parseInt(hex.slice(1), 16);
	const m = (c: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f)));
	return `rgba(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)},${a})`;
}

function vgrad(ctx: Ctx, y0: number, y1: number, stops: [number, string][]) {
	const g = ctx.createLinearGradient(0, y0, 0, y1);
	for (const [o, c] of stops) g.addColorStop(o, c);
	return g;
}

// ---------------------------------------------------------------- wallpaper

function leaf(ctx: Ctx, x: number, y: number, len: number, wid: number, ang: number, col: string) {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(ang);
	ctx.fillStyle = col;
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
	ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
	ctx.fill();
	ctx.strokeStyle = shade(col, 1.25, 0.6);
	ctx.lineWidth = 0.6;
	ctx.beginPath();
	ctx.moveTo(len * 0.05, 0);
	ctx.lineTo(len * 0.9, 0);
	ctx.stroke();
	ctx.restore();
}

function flower(ctx: Ctx, x: number, y: number, r: number, col: string, centre: string) {
	ctx.fillStyle = col;
	for (let i = 0; i < 5; i++) {
		const a = (i / 5) * Math.PI * 2;
		ctx.beginPath();
		ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.fillStyle = centre;
	ctx.beginPath();
	ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
	ctx.fill();
}

function berries(ctx: Ctx, x: number, y: number, r: number, col: string, rand: () => number) {
	for (let i = 0; i < 5; i++) {
		const bx = x + (rand() - 0.5) * r * 3, by = y + (rand() - 0.5) * r * 3;
		const g = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.3, r * 0.1, bx, by, r);
		g.addColorStop(0, shade(col, 1.35));
		g.addColorStop(1, shade(col, 0.7));
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(bx, by, r, 0, Math.PI * 2);
		ctx.fill();
	}
}

/** One seamless tile of dense botanical wallpaper (in world units; drawn at ART_RES). */
function botanicalTile(theme: RoomTheme, seed: number): HTMLCanvasElement {
	const T = 120;
	const c = document.createElement("canvas");
	c.width = c.height = Math.round(T * ART_RES);
	const ctx = c.getContext("2d")!;
	ctx.scale(ART_RES, ART_RES);
	ctx.fillStyle = theme.ground;
	ctx.fillRect(0, 0, T, T);
	const rand = rng(seed);
	// Draw every motif at its position and wrapped copies so the tile repeats seamlessly.
	const wrap = (fn: (ox: number, oy: number) => void) => {
		for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) fn(ox, oy);
	};
	const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
	// Trailing vines
	for (let i = 0; i < 7; i++) {
		const x0 = rand() * T, y0 = rand() * T, x1 = x0 + 40 + rand() * 40, y1 = y0 + (rand() - 0.5) * 60;
		const cx = (x0 + x1) / 2 + (rand() - 0.5) * 40, cy = (y0 + y1) / 2 + (rand() - 0.5) * 40;
		wrap((ox, oy) => {
			ctx.strokeStyle = theme.vine;
			ctx.lineWidth = 1.4;
			ctx.beginPath();
			ctx.moveTo(x0 + ox, y0 + oy);
			ctx.quadraticCurveTo(cx + ox, cy + oy, x1 + ox, y1 + oy);
			ctx.stroke();
		});
	}
	// Big leaves, then fruit and flowers on top: dense, all-over, like a Morris-style print
	const motifs: (() => void)[] = [];
	for (let i = 0; i < 70; i++) {
		const x = rand() * T, y = rand() * T, len = 10 + rand() * 16, wid = len * (0.28 + rand() * 0.12), ang = rand() * Math.PI * 2, col = pick(theme.leaves);
		motifs.push(() => wrap((ox, oy) => leaf(ctx, x + ox, y + oy, len, wid, ang, col)));
	}
	for (let i = 0; i < 12; i++) {
		const x = rand() * T, y = rand() * T, col = pick(theme.fruit), s = rand() * 1e9;
		motifs.push(() => wrap((ox, oy) => berries(ctx, x + ox, y + oy, 3, col, rng(s))));
	}
	for (let i = 0; i < 16; i++) {
		const x = rand() * T, y = rand() * T, col = pick(theme.flowers), r = 4.5 + rand() * 3.5;
		motifs.push(() => wrap((ox, oy) => flower(ctx, x + ox, y + oy, r, col, theme.fruit[1])));
	}
	for (const m of motifs) m();
	return c;
}

// ---------------------------------------------------------------- architecture

function cornice(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, theme: RoomTheme) {
	const h = y1 - y0;
	const p = theme.plaster;
	// Cove (curved plaster), dentils, egg-and-dart, bottom fillet
	ctx.fillStyle = vgrad(ctx, y0, y0 + h * 0.4, [[0, shade(p, 0.55)], [0.6, shade(p, 1.05)], [1, shade(p, 0.75)]]);
	ctx.fillRect(x0, y0, x1 - x0, h * 0.4);
	ctx.fillStyle = shade(p, 0.6);
	ctx.fillRect(x0, y0 + h * 0.4, x1 - x0, h * 0.06);
	const dy = y0 + h * 0.46, dh = h * 0.2;
	ctx.fillStyle = shade(p, 0.45);
	ctx.fillRect(x0, dy, x1 - x0, dh);
	for (let x = x0 + 2; x < x1; x += 10) {
		ctx.fillStyle = vgrad(ctx, dy, dy + dh, [[0, shade(p, 1.1)], [1, shade(p, 0.75)]]);
		ctx.fillRect(x, dy, 6, dh - 1);
	}
	const ey = y0 + h * 0.66, eh = h * 0.2;
	ctx.fillStyle = shade(p, 0.5);
	ctx.fillRect(x0, ey, x1 - x0, eh);
	for (let x = x0 + 6; x < x1; x += 14) {
		const g = ctx.createRadialGradient(x - 1, ey + eh * 0.35, 0.5, x, ey + eh * 0.5, eh * 0.55);
		g.addColorStop(0, shade(p, 1.15));
		g.addColorStop(1, shade(p, 0.65));
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.ellipse(x, ey + eh * 0.5, 4.2, eh * 0.42, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = shade(p, 0.4);
		ctx.beginPath();
		ctx.moveTo(x + 6, ey + 1);
		ctx.lineTo(x + 7.5, ey + eh * 0.9);
		ctx.lineTo(x + 9, ey + 1);
		ctx.fill();
	}
	ctx.fillStyle = vgrad(ctx, y0 + h * 0.86, y1, [[0, shade(p, 1.05)], [1, shade(p, 0.55)]]);
	ctx.fillRect(x0, y0 + h * 0.86, x1 - x0, h * 0.14);
	// Shadow cast onto the wallpaper below
	ctx.fillStyle = vgrad(ctx, y1, y1 + 26, [[0, "rgba(0,0,0,0.55)"], [1, "rgba(0,0,0,0)"]]);
	ctx.fillRect(x0, y1, x1 - x0, 26);
}

function woodBand(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, wood: string, bead = true) {
	ctx.fillStyle = vgrad(ctx, y0, y1, [[0, shade(wood, 1.5)], [0.15, shade(wood, 1.15)], [0.7, wood], [1, shade(wood, 0.5)]]);
	ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
	if (bead) {
		ctx.fillStyle = vgrad(ctx, y0 - 4, y0 + 1, [[0, shade(wood, 1.7)], [1, shade(wood, 0.6)]]);
		ctx.fillRect(x0, y0 - 4, x1 - x0, 5);
	}
	// Faint grain
	ctx.strokeStyle = shade(wood, 0.7, 0.35);
	ctx.lineWidth = 0.5;
	for (let y = y0 + 3; y < y1 - 2; y += 3.5) {
		ctx.beginPath();
		ctx.moveTo(x0, y);
		for (let x = x0; x <= x1; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.013 + y) * 0.8);
		ctx.stroke();
	}
}

function sashWindow(ctx: Ctx, win: RoomLayout["windows"][number], theme: RoomTheme, rand: () => number) {
	const { x, y, w, h } = win;
	const left = x - w / 2, r = w / 2;
	const arch = (inset: number) => {
		ctx.beginPath();
		ctx.moveTo(left + inset, y + h - inset);
		ctx.lineTo(left + inset, y + r);
		ctx.arc(x, y + r, r - inset, Math.PI, 0);
		ctx.lineTo(left + w - inset, y + h - inset);
		ctx.closePath();
	};
	// Moulded architrave around the opening
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.6)";
	ctx.shadowBlur = 10;
	ctx.shadowOffsetY = 4;
	arch(-12);
	ctx.fillStyle = shade(theme.plaster, 0.85);
	ctx.fill();
	ctx.restore();
	arch(-6);
	ctx.fillStyle = shade(theme.plaster, 0.6);
	ctx.fill();
	// Night outside
	ctx.save();
	arch(0);
	ctx.clip();
	ctx.fillStyle = vgrad(ctx, y, y + h, [[0, "#0b1020"], [1, "#04050a"]]);
	ctx.fillRect(left, y, w, h);
	if (win.moon) {
		const mx = x + w * 0.2, my = y + h * 0.26;
		const glow = ctx.createRadialGradient(mx, my, 4, mx, my, 70);
		glow.addColorStop(0, "rgba(170,190,220,0.35)");
		glow.addColorStop(1, "rgba(170,190,220,0)");
		ctx.fillStyle = glow;
		ctx.fillRect(left, y, w, h);
		ctx.fillStyle = "rgba(195,208,228,0.8)";
		ctx.beginPath(); ctx.arc(mx, my, 15, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "#0a0e1c";
		ctx.beginPath(); ctx.arc(mx + 7, my - 4, 14, 0, Math.PI * 2); ctx.fill();
	}
	// Bare branches outside
	ctx.strokeStyle = "rgba(10,10,14,0.95)";
	for (let i = 0; i < 3; i++) {
		let bx = left + rand() * w, by = y + h;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(bx, by);
		for (let s = 0; s < 6; s++) {
			bx += (rand() - 0.5) * 30;
			by -= 20 + rand() * 20;
			ctx.lineTo(bx, by);
			ctx.lineWidth = Math.max(0.8, 3 - s * 0.4);
		}
		ctx.stroke();
	}
	// Reflection on the glass
	ctx.fillStyle = "rgba(255,255,255,0.03)";
	ctx.beginPath();
	ctx.moveTo(left, y + h * 0.7);
	ctx.lineTo(left + w * 0.6, y);
	ctx.lineTo(left + w * 0.8, y);
	ctx.lineTo(left + w * 0.2, y + h);
	ctx.fill();
	ctx.restore();
	// Sash frame and glazing bars (painted wood)
	const bar = shade(theme.plaster, 0.7);
	ctx.strokeStyle = bar;
	ctx.lineWidth = 5;
	arch(2);
	ctx.stroke();
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x, y + h);
	for (const f of [0.55, 0.78]) {
		ctx.moveTo(left, y + r + (h - r) * f - 20);
		ctx.lineTo(left + w, y + r + (h - r) * f - 20);
	}
	for (const a of [Math.PI * 0.75, Math.PI * 0.25]) {
		ctx.moveTo(x, y + r);
		ctx.lineTo(x + Math.cos(a) * r, y + r - Math.sin(a) * r);
	}
	ctx.moveTo(left, y + r);
	ctx.lineTo(left + w, y + r);
	ctx.stroke();
	ctx.lineWidth = 6;
	ctx.strokeStyle = shade(theme.plaster, 0.85);
	ctx.beginPath();
	ctx.moveTo(left, y + h * 0.62);
	ctx.lineTo(left + w, y + h * 0.62);
	ctx.stroke();
	// Sill
	ctx.fillStyle = vgrad(ctx, y + h, y + h + 12, [[0, shade(theme.plaster, 1.0)], [1, shade(theme.plaster, 0.45)]]);
	ctx.fillRect(left - 18, y + h, w + 36, 12);
}

function sideWall(ctx: Ctx, L: RoomLayout, pattern: CanvasPattern, side: "left" | "right") {
	// Seen in perspective: the front edge (x=0) is full height, the back corner (x=wallL) meets the back wall.
	const front = side === "left" ? 0 : L.w;
	const back = side === "left" ? L.wallL : L.wallR;
	const top0 = -L.top + 40, bot0 = L.h;
	const top1 = CEILING_Y + 10, bot1 = SKIRTING_TOP + 30;
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(front, top0);
	ctx.lineTo(back, top1);
	ctx.lineTo(back, bot1);
	ctx.lineTo(front, bot0);
	ctx.closePath();
	ctx.clip();
	ctx.fillStyle = pattern;
	ctx.fillRect(Math.min(front, back), top0, Math.abs(back - front), bot0 - top0);
	// Darker than the back wall, darkest towards the open front
	const g = ctx.createLinearGradient(front, 0, back, 0);
	g.addColorStop(0, "rgba(0,0,0,0.85)");
	g.addColorStop(1, "rgba(0,0,0,0.45)");
	ctx.fillStyle = g;
	ctx.fillRect(Math.min(front, back), top0, Math.abs(back - front), bot0 - top0);
	ctx.restore();
	// Corner shadow where the side wall meets the back wall
	const cg = ctx.createLinearGradient(back, 0, back + (side === "left" ? 40 : -40), 0);
	cg.addColorStop(0, "rgba(0,0,0,0.5)");
	cg.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = cg;
	ctx.fillRect(side === "left" ? back : back - 40, top1, 40, bot1 - top1);
}

/** Gilt trim along the cut edge of the dollhouse box (like the gold-edged rooms in a real dollhouse). */
function giltStrip(ctx: Ctx, x: number, y: number, w: number, h: number, gilt: string, vertical = false) {
	const g = vertical ? ctx.createLinearGradient(x, 0, x + w, 0) : ctx.createLinearGradient(0, y, 0, y + h);
	g.addColorStop(0, shade(gilt, 0.5));
	g.addColorStop(0.35, shade(gilt, 1.6));
	g.addColorStop(0.55, shade(gilt, 1.05));
	g.addColorStop(1, shade(gilt, 0.45));
	ctx.fillStyle = g;
	ctx.fillRect(x, y, w, h);
}

/**
 * Back wall, ceiling, cornice, side walls, windows and box trim. Canvas y=0 is world y=-top.
 */
export function buildRoomCanvas(L: RoomLayout): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = Math.ceil(L.w * ART_RES);
	c.height = Math.ceil((L.h + L.top) * ART_RES);
	const ctx = c.getContext("2d")!;
	ctx.scale(ART_RES, ART_RES);
	ctx.translate(0, L.top);
	const T = L.theme;
	const rand = rng(L.seed);

	ctx.fillStyle = "#060509";
	ctx.fillRect(0, -L.top, L.w, L.h + L.top);

	// Wallpaper
	const tile = botanicalTile(T, L.seed);
	const pattern = ctx.createPattern(tile, "repeat")!;
	pattern.setTransform(new DOMMatrix().scale(1 / ART_RES));
	ctx.fillStyle = pattern;
	ctx.fillRect(L.wallL, CEILING_Y, L.wallR - L.wallL, SKIRTING_TOP - CEILING_Y + 40);
	// Wallpaper roll seams and paper sheen
	for (let x = L.wallL + 53; x < L.wallR; x += 106) {
		ctx.fillStyle = "rgba(0,0,0,0.18)";
		ctx.fillRect(x, CEILING_Y, 1, SKIRTING_TOP - CEILING_Y);
	}
	ctx.fillStyle = vgrad(ctx, CEILING_Y, SKIRTING_TOP, [[0, "rgba(0,0,0,0.45)"], [0.35, "rgba(0,0,0,0.05)"], [0.8, "rgba(0,0,0,0.1)"], [1, "rgba(0,0,0,0.5)"]]);
	ctx.fillRect(L.wallL, CEILING_Y, L.wallR - L.wallL, SKIRTING_TOP - CEILING_Y);

	// Picture rail
	woodBand(ctx, L.wallL, L.wallR, L.ceilY + 34, L.ceilY + 41, T.wood, false);

	// Windows
	for (const win of L.windows) sashWindow(ctx, win, T, rand);

	// Ceiling (seen slightly from below) with a ceiling rose above the chandelier
	ctx.fillStyle = vgrad(ctx, -24, CEILING_Y + 6, [[0, shade(T.plaster, 0.25)], [1, shade(T.plaster, 0.7)]]);
	ctx.fillRect(0, -24, L.w, CEILING_Y + 30);
	cornice(ctx, L.wallL, L.wallR, CEILING_Y + 4, L.ceilY, T);

	// Skirting board
	woodBand(ctx, L.wallL, L.wallR, SKIRTING_TOP, SKIRTING_TOP + 34, T.wood);

	// Side walls in perspective (drawn over the back wall's edges)
	sideWall(ctx, L, pattern, "left");
	sideWall(ctx, L, pattern, "right");

	// The dollhouse box: floor slab of the room above, and gilt trim on the cut edges
	ctx.fillStyle = vgrad(ctx, -L.top, -24, [[0, "#050406"], [1, shade(T.wood, 0.8)]]);
	ctx.fillRect(0, -L.top, L.w, L.top - 24);
	giltStrip(ctx, 0, -30, L.w, 8, T.gilt);
	giltStrip(ctx, 0, -L.top, 9, L.h + L.top, T.gilt, true);
	giltStrip(ctx, L.w - 9, -L.top, 9, L.h + L.top, T.gilt, true);
	return c;
}

/**
 * The floor: a photo-textured parquet surface seen at a slight angle, and the front face of the
 * floor slab with gilt trim. Sliced into strips in-game so it can ripple. Canvas y=0 is world floorY - FLOOR_ART_OFFSET.
 */
export const FLOOR_ART_OFFSET = 48;
export const FLOOR_ART_HEIGHT = 140;

export function buildFloorCanvas(L: RoomLayout, parquet: HTMLImageElement): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = Math.ceil(L.w * ART_RES);
	c.height = Math.ceil(FLOOR_ART_HEIGHT * ART_RES);
	const ctx = c.getContext("2d")!;
	ctx.scale(ART_RES, ART_RES);
	const top = 0;                       // back edge of the floor (meets the skirting)
	const front = FLOOR_ART_OFFSET + 8;  // front edge of the floor surface
	const slab = 34;                     // thickness of the floor slab's front face

	// Parquet surface: tiled photo, squashed vertically for the viewing angle
	const tileW = 110, tileH = tileW * (parquet.height / parquet.width) * 0.42;
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, top, L.w, front - top);
	ctx.clip();
	for (let x = 0; x < L.w; x += tileW) {
		for (let y = top - tileH * 0.3; y < front; y += tileH) ctx.drawImage(parquet, x, y, tileW, tileH);
	}
	// Dark, warm grade to sit in the night-time room; darker towards the back wall
	ctx.fillStyle = "rgba(20,10,4,0.2)";
	ctx.fillRect(0, top, L.w, front - top);
	ctx.fillStyle = vgrad(ctx, top, front, [[0, "rgba(0,0,0,0.7)"], [0.35, "rgba(0,0,0,0.12)"], [1, "rgba(0,0,0,0)"]]);
	ctx.fillRect(0, top, L.w, front - top);
	ctx.restore();

	// Front face of the floor slab (end grain), with gilt trim on its upper edge
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, front, L.w, slab);
	ctx.clip();
	for (let x = 0; x < L.w; x += tileW) ctx.drawImage(parquet, x, front, tileW, tileW * (parquet.height / parquet.width));
	ctx.fillStyle = "rgba(15,7,3,0.7)";
	ctx.fillRect(0, front, L.w, slab);
	ctx.restore();
	giltStrip(ctx, 0, front, L.w, 6, L.theme.gilt);
	ctx.fillStyle = vgrad(ctx, front + slab, FLOOR_ART_HEIGHT, [[0, "#0a0807"], [1, "#060509"]]);
	ctx.fillRect(0, front + slab, L.w, FLOOR_ART_HEIGHT - front - slab);
	return c;
}
