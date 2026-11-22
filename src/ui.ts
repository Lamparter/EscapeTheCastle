import type { KAPLAYCtx, Vec2 } from "kaplay";
import { FONT, type Palette } from "./config";

/**
 * Photo-material UI: every panel, bar and button is cut from real CC0 photos (dark wood and
 * scratched brass, from Poly Haven), tinted and faded with image effects. Text sits on top.
 * Sprites used: "ui_wood", "ui_brass" (photo textures) and "shade" (a black image for darkening).
 */
export function makeUi(k: KAPLAYCtx, pal: Palette) {
	const v = k.vec2;
	const woodTint = k.rgb(120, 92, 78);
	const brassTint = k.rgb(255, 205, 120);
	const GILT = k.rgb(236, 198, 120);
	type Button = { x: number; y: number; w: number; h: number; action: () => void };
	let buttons: Button[] = [];

	/** A photo region, tiled at a fixed texture scale (so the grain isn't stretched). */
	function photo(sprite: string, x: number, y: number, w: number, h: number, color = woodTint, opacity = 1, texPx = 512) {
		if (w <= 0 || h <= 0) return;
		k.drawSprite({ sprite, pos: v(x, y), width: w, height: h, quad: k.quad(0, 0, Math.min(1, w / texPx), Math.min(1, h / texPx)), color, opacity });
	}

	function shade(x: number, y: number, w: number, h: number, opacity: number) {
		k.drawSprite({ sprite: "shade", pos: v(x, y), width: w, height: h, opacity });
	}

	/** Dark wood plaque framed in brass. */
	function panel(x: number, y: number, w: number, h: number, opacity = 1, lift = 1) {
		const b = Math.max(2, Math.round(h * 0.06));
		shade(x + 3, y + 4, w, h, 0.35 * opacity); // drop shadow
		photo("ui_wood", x, y, w, h, k.rgb(woodTint.r * lift, woodTint.g * lift, woodTint.b * lift), opacity);
		photo("ui_brass", x, y, w, b, brassTint, opacity);
		photo("ui_brass", x, y + h - b, w, b, brassTint, opacity);
		photo("ui_brass", x, y, b, h, brassTint, opacity);
		photo("ui_brass", x + w - b, y, b, h, brassTint, opacity);
		// Bevel: a dark groove inside the brass and a soft inner shadow, so the plaque looks carved
		const g = Math.max(1, Math.round(b * 0.45));
		shade(x + b, y + b, w - 2 * b, g, 0.55 * opacity);
		shade(x + b, y + b, g, h - 2 * b, 0.4 * opacity);
		shade(x + b, y + h - b - g, w - 2 * b, g, 0.25 * opacity);
		shade(x + w - b - g, y + b, g, h - 2 * b, 0.25 * opacity);
	}

	/** A short brass rule with a lozenge in the middle: an ornament cut from the brass photo. */
	function ornament(cx: number, cy: number, w: number, u: number, opacity = 1) {
		const t = Math.max(1, 2 * u);
		photo("ui_brass", cx - w / 2, cy - t / 2, w / 2 - 10 * u, t, brassTint, opacity);
		photo("ui_brass", cx + 10 * u, cy - t / 2, w / 2 - 10 * u, t, brassTint, opacity);
		k.pushTransform();
		k.pushTranslate(cx, cy);
		k.pushRotate(45);
		photo("ui_brass", -5 * u, -5 * u, 10 * u, 10 * u, brassTint, opacity);
		k.popTransform();
		for (const sx of [-1, 1]) {
			k.pushTransform();
			k.pushTranslate(cx + sx * (w / 2 + 4 * u), cy);
			k.pushRotate(45);
			photo("ui_brass", -2.5 * u, -2.5 * u, 5 * u, 5 * u, brassTint, opacity);
			k.popTransform();
		}
	}

	/** A recessed wood track filled with brass to `fill` (0..1). */
	function gauge(x: number, y: number, w: number, h: number, fill: number) {
		photo("ui_wood", x, y, w, h, k.rgb(50, 36, 30));
		photo("ui_brass", x + 1, y + 1, (w - 2) * Math.max(0, Math.min(1, fill)), h - 2, k.rgb(170, 190, 230));
	}

	function button(label: string, cx: number, cy: number, u: number, action: () => void) {
		const w = 240 * u, h = 42 * u;
		const b = { x: cx - w / 2, y: cy - h / 2, w, h, action };
		buttons.push(b);
		const mp: Vec2 = k.mousePos();
		const hover = mp.x >= b.x && mp.x <= b.x + w && mp.y >= b.y && mp.y <= b.y + h;
		panel(b.x, b.y, w, h, 1, hover ? 1.5 : 1);
		k.drawText({ text: label, pos: v(cx + 1.5 * u, cy + 2 * u), size: 20 * u, color: k.rgb(0, 0, 0), opacity: 0.6, font: FONT, anchor: "center" });
		k.drawText({ text: label, pos: v(cx, cy), size: 20 * u, color: hover ? GILT : pal.text, font: FONT, anchor: "center" });
	}

	return {
		photo,
		shade,
		panel,
		ornament,
		gauge,
		button,
		clearButtons() { buttons = []; },
		click(p: Vec2) {
			const b = buttons.find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
			b?.action();
		},
	};
}
