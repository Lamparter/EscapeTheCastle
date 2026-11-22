/**
 * Procedural vector art for the inside of a bouncy castle, rendered once to offscreen canvases
 * (Canvas 2D gives us soft gradients with alpha, which KAPLAY's shape drawing can't do).
 *
 * Modelled on real inflatable castles: stacked horizontal air tubes on the walls, thick ringed
 * corner columns with turret caps, inflated battlements along the top, mesh-netting windows,
 * and a pillowy, baffled floor with a rounded front bolster. Every tube gets cylinder shading
 * plus a glossy vinyl highlight. Colours stay dark and desaturated for the horror mood.
 */

export const ART_RES = 1.5; // canvas pixels per world unit

export interface CastleLayout {
	w: number;
	h: number;
	floorY: number;
	ceilY: number;
	wallL: number;
	wallR: number;
	/** How far above y=0 the art extends (turret caps, canopy). */
	top: number;
	/** Mesh windows in the back wall: centre x, top y, width, height. */
	windows: { x: number; y: number; w: number; h: number; moon?: boolean }[];
	/** x positions of the vertical buttress tubes in the back wall. */
	buttresses: number[];
	seed: number;
}

const VINYL = {
	red: "#6a2c33",
	blue: "#2a3a63",
	yellow: "#7a6630",
	green: "#2a5a42",
	purple: "#4a2f5a",
};

// ---------- colour helpers ----------
function hexToRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex: string, f: number, a = 1): string {
	const [r, g, b] = hexToRgb(hex);
	const m = (c: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? c + (255 - c) * (f - 1) : c * f)));
	return `rgba(${m(r)},${m(g)},${m(b)},${a})`;
}
function rng(seed: number) {
	let s = seed >>> 0;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

/** A horizontal air tube: lit from above, with a glossy streak and a dark pinch at its seams. */
function tubeH(ctx: Ctx, x: number, y: number, w: number, h: number, col: string, endR = 0) {
	const g = ctx.createLinearGradient(0, y, 0, y + h);
	g.addColorStop(0, shade(col, 0.45));
	g.addColorStop(0.22, shade(col, 1.22));
	g.addColorStop(0.5, shade(col, 1.0));
	g.addColorStop(0.85, shade(col, 0.6));
	g.addColorStop(1, shade(col, 0.32));
	ctx.fillStyle = g;
	roundRect(ctx, x, y, w, h, endR || h * 0.18);
	ctx.fill();
	// Glossy vinyl highlight
	const hy = y + h * 0.24;
	const hg = ctx.createLinearGradient(0, hy - h * 0.07, 0, hy + h * 0.07);
	hg.addColorStop(0, "rgba(255,255,255,0)");
	hg.addColorStop(0.5, "rgba(255,240,220,0.16)");
	hg.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = hg;
	roundRect(ctx, x + Math.min(w * 0.06, 20), hy - h * 0.07, w - Math.min(w * 0.12, 40), h * 0.14, h * 0.07);
	ctx.fill();
}

/** A vertical cylinder (column/buttress): lit from the upper left. */
function tubeV(ctx: Ctx, x: number, y: number, w: number, h: number, col: string, r: number | number[] = w * 0.2) {
	const g = ctx.createLinearGradient(x, 0, x + w, 0);
	g.addColorStop(0, shade(col, 0.3));
	g.addColorStop(0.28, shade(col, 1.25));
	g.addColorStop(0.5, shade(col, 1.0));
	g.addColorStop(0.82, shade(col, 0.55));
	g.addColorStop(1, shade(col, 0.25));
	ctx.fillStyle = g;
	roundRect(ctx, x, y, w, h, r);
	ctx.fill();
	const hx = x + w * 0.3;
	const hg = ctx.createLinearGradient(hx - w * 0.06, 0, hx + w * 0.06, 0);
	hg.addColorStop(0, "rgba(255,255,255,0)");
	hg.addColorStop(0.5, "rgba(255,240,220,0.14)");
	hg.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = hg;
	ctx.fillRect(hx - w * 0.06, y + 6, w * 0.12, h - 12);
}

/** Soft shadow band (for seams and contact shadows). */
function softShadow(ctx: Ctx, x: number, y: number, w: number, h: number, dir: "down" | "up" | "right" | "left", a = 0.55) {
	const g = dir === "down" || dir === "up"
		? ctx.createLinearGradient(0, dir === "down" ? y : y + h, 0, dir === "down" ? y + h : y)
		: ctx.createLinearGradient(dir === "right" ? x : x + w, 0, dir === "right" ? x + w : x, 0);
	g.addColorStop(0, `rgba(0,0,0,${a})`);
	g.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = g;
	ctx.fillRect(x, y, w, h);
}

/** Row of stitch dots along a seam. */
function stitches(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, gap = 9) {
	const len = Math.hypot(x1 - x0, y1 - y0);
	ctx.fillStyle = "rgba(0,0,0,0.35)";
	for (let d = gap / 2; d < len; d += gap) {
		const t = d / len;
		ctx.beginPath();
		ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1.1, 0, Math.PI * 2);
		ctx.fill();
	}
}

function meshWindow(ctx: Ctx, win: CastleLayout["windows"][number], rimCol: string, rand: () => number) {
	const { x, y, w, h } = win;
	const left = x - w / 2, r = w / 2;
	const path = () => {
		ctx.beginPath();
		ctx.moveTo(left, y + h);
		ctx.lineTo(left, y + r);
		ctx.arc(x, y + r, r, Math.PI, 0);
		ctx.lineTo(left + w, y + h);
		ctx.closePath();
	};
	// Night outside
	ctx.save();
	path();
	ctx.clip();
	const sky = ctx.createLinearGradient(0, y, 0, y + h);
	sky.addColorStop(0, "#0c1020");
	sky.addColorStop(1, "#05060a");
	ctx.fillStyle = sky;
	ctx.fillRect(left, y, w, h);
	if (win.moon) {
		const mx = x + w * 0.18, my = y + h * 0.28;
		const glow = ctx.createRadialGradient(mx, my, 4, mx, my, 70);
		glow.addColorStop(0, "rgba(170,190,220,0.35)");
		glow.addColorStop(1, "rgba(170,190,220,0)");
		ctx.fillStyle = glow;
		ctx.fillRect(left, y, w, h);
		ctx.fillStyle = "rgba(190,205,225,0.75)";
		ctx.beginPath(); ctx.arc(mx, my, 16, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = "#0b0f1d";
		ctx.beginPath(); ctx.arc(mx + 7, my - 4, 15, 0, Math.PI * 2); ctx.fill();
	}
	// Distant fog
	for (let i = 0; i < 5; i++) {
		const fx = left + rand() * w, fy = y + h * (0.55 + rand() * 0.4);
		const fg = ctx.createRadialGradient(fx, fy, 2, fx, fy, 60);
		fg.addColorStop(0, "rgba(120,130,150,0.12)");
		fg.addColorStop(1, "rgba(120,130,150,0)");
		ctx.fillStyle = fg;
		ctx.fillRect(left, y, w, h);
	}
	// Netting (diamond mesh), slightly sagging
	ctx.strokeStyle = "rgba(150,140,90,0.45)";
	ctx.lineWidth = 1.6;
	const step = 16;
	for (let d = -h; d < w + h; d += step) {
		ctx.beginPath();
		for (let t = 0; t <= 1.001; t += 0.1) {
			const yy = y + t * h;
			const xx = left + d + t * h * 0.9 + Math.sin(t * Math.PI) * 3;
			if (t === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
		}
		ctx.stroke();
		ctx.beginPath();
		for (let t = 0; t <= 1.001; t += 0.1) {
			const yy = y + t * h;
			const xx = left + d - t * h * 0.9 + Math.sin(t * Math.PI) * 3;
			if (t === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
		}
		ctx.stroke();
	}
	softShadow(ctx, left, y, w, 26, "down", 0.6);
	ctx.restore();
	// Inflated rim tube around the opening
	path();
	ctx.lineJoin = "round";
	ctx.strokeStyle = shade(rimCol, 0.35);
	ctx.lineWidth = 24;
	ctx.stroke();
	ctx.strokeStyle = shade(rimCol, 0.95);
	ctx.lineWidth = 17;
	ctx.stroke();
	ctx.save();
	ctx.translate(-2.5, -3);
	path();
	ctx.strokeStyle = "rgba(255,240,220,0.12)";
	ctx.lineWidth = 4;
	ctx.stroke();
	ctx.restore();
}

/**
 * Back wall, roof canopy, battlements and corner columns. Drawn in world units with y offset
 * by `layout.top`, i.e. canvas y=0 is world y=-top.
 */
export function buildRoomCanvas(L: CastleLayout): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = Math.ceil(L.w * ART_RES);
	c.height = Math.ceil((L.h + L.top) * ART_RES);
	const ctx = c.getContext("2d")!;
	ctx.scale(ART_RES, ART_RES);
	ctx.translate(0, L.top);
	const rand = rng(L.seed);

	// Darkness behind everything
	ctx.fillStyle = "#060509";
	ctx.fillRect(0, -L.top, L.w, L.h + L.top);

	// --- Back wall: stacked horizontal tubes between buttresses ---
	const wallTop = L.ceilY - 30;
	const rowH = 64;
	const bands = [VINYL.red, VINYL.blue, VINYL.red, VINYL.yellow, VINYL.blue, VINYL.red, VINYL.green, VINYL.blue, VINYL.red, VINYL.yellow];
	const cols = [L.wallL - 10, ...L.buttresses, L.wallR + 10];
	for (let p = 0; p < cols.length - 1; p++) {
		const x0 = cols[p], x1 = cols[p + 1];
		let row = 0;
		for (let y = wallTop; y < L.floorY + 20; y += rowH, row++) {
			const col = bands[(row + p * 3) % bands.length];
			// Each tube bulges a touch in the middle of its panel
			tubeH(ctx, x0, y, x1 - x0, rowH + 2, col, 10);
			stitches(ctx, x0 + 8, y + 1, x1 - 8, y + 1);
		}
		// Panel depth: shadows cast by the buttresses on either side
		softShadow(ctx, x0, wallTop, 34, L.floorY - wallTop, "right", 0.6);
		softShadow(ctx, x1 - 34, wallTop, 34, L.floorY - wallTop, "left", 0.6);
	}

	// Mesh windows (behind the buttresses' shadows, in front of the tubes)
	for (const win of L.windows) meshWindow(ctx, win, VINYL.yellow, rand);

	// Buttress tubes
	for (const bx of L.buttresses) {
		tubeV(ctx, bx - 26, wallTop - 10, 52, L.floorY - wallTop + 20, VINYL.blue, 26);
		for (let y = wallTop + 70; y < L.floorY; y += 90) {
			ctx.fillStyle = "rgba(0,0,0,0.35)";
			ctx.fillRect(bx - 24, y, 48, 3);
			stitches(ctx, bx - 22, y + 5, bx + 22, y + 5, 7);
		}
	}

	// Contact shadow where the wall meets the floor
	softShadow(ctx, 0, L.floorY - 60, L.w, 60, "up", 0.55);

	// --- Roof canopy with scalloped valance ---
	const can = ctx.createLinearGradient(0, -L.top, 0, L.ceilY - 30);
	can.addColorStop(0, "#08070b");
	can.addColorStop(1, shade(VINYL.purple, 0.55));
	ctx.fillStyle = can;
	ctx.fillRect(0, -L.top, L.w, L.ceilY - 30 + L.top);
	// Canopy fabric folds
	for (let x = 0; x < L.w; x += 140) {
		const fg = ctx.createLinearGradient(x, 0, x + 140, 0);
		fg.addColorStop(0, "rgba(0,0,0,0.35)");
		fg.addColorStop(0.5, "rgba(255,255,255,0.03)");
		fg.addColorStop(1, "rgba(0,0,0,0.35)");
		ctx.fillStyle = fg;
		ctx.fillRect(x, -L.top, 140, L.ceilY - 30 + L.top);
	}

	// --- Battlements: merlons (inflated blocks) on top of a thick rail tube ---
	const railY = L.ceilY - 44, railH = 46;
	for (let x = L.wallL - 30, i = 0; x < L.wallR + 30; x += 96, i++) {
		tubeV(ctx, x + 8, railY - 58, 64, 70, i % 2 ? VINYL.yellow : VINYL.red, [26, 26, 6, 6]);
	}
	tubeH(ctx, 0, railY, L.w, railH, VINYL.blue, 22);
	stitches(ctx, 0, railY + railH - 4, L.w, railH + railY - 4);
	softShadow(ctx, 0, railY + railH, L.w, 34, "down", 0.6);
	// Scalloped valance hanging from the rail
	for (let x = 0, i = 0; x < L.w; x += 48, i++) {
		const col = i % 2 ? VINYL.red : VINYL.yellow;
		const g = ctx.createRadialGradient(x + 18, railY + railH, 2, x + 24, railY + railH, 26);
		g.addColorStop(0, shade(col, 1.1));
		g.addColorStop(1, shade(col, 0.4));
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x + 24, railY + railH - 2, 24, 0, Math.PI);
		ctx.fill();
	}

	// --- Corner columns with ring segments and turret caps ---
	for (const [x0, x1] of [[0, L.wallL], [L.wallR, L.w]] as const) {
		const w = x1 - x0 + 30, x = x0 - (x0 === 0 ? 30 : 0);
		const colTop = L.ceilY - 120;
		for (let y = colTop, i = 0; y < L.floorY + 40; y += 78, i++) {
			tubeV(ctx, x, y, w, 82, i % 2 ? VINYL.blue : VINYL.green, 30);
			stitches(ctx, x + 6, y + 80, x + w - 6, y + 80, 7);
		}
		// Turret: cone cap with a ball finial
		const cx = x + w / 2, by = colTop + 6;
		const cg = ctx.createLinearGradient(cx - w * 0.75, 0, cx + w * 0.75, 0);
		cg.addColorStop(0, shade(VINYL.red, 0.3));
		cg.addColorStop(0.35, shade(VINYL.red, 1.2));
		cg.addColorStop(1, shade(VINYL.red, 0.3));
		ctx.fillStyle = cg;
		ctx.beginPath();
		ctx.moveTo(cx - w * 0.75, by);
		ctx.quadraticCurveTo(cx - w * 0.2, by - 50, cx, by - 130);
		ctx.quadraticCurveTo(cx + w * 0.2, by - 50, cx + w * 0.75, by);
		ctx.quadraticCurveTo(cx, by + 14, cx - w * 0.75, by);
		ctx.fill();
		const bg = ctx.createRadialGradient(cx - 5, by - 140, 1, cx, by - 136, 13);
		bg.addColorStop(0, shade(VINYL.yellow, 1.4));
		bg.addColorStop(1, shade(VINYL.yellow, 0.4));
		ctx.fillStyle = bg;
		ctx.beginPath(); ctx.arc(cx, by - 136, 12, 0, Math.PI * 2); ctx.fill();
	}

	return c;
}

/**
 * The floor's front bolster: pillowy baffled sections. Drawn separately so the game can slice it
 * into strips and make it ripple when things land on it. Canvas y=0 is world floorY - 14.
 */
export const FLOOR_ART_OFFSET = 14;
export const FLOOR_ART_HEIGHT = 130;

export function buildFloorCanvas(L: CastleLayout): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = Math.ceil(L.w * ART_RES);
	c.height = Math.ceil(FLOOR_ART_HEIGHT * ART_RES);
	const ctx = c.getContext("2d")!;
	ctx.scale(ART_RES, ART_RES);
	const top = FLOOR_ART_OFFSET; // world floorY
	const cols = [VINYL.red, VINYL.blue, VINYL.yellow, VINYL.blue, VINYL.red, VINYL.green];
	const segW = 128;
	const bodyH = 66;

	// Underside fading into darkness
	const under = ctx.createLinearGradient(0, top + bodyH - 10, 0, FLOOR_ART_HEIGHT);
	under.addColorStop(0, "rgba(10,8,14,1)");
	under.addColorStop(1, "rgba(6,5,9,1)");
	ctx.fillStyle = under;
	ctx.fillRect(0, top + bodyH - 10, L.w, FLOOR_ART_HEIGHT);

	for (let x = -segW / 2, i = 0; x < L.w + segW; x += segW, i++) {
		const col = cols[i % cols.length];
		// Pillow body: rounded on every side, bulging upward a little above the walk line
		const g = ctx.createLinearGradient(0, top - 12, 0, top + bodyH);
		g.addColorStop(0, shade(col, 1.25));
		g.addColorStop(0.18, shade(col, 1.05));
		g.addColorStop(0.55, shade(col, 0.8));
		g.addColorStop(1, shade(col, 0.3));
		ctx.fillStyle = g;
		roundRect(ctx, x + 2, top - 10, segW - 4, bodyH + 10, [26, 26, 18, 18]);
		ctx.fill();
		// Radial sheen where light hits the bulge
		const sx = x + segW * 0.42, sy = top + 6;
		const sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, segW * 0.45);
		sg.addColorStop(0, "rgba(255,240,220,0.16)");
		sg.addColorStop(1, "rgba(255,240,220,0)");
		ctx.fillStyle = sg;
		ctx.fillRect(x, top - 12, segW, bodyH);
		// Baffle pinch in the middle of the section
		ctx.fillStyle = "rgba(0,0,0,0.22)";
		roundRect(ctx, x + segW / 2 - 1.5, top + 10, 3, bodyH - 26, 2);
		ctx.fill();
		stitches(ctx, x + 10, top + bodyH - 8, x + segW - 10, top + bodyH - 8, 8);
	}
	// Front bolster tube running along the bottom edge
	const by = top + bodyH - 18;
	const bg = ctx.createLinearGradient(0, by, 0, by + 30);
	bg.addColorStop(0, shade(VINYL.yellow, 1.1));
	bg.addColorStop(0.5, shade(VINYL.yellow, 0.75));
	bg.addColorStop(1, shade(VINYL.yellow, 0.25));
	ctx.fillStyle = bg;
	roundRect(ctx, 0, by, L.w, 30, 15);
	ctx.fill();
	return c;
}
