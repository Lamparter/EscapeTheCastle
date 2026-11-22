import kaplay from "kaplay";
import { FONT, VIEW_HEIGHT, makePalette } from "./config";
import { registerGameScene } from "./game";
import { spriteKey } from "./sprites";
import { SPRITES, type SpriteName } from "./sprites.generated";
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

/** Title / end backdrop: a slice of the nursery wall, under the vignette. */
function backdrop(darken = 0) {
	const W = k.width(), H = k.height();
	const room = SPRITES.room;
	const s = H / 420;
	k.drawSprite({ sprite: spriteKey("room"), pos: k.vec2(W / 2 - 610 * s, room.y * s), width: room.w * s, height: room.h * s });
	k.drawSprite({ sprite: "vignette", pos: k.vec2(W / 2, H / 2), width: H * 5, height: H * 5, anchor: "center" });
	if (darken) k.drawSprite({ sprite: "shade", pos: k.vec2(0, 0), width: W, height: H, opacity: darken });
}

k.scene("title", () => {
	k.setCursor("default");
	let t = 0;
	k.onUpdate(() => { t += k.dt(); });
	k.add([k.fixed(), {
		id: "title",
		draw() {
			const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
			backdrop();
			k.drawText({ text: "Escape The Castle", pos: k.vec2(W / 2, H * 0.38), size: 64 * u, color: pal.text, anchor: "center", font: FONT });
			k.drawText({ text: "a horror game inside a bouncy Victorian dollhouse", pos: k.vec2(W / 2, H * 0.38 + 50 * u), size: 18 * u, color: pal.textDim, anchor: "center", font: FONT });
			k.drawText({ text: "Click or press Space to begin", pos: k.vec2(W / 2, H * 0.7), size: 18 * u, color: pal.text, anchor: "center", font: FONT, opacity: 0.5 + 0.4 * Math.sin(t * 3) });
		},
	}]);
	const start = () => k.go("game");
	k.onMousePress("left", start);
	k.onKeyPress(["space", "enter"], start);
});

k.scene("escaped", ({ time }: { time: number }) => {
	k.setCursor("default");
	const ui = makeUi(k, pal);
	const secs = Math.floor(time);
	const timeStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
	k.add([k.fixed(), {
		id: "escaped",
		draw() {
			const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
			backdrop(0.75);
			ui.panel(W / 2 - 330 * u, H * 0.24, 660 * u, 150 * u, 0.92);
			k.drawText({ text: "You slip down the slide into the dark...", pos: k.vec2(W / 2, H * 0.34), size: 30 * u, color: pal.text, anchor: "center", font: FONT });
			k.drawText({ text: `The Nursery escaped in ${timeStr}`, pos: k.vec2(W / 2, H * 0.34 + 46 * u), size: 20 * u, color: time <= 60 ? pal.monster : pal.yellow, anchor: "center", font: FONT });
			k.drawText({ text: "The next rooms are still being built.", pos: k.vec2(W / 2, H * 0.6), size: 16 * u, color: pal.textDim, anchor: "center", font: FONT });
			k.drawText({ text: "Click or press Space to play the Nursery again", pos: k.vec2(W / 2, H * 0.7), size: 18 * u, color: pal.text, anchor: "center", font: FONT });
		},
	}]);
	const again = () => k.go("game");
	k.wait(0.6, () => {
		k.onMousePress("left", again);
		k.onKeyPress(["space", "enter", "r"], again);
	});
});

k.go("title");
