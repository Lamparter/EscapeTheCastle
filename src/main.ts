import kaplay from "kaplay";
import { FONT, VIEW_HEIGHT, makePalette } from "./config";
import { THEMES, buildFloorCanvas, buildRoomCanvas } from "./dollhouseArt";
import { spriteKey } from "./draw";
import { registerGameScene } from "./game";
import { SPRITES, type SpriteName } from "./sprites.generated";
import { CEIL_Y, FLOOR_Y, ROOM, ROOM_ART_TOP, ROOM_THEME, ROOM_WINDOWS, WALL_L, WALL_R } from "./level1";

const k = kaplay({
	background: [6, 5, 9],
	font: FONT,
	pixelDensity: Math.min(2, window.devicePixelRatio || 1),
	letterbox: false,
	global: false,
});

k.loadRoot("./"); // relative paths, needed for itch.io

/** Radial-gradient vignette, generated at runtime (no image asset needed). */
function makeVignette(): string {
	const size = 512;
	const c = document.createElement("canvas");
	c.width = c.height = size;
	const ctx = c.getContext("2d")!;
	const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	// The sprite is drawn 5x screen height, so radius 1.0 = 2.5 screen heights.
	g.addColorStop(0, "rgba(0,0,0,0)");
	g.addColorStop(0.08, "rgba(0,0,0,0.05)");
	g.addColorStop(0.17, "rgba(0,0,0,0.6)");
	g.addColorStop(0.26, "rgba(0,0,0,0.93)");
	g.addColorStop(1, "rgba(0,0,0,0.97)");
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	return c.toDataURL();
}
k.loadSprite("vignette", makeVignette());

// Furniture rendered from CC0 Poly Haven models (tools/render_sprites.py).
for (const name of Object.keys(SPRITES) as SpriteName[]) k.loadSprite(spriteKey(name), SPRITES[name].file);

/** Vertical fade that sinks the floor into darkness, where the monster lurks. */
function makeFloorShade(): HTMLCanvasElement {
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
}
k.loadSprite("floorShade", makeFloorShade());

// The dollhouse room: vector walls rendered once to a canvas, plus a floor made from a real
// CC0 parquet photo (loaded first, so KAPLAY waits for it before the game can start).
const roomLayout = {
	w: ROOM.w, h: ROOM.h, floorY: FLOOR_Y, ceilY: CEIL_Y, wallL: WALL_L, wallR: WALL_R,
	top: ROOM_ART_TOP, windows: ROOM_WINDOWS, theme: THEMES[ROOM_THEME], seed: 7,
};
k.loadSprite("roomArt", buildRoomCanvas(roomLayout));
k.load((async () => {
	const img = new Image();
	img.src = "textures/herringbone_parquet_diff.jpg";
	await img.decode();
	await k.loadSprite("floorArt", buildFloorCanvas(roomLayout, img));
})());

const pal = makePalette(k);
registerGameScene(k, pal);

/** Title backdrop: a slice of the nursery wall, under the vignette. */
function backdrop() {
	const W = k.width(), H = k.height();
	const s = H / 420;
	k.drawSprite({ sprite: "roomArt", pos: k.vec2(W / 2 - 610 * s, -ROOM_ART_TOP * s), width: ROOM.w * s, height: (ROOM.h + ROOM_ART_TOP) * s });
	k.drawSprite({ sprite: "vignette", pos: k.vec2(W / 2, H / 2), width: H * 5, height: H * 5, anchor: "center" });
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
	const secs = Math.floor(time);
	const timeStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
	k.add([k.fixed(), {
		id: "escaped",
		draw() {
			const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
			k.drawRect({ pos: k.vec2(0, 0), width: W, height: H, color: pal.void });
			k.drawText({ text: "You slip down the slide into the dark...", pos: k.vec2(W / 2, H * 0.34), size: 30 * u, color: pal.text, anchor: "center", font: FONT });
			k.drawText({ text: `The Nursery escaped in ${timeStr}`, pos: k.vec2(W / 2, H * 0.34 + 46 * u), size: 20 * u, color: time <= 60 ? pal.monster : pal.yellow, anchor: "center", font: FONT });
			k.drawText({ text: "The next rooms are still being built.", pos: k.vec2(W / 2, H * 0.55), size: 16 * u, color: pal.textDim, anchor: "center", font: FONT });
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
