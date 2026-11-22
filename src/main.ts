import kaplay from "kaplay";
import { FONT, VIEW_HEIGHT, makePalette } from "./config";
import { registerGameScene } from "./game";
import { spriteKey } from "./sprites";
import { SPRITES, type SpriteName } from "./sprites.generated";
import { loadAudio, playMusic, toggleMute } from "./audio";
import { glow } from "./draw";
import { makeUi } from "./ui";

const k = kaplay({
	background: [6, 5, 9],
	font: FONT,
	pixelDensity: Math.min(2, window.devicePixelRatio || 1),
	letterbox: false,
	global: false,
});

k.loadRoot("./"); // relative paths, needed for itch.io

// ---------------------------------------------------------------- images
// Everything visible is a photoreal image: renders made with real photo textures (tools/render_sprites.py),
// photo textures, and museum scans. The few generated images below are pure light/darkness *effects*
// (no drawn shapes): a vignette, a soft glow, a black shade, and blurred copies of real images.

function effectCanvas(size: number, paint: (ctx: CanvasRenderingContext2D) => void) {
	const c = document.createElement("canvas");
	c.width = c.height = size;
	paint(c.getContext("2d")!);
	return c;
}

/** Darkness around the player (radial falloff). */
k.loadSprite("vignette", effectCanvas(512, (ctx) => {
	const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
	// The sprite is drawn 5x screen height, so radius 1.0 = 2.5 screen heights.
	g.addColorStop(0, "rgba(0,0,0,0)");
	g.addColorStop(0.08, "rgba(0,0,0,0.05)");
	g.addColorStop(0.17, "rgba(0,0,0,0.6)");
	g.addColorStop(0.26, "rgba(0,0,0,0.93)");
	g.addColorStop(1, "rgba(0,0,0,0.97)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 512, 512);
}));
/** Soft light falloff, tinted per use (candles, moonlight, glints, eyes). */
k.loadSprite("glow", effectCanvas(128, (ctx) => {
	const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, "rgba(255,255,255,1)");
	g.addColorStop(0.25, "rgba(255,255,255,0.45)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
}));
/** Film grain (an effect: random monochrome speckle), tiled over the screen with a jittering offset. */
k.loadSprite("grain", effectCanvas(256, (ctx) => {
	const img = ctx.createImageData(256, 256);
	for (let i = 0; i < img.data.length; i += 4) {
		const g = Math.random() < 0.5 ? 0 : 255;
		img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
		img.data[i + 3] = Math.random() * 120;
	}
	ctx.putImageData(img, 0, 0);
}));
/** Plain darkness for fades and blackouts. */
k.loadSprite("shade", effectCanvas(4, (ctx) => { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 4, 4); }));
/** Vertical fade that sinks the space beneath the floor into darkness, where the monster lurks. */
k.loadSprite("floorShade", (() => {
	const c = document.createElement("canvas");
	c.width = 4;
	c.height = 256;
	const ctx = c.getContext("2d")!;
	const g = ctx.createLinearGradient(0, 0, 0, 256);
	g.addColorStop(0, "rgba(0,0,0,0.25)");
	g.addColorStop(0.12, "rgba(0,0,0,0.72)");
	g.addColorStop(0.35, "rgba(0,0,0,0.94)");
	g.addColorStop(1, "rgba(0,0,0,0.98)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 4, 256);
	return c;
})());

// Rendered sprites (furniture, room, floor, player, ...) and photo textures for the UI.
for (const name of Object.keys(SPRITES) as SpriteName[]) k.loadSprite(spriteKey(name), SPRITES[name].file);
loadAudio(k);
k.loadSprite("ui_wood", "textures/dark_wood_diff.jpg");
k.loadSprite("ui_brass", "textures/metal_plate_diff.jpg");

/** A heavily blurred copy of the monster render: its ghostly glow through the floorboards. */
k.load((async () => {
	const img = new Image();
	img.src = SPRITES.monster.file;
	await img.decode();
	const pad = 60; // keep in sync with MONSTER_GLOW_PAD in game.ts
	const c = document.createElement("canvas");
	c.width = img.width + pad * 2;
	c.height = img.height + pad * 2;
	const ctx = c.getContext("2d")!;
	ctx.filter = "blur(18px) brightness(1.6)";
	ctx.drawImage(img, pad, pad);
	await k.loadSprite("monster_glow", c);
})());

const pal = makePalette(k);
registerGameScene(k, pal);

const COVER = import.meta.env.DEV && new URLSearchParams(location.search).get("shot") === "cover";
const GILT = k.rgb(236, 198, 120);
const CANDLE = k.rgb(255, 176, 96);

/** Title / end backdrop: the candlelit nursery itself, slowly drifting past under the vignette, the
 * lights flickering, the chandelier swaying and the goth ballerina waiting by the toys. */
function makeBackdrop() {
	let flick = 1, flickT = 1.5, t = 0;
	return {
		update(dt: number) {
			t += dt;
			flickT -= dt;
			if (flickT <= 0) { flick = Math.random() < 0.4 ? 0.25 : 0.6; flickT = 1.5 + Math.random() * 3; }
			flick = Math.min(1, flick + dt * 2.5);
		},
		draw(darken = 0) {
			const W = k.width(), H = k.height();
			const s = H / 640;
			const half = W / s / 2;
			const camX = Math.max(half, Math.min(1920 - half, 960 + Math.sin(t * 0.045) * 600));
			const camY = 400;
			k.pushTransform();
			k.pushTranslate(W / 2, H / 2);
			k.pushScale(s, s);
			k.pushTranslate(-camX, -camY);
			const room = SPRITES.room, floor = SPRITES.floor;
			k.drawSprite({ sprite: spriteKey("room"), pos: k.vec2(room.x ?? 0, room.y ?? 0), width: room.w, height: room.h });
			k.drawSprite({ sprite: spriteKey("floor"), pos: k.vec2(floor.x ?? 0, floor.y ?? 0), width: floor.w, height: floor.h });
			// Chandelier swaying on its chain, candles flickering
			const ch = SPRITES.chandelier, sway = Math.sin(t * 0.9) * 2.5;
			k.pushTransform();
			k.pushTranslate(900, 0);
			k.pushRotate(sway);
			k.drawSprite({ sprite: spriteKey("chandelier"), pos: k.vec2(-ch.w / 2, 0), width: ch.w, height: ch.h });
			for (const f of [-0.4, -0.25, -0.1, 0.1, 0.25, 0.4]) {
				glow(k, k.vec2(f * ch.w, ch.h * 0.6), 14 + 3 * Math.sin(t * 9 + f * 20), CANDLE, 0.5 * flick);
			}
			k.popTransform();
			glow(k, k.vec2(900, 260), 420, CANDLE, 0.16 * flick);
			// Toys on the floor, and the ballerina among them, swaying a little
			for (const [name, x] of [["rocking_horse", 760], ["chest", 990]] as const) {
				const sp = SPRITES[name];
				k.drawSprite({ sprite: spriteKey(name), pos: k.vec2(x - sp.w / 2, 702 - sp.h), width: sp.w, height: sp.h });
			}
			const d = SPRITES.pdoll;
			k.pushTransform();
			k.pushTranslate(1180, 702);
			k.pushRotate(Math.sin(t * 0.7) * 1.5);
			k.drawSprite({ sprite: spriteKey("pdoll"), pos: k.vec2(-d.w / 2, -d.pivots.feet[1]), width: d.w, height: d.h });
			k.popTransform();
			k.popTransform();
			k.drawSprite({ sprite: "vignette", pos: k.vec2(W / 2, H / 2), width: H * 5.4, height: H * 5.4, anchor: "center", opacity: 0.92 });
			k.drawSprite({ sprite: "shade", pos: k.vec2(0, 0), width: W, height: H, opacity: Math.min(1, darken + (1 - flick) * 0.35) });
		},
	};
}

/** Gilt lettering with a carved shadow. */
/**
 * Headings are rasterised at the screen's real pixel size (KAPLAY's text atlas is 64 px, so big
 * text drawn with drawText is upscaled and blurry). Each (text, size, style) is cached as a sprite;
 * gilt headings get a real gold gradient and a carved shadow.
 */
const PIXEL_DENSITY = Math.min(2, window.devicePixelRatio || 1);
const crispCache = new Map<string, { w: number; h: number }>();
function crispSprite(text: string, size: number, gilt: boolean, rgb: [number, number, number], spacing: number) {
	const px = Math.max(8, Math.round(size * PIXEL_DENSITY));
	const key = `crisp:${gilt ? "g" : rgb.join(",")}:${px}:${Math.round(spacing * PIXEL_DENSITY)}:${text}`;
	let info = crispCache.get(key);
	if (!info) {
		const c = document.createElement("canvas");
		const ctx = c.getContext("2d")!;
		const font = `${px}px ${FONT}`;
		ctx.font = font;
		const sp = spacing * PIXEL_DENSITY;
		const chars = [...text];
		const widths = chars.map((ch) => ctx.measureText(ch).width);
		const tw = widths.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1);
		const pad = Math.ceil(px * 0.15);
		c.width = Math.ceil(tw) + pad * 2;
		c.height = Math.ceil(px * 1.35) + pad * 2;
		ctx.font = font;
		ctx.textBaseline = "middle";
		const fill = (style: string | CanvasGradient, dx: number, dy: number) => {
			ctx.fillStyle = style;
			let cx = pad + dx;
			chars.forEach((ch, i) => { ctx.fillText(ch, cx, c.height / 2 + dy); cx += widths[i] + sp; });
		};
		fill("rgba(0,0,0,0.8)", px * 0.03, px * 0.05); // carved shadow
		if (gilt) {
			const g = ctx.createLinearGradient(0, c.height / 2 - px * 0.5, 0, c.height / 2 + px * 0.5);
			g.addColorStop(0, "#f7e2a8");
			g.addColorStop(0.45, "#d9a95a");
			g.addColorStop(0.55, "#b98535");
			g.addColorStop(1, "#f0cd84");
			fill(g, 0, 0);
		} else {
			fill(`rgb(${rgb.join(",")})`, 0, 0);
		}
		k.loadSprite(key, c);
		info = { w: c.width / PIXEL_DENSITY, h: c.height / PIXEL_DENSITY };
		crispCache.set(key, info);
	}
	return { key, ...info };
}

function giltText(text: string, x: number, y: number, size: number, opts: { color?: ReturnType<typeof k.rgb>; opacity?: number; letterSpacing?: number } = {}) {
	const o = opts.opacity ?? 1;
	const col = opts.color;
	const s = crispSprite(text, size, !col, col ? [col.r, col.g, col.b] : [0, 0, 0], opts.letterSpacing ?? 0);
	if (!k.getSprite(s.key)?.data) {
		// First frame, while the sprite registers: fall back to plain text
		k.drawText({ text, pos: k.vec2(x, y), size, color: col ?? GILT, opacity: o, anchor: "center", font: FONT, letterSpacing: opts.letterSpacing });
		return;
	}
	k.drawSprite({ sprite: s.key, pos: k.vec2(Math.round(x - s.w / 2), Math.round(y - s.h / 2)), width: s.w, height: s.h, opacity: o });
}

k.scene("title", () => {
	k.setCursor("default");
	playMusic(k, "music_title", 0.7);
	k.onKeyPress("m", () => toggleMute());
	const ui = makeUi(k, pal);
	const bg = makeBackdrop();
	let t = 0, showControls = false;
	const start = () => k.go("game");
	k.onUpdate(() => { t += k.dt(); bg.update(k.dt()); });
	k.add([k.fixed(), {
		id: "title",
		draw() {
			const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
			bg.draw(0.1);
			ui.clearButtons();
			const fade = Math.min(1, t / 1.2);
			// The nameplate
			const pw = Math.min(W - 32 * u, 620 * u), ph = 196 * u, px = W / 2 - pw / 2, py = H * 0.12;
			ui.panel(px, py, pw, ph, 0.94 * fade);
			giltText("ESCAPE", W / 2, py + 40 * u, 20 * u, { color: pal.text, opacity: fade, letterSpacing: 10 * u });
			giltText("Hollybank Manor", W / 2, py + 96 * u, Math.min(60 * u, pw / 9), { opacity: fade });
			ui.ornament(W / 2, py + 140 * u, Math.min(pw - 80 * u, 360 * u), u, fade);
			k.drawText({ text: "a horror game inside a bouncy Victorian dollhouse", pos: k.vec2(W / 2, py + 168 * u), size: 16 * u, width: pw - 40 * u, align: "center", color: pal.textDim, anchor: "center", font: FONT, opacity: fade });
			if (COVER) return;
			if (showControls) {
				const cw = Math.min(W - 32 * u, 540 * u), chh = 200 * u, cx = W / 2 - cw / 2, cy = H * 0.5;
				ui.panel(cx, cy, cw, chh, 0.95);
				const rows = [["A / D", "shuffle along"], ["W / Space", "jump, and again in the air"], ["hold S", "sink into the floor, release to spring"], ["E", "carry or drop furniture"], ["R  /  Esc", "restart  /  menu"]];
				rows.forEach(([key, what], i) => {
					const y = cy + 32 * u + i * 34 * u;
					k.drawText({ text: key, pos: k.vec2(cx + cw * 0.32, y), size: 17 * u, color: GILT, anchor: "right", font: FONT });
					k.drawText({ text: what, pos: k.vec2(cx + cw * 0.36, y), size: 17 * u, color: pal.text, anchor: "left", font: FONT });
				});
				ui.button("Back", W / 2, cy + chh + 34 * u, u, () => { showControls = false; });
			} else {
				ui.button("Enter the Nursery", W / 2, H * 0.6, u, start);
				ui.button("Controls", W / 2, H * 0.6 + 56 * u, u, () => { showControls = true; });
			}
		},
	}]);
	k.onMousePress("left", () => ui.click(k.mousePos()));
	k.onKeyPress(["space", "enter"], () => { if (showControls) showControls = false; else start(); });
	k.onKeyPress("escape", () => { showControls = false; });
});

k.scene("escaped", ({ time }: { time: number }) => {
	k.setCursor("default");
	playMusic(k, "music_title", 0.7);
	k.onKeyPress("m", () => toggleMute());
	const ui = makeUi(k, pal);
	const bg = makeBackdrop();
	const secs = Math.floor(time);
	const timeStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
	let ready = false;
	k.wait(0.6, () => { ready = true; });
	const again = () => { if (ready) k.go("game"); };
	k.onUpdate(() => { bg.update(k.dt()); });
	k.add([k.fixed(), {
		id: "escaped",
		draw() {
			const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
			bg.draw(0.6);
			ui.clearButtons();
			const pw = Math.min(W - 32 * u, 640 * u), ph = 230 * u, px = W / 2 - pw / 2, py = H * 0.16;
			ui.panel(px, py, pw, ph, 0.94);
			giltText("You slip down the slide into the dark...", W / 2, py + 52 * u, Math.min(28 * u, pw / 24));
			ui.ornament(W / 2, py + 92 * u, Math.min(pw - 80 * u, 320 * u), u);
			k.drawText({ text: `The Nursery escaped in ${timeStr}`, pos: k.vec2(W / 2, py + 132 * u), size: 21 * u, color: time <= 60 ? pal.monster : pal.text, anchor: "center", font: FONT });
			k.drawText({ text: "The rest of Hollybank Manor is still being built.", pos: k.vec2(W / 2, py + 180 * u), size: 16 * u, width: pw - 40 * u, align: "center", color: pal.textDim, anchor: "center", font: FONT });
			ui.button("Play the Nursery again", W / 2, H * 0.68, u, again);
			ui.button("Title", W / 2, H * 0.68 + 56 * u, u, () => k.go("title"));
		},
	}]);
	k.onMousePress("left", () => ui.click(k.mousePos()));
	k.onKeyPress(["space", "enter", "r"], again);
});

const SHOT = import.meta.env.DEV ? new URLSearchParams(location.search).get("shot") : null;
if (SHOT === "escaped") k.go("escaped", { time: 47 });
else if (SHOT && SHOT !== "title" && SHOT !== "cover") k.go("game");
else k.go("title");
