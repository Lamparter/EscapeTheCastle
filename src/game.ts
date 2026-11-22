import type { KAPLAYCtx, Vec2 } from "kaplay";
import { FONT, PHYS, VIEW_HEIGHT, type Palette } from "./config";
import { drawItem, drawPlayer, makeRoomArt } from "./draw";
import { FIXED, HATCH, ITEMS, PLAYER_START, ROOM, ROOM_NUMBER, ROOM_TITLE, type ItemDef } from "./level1";
import { type Body, type Solid, bodyRect, findSupport, overlaps, stepBody } from "./physics";

interface Item extends Solid {
	def: ItemDef;
	carried: boolean;
	falling: boolean;
	vy: number;
}

type ChargeState = "idle" | "charging";
type Phase = "play" | "sliding";

interface MenuButton {
	label: string;
	action: () => void;
	x: number;
	y: number;
	w: number;
	h: number;
}

export function registerGameScene(k: KAPLAYCtx, pal: Palette) {
	k.scene("game", () => {
		const v = k.vec2;
		const art = makeRoomArt(k, pal);
		k.setCursor("crosshair");

		// ---------- State ----------
		const player: Body = {
			x: PLAYER_START.x, y: PLAYER_START.y, hw: 13, hh: 22,
			vx: 0, vy: 0, grounded: true, ground: null,
		};
		let facing = 1;
		let charge: ChargeState = "idle";
		let chargeTime = 0;
		let carrying: Item | null = null;
		let phase: Phase = "play";
		let slideT = 0;
		let paused = false;
		let showControls = false;
		let elapsed = 0;
		let t = 0; // animation clock (keeps running while paused for ambience)

		// Tutorial progress (drives hints)
		let launches = 0;
		let firstLaunchAt = -1;
		let everCarried = false;
		let reachedWardrobe = false;
		let toast = "";
		let toastT = 0;

		// Threat teasers
		let anger = 0;
		let monsterPulse = 0;
		let monsterX = player.x;
		let flickerT = 6 + Math.random() * 6;
		let blackout = 0;
		let dim = 0;

		const items: Item[] = ITEMS.map((def) => ({
			id: def.id, def, x: def.x - def.w / 2, y: def.restOn - def.h, w: def.w, h: def.h,
			bounce: def.bounce, carried: false, falling: false, vy: 0,
		}));

		const solidsNow = (): Solid[] => [...FIXED, ...items.filter((i) => !i.carried && !i.falling)];

		const say = (msg: string, secs = 2.2) => { toast = msg; toastT = secs; };

		const pointerWorld = (): Vec2 => k.toWorld(k.mousePos());
		const center = () => v(player.x, player.y);

		// ---------- Aiming & charge ----------
		function aimDir(): Vec2 {
			let d = pointerWorld().sub(center());
			if (d.len() < 1) d = v(0, -1);
			d = d.unit();
			if (d.y > -0.12) d = v(Math.sign(d.x || 1) * Math.sqrt(1 - 0.12 * 0.12), -0.12);
			return d;
		}

		function chargePower(): number {
			// Swings 0 -> 1 -> 0 continuously until the second click, pausing briefly at full
			// power so a full-strength jump is easy to hit (also on a touchpad).
			const up = PHYS.chargeSweep, hold = PHYS.chargeHold;
			const p = chargeTime % (2 * up + hold);
			if (p < up) return p / up;
			if (p < up + hold) return 1;
			return 1 - (p - up - hold) / up;
		}

		function launchSpeed(power: number) {
			return k.lerp(PHYS.minLaunch, PHYS.maxLaunch, power);
		}

		function primaryAction() {
			if (paused || phase !== "play") return;
			if (charge === "idle") {
				if (!player.grounded) { say("You can only jump from a surface."); return; }
				charge = "charging";
				chargeTime = 0;
			} else {
				const p = chargePower();
				const d = aimDir();
				const s = launchSpeed(p);
				player.vx = d.x * s;
				player.vy = d.y * s;
				player.grounded = false;
				player.ground = null;
				charge = "idle";
				launches++;
				if (firstLaunchAt < 0) firstLaunchAt = elapsed;
				// Monster anger: bigger jumps and later jumps anger it more. Teaser only in Room I.
				anger = Math.min(0.85, anger + (0.04 + 0.08 * p) * (1 + elapsed / 60));
				monsterPulse = 1;
			}
		}

		// ---------- Furniture ----------
		function supportsSomething(item: Item) {
			return items.some((o) => o !== item && !o.carried && !o.falling &&
				Math.abs(o.y + o.h - item.y) < 1.5 && o.x < item.x + item.w && o.x + o.w > item.x);
		}

		function nearestGrabbable(): Item | null {
			let best: Item | null = null;
			let bestD = Infinity;
			for (const it of items) {
				if (it.carried || it.falling) continue;
				const cx = k.clamp(player.x, it.x, it.x + it.w);
				const cy = k.clamp(player.y, it.y, it.y + it.h);
				const d = Math.hypot(player.x - cx, player.y - cy);
				if (d <= PHYS.reach && d < bestD) { best = it; bestD = d; }
			}
			return best;
		}

		/** Where the carried item would be dropped, and where it would come to rest. */
		function dropPlan(it: Item) {
			const pw = pointerWorld();
			let off = pw.sub(center());
			if (off.len() > PHYS.reach) off = off.unit().scale(PHYS.reach);
			const cx = player.x + off.x;
			const cy = player.y + off.y;
			const start = { x: cx - it.w / 2, y: cy - it.h / 2, w: it.w, h: it.h };
			const solids = solidsNow();
			let blocked = solids.some((s) => overlaps(start, s)) || overlaps(start, bodyRect(player));
			// Find what it lands on.
			let restTop = Infinity;
			for (const s of solids) {
				if (s.x < start.x + start.w && s.x + s.w > start.x && s.y >= start.y + start.h - 0.5) restTop = Math.min(restTop, s.y);
			}
			const rest = { x: start.x, y: restTop - it.h, w: it.w, h: it.h };
			if (overlaps(rest, bodyRect(player), 1)) blocked = true;
			return { start, rest, blocked };
		}

		function toggleCarry() {
			if (paused || phase !== "play") return;
			if (carrying) {
				const plan = dropPlan(carrying);
				if (plan.blocked) { say("No room to put it there."); return; }
				carrying.x = plan.start.x;
				carrying.y = plan.start.y;
				carrying.carried = false;
				carrying.falling = true;
				carrying.vy = 0;
				carrying = null;
				return;
			}
			const it = nearestGrabbable();
			if (!it) { say("Nothing light enough within reach."); return; }
			if (player.ground === it) { say("You're standing on it."); return; }
			if (supportsSomething(it)) { say("Something is resting on top of it."); return; }
			it.carried = true;
			carrying = it;
			everCarried = true;
		}

		function updateItems(dt: number) {
			for (const it of items) {
				if (it.carried) continue;
				if (!it.falling) {
					// Lost its support (e.g. the thing under it was picked up)?
					const others = [...FIXED, ...items.filter((o) => o !== it && !o.carried && !o.falling)];
					const supported = others.some((s) => Math.abs(s.y - (it.y + it.h)) < 1.5 && s.x < it.x + it.w - 1 && s.x + s.w > it.x + 1);
					if (!supported) { it.falling = true; it.vy = 0; }
					continue;
				}
				it.vy += PHYS.gravity * dt;
				const nextY = it.y + it.vy * dt;
				const others = [...FIXED, ...items.filter((o) => o !== it && !o.carried && !o.falling)];
				let landed = false;
				for (const s of others) {
					if (s.x < it.x + it.w - 0.5 && s.x + s.w > it.x + 0.5 && it.y + it.h <= s.y + 0.5 && nextY + it.h >= s.y) {
						it.y = s.y - it.h;
						landed = true;
						break;
					}
				}
				if (landed) {
					it.falling = false;
					it.vy = 0;
					// If it landed on top of the player, lift the player onto it.
					if (overlaps(it, bodyRect(player))) {
						player.y = it.y - player.hh;
						player.grounded = true;
						player.ground = it;
					}
				} else {
					it.y = nextY;
				}
			}
		}

		// Dev-only handle for poking at the level from the browser console (stripped from builds).
		if (import.meta.env.DEV) {
			(window as any).__etc = {
				player, items, primaryAction, toggleCarry,
				teleport(x: number, y: number) { player.x = x; player.y = y; player.vx = player.vy = 0; player.grounded = false; },
				state: () => ({ x: player.x, y: player.y, grounded: player.grounded, ground: player.ground?.id, carrying: carrying?.id, phase, elapsed }),
			};
		}

		// ---------- Input ----------
		k.onMousePress("left", () => {
			if (paused) { clickMenu(k.mousePos()); return; }
			primaryAction();
		});
		k.onMousePress("right", () => { if (charge === "charging") charge = "idle"; });
		k.onKeyPress("space", primaryAction);
		k.onKeyPress("e", toggleCarry);
		k.onKeyPress("r", () => k.go("game"));
		k.onKeyPress("escape", () => {
			if (phase !== "play") return;
			if (paused && showControls) { showControls = false; return; }
			paused = !paused;
		});
		k.onKeyPress("c", () => { if (paused) showControls = !showControls; });

		// ---------- Update ----------
		k.onUpdate(() => {
			const dt = Math.min(k.dt(), 1 / 30);
			t += dt;
			if (paused) return;
			elapsed += dt;
			if (toastT > 0) toastT -= dt;
			monsterPulse = Math.max(0, monsterPulse - dt * 1.2);
			anger = Math.max(0, anger - dt * 0.01);

			if (phase === "sliding") {
				slideT += dt;
				const target = v(HATCH.x + HATCH.w / 2, HATCH.y + HATCH.h - 30);
				player.x = k.lerp(player.x, target.x, Math.min(1, dt * 6));
				player.y = k.lerp(player.y, target.y, Math.min(1, dt * 6));
				if (slideT > 1.6) k.go("escaped", { time: elapsed });
				updateCamera(dt);
				return;
			}

			if (charge === "charging") {
				chargeTime += dt;
				if (!player.grounded) charge = "idle";
			}

			// Slight air drift
			if (!player.grounded) {
				const dir = (k.isKeyDown(["d", "right"]) ? 1 : 0) - (k.isKeyDown(["a", "left"]) ? 1 : 0);
				// Drift can always slow you down, but can only push you up to driftMax.
				if (dir !== 0 && (Math.sign(player.vx) !== dir || Math.abs(player.vx) < PHYS.driftMax)) {
					player.vx += dir * PHYS.driftAccel * dt;
				}
			}

			const sub = dt / PHYS.substeps;
			for (let i = 0; i < PHYS.substeps; i++) {
				const impacts = stepBody(player, sub, solidsNow(), PHYS.gravity, PHYS.settleSpeed);
				for (const im of impacts) {
					if (im.speed > 650) k.shake(Math.min(6, im.speed / 200));
				}
			}
			if (player.grounded && !findSupport(player, solidsNow())) player.grounded = false;

			updateItems(dt);

			if (player.ground?.id === "wardrobe" || player.ground?.id === "shelf") reachedWardrobe = true;

			const aim = aimDir();
			if (Math.abs(aim.x) > 0.05) facing = Math.sign(aim.x);

			if (overlaps(bodyRect(player), HATCH)) {
				phase = "sliding";
				charge = "idle";
				if (carrying) { carrying.carried = false; carrying.falling = true; carrying.x = player.x - carrying.w / 2; carrying.y = player.y - 60; carrying = null; }
			}

			// Monster drifts after the player, slowly.
			monsterX = k.lerp(monsterX, player.x, Math.min(1, dt * 0.6));

			// Random light flicker / short blackouts
			flickerT -= dt;
			if (flickerT <= 0) {
				if (Math.random() < 0.45) blackout = 0.14; else dim = 0.5;
				flickerT = 7 + Math.random() * 8;
			}
			blackout = Math.max(0, blackout - dt);
			dim = Math.max(0, dim - dt);

			updateCamera(dt);
		});

		// ---------- Camera ----------
		let camPos = v(player.x, player.y);
		function camScale() { return k.height() / VIEW_HEIGHT; }
		function updateCamera(dt: number) {
			const s = camScale();
			const vw = k.width() / s;
			const vh = VIEW_HEIGHT;
			const lead = carrying || charge === "charging" ? pointerWorld().sub(center()).scale(0.25) : v(0, 0);
			let tx = player.x + lead.x;
			let ty = player.y - 40 + lead.y;
			tx = vw >= ROOM.w ? ROOM.w / 2 : k.clamp(tx, vw / 2, ROOM.w - vw / 2);
			ty = k.clamp(ty, vh / 2 - 20, ROOM.h + 60 - vh / 2);
			camPos = camPos.lerp(v(tx, ty), Math.min(1, dt * 5));
			k.setCamScale(s);
			k.setCamPos(camPos);
		}
		k.setCamScale(camScale());
		updateCamera(1);

		// ---------- World drawing ----------
		k.add([k.z(0), {
			id: "worldArt",
			draw() {
				art.backWall();
				art.windowArt(t);
				art.portrait(player.x, player.y);
				art.hatch(t, phase === "sliding");
				art.sidePillars();
				art.ceiling();
				art.chandelier(t);
				art.rockingHorse(t);
				for (const f of FIXED) {
					if (f.kind === "bed") art.bed(f);
					else if (f.kind === "wardrobe") art.wardrobe(f);
					else if (f.kind === "shelf") art.shelf(f);
				}
				art.floor();

				for (const it of items) if (!it.carried) drawItem(k, pal, it.def.kind, it.x, it.y, it.w, it.h);

				// Drop preview
				if (carrying && phase === "play") {
					const plan = dropPlan(carrying);
					const col = plan.blocked ? pal.danger : pal.text;
					k.drawRect({ pos: v(plan.rest.x, plan.rest.y), width: plan.rest.w, height: plan.rest.h, fill: false, outline: { width: 2, color: col }, opacity: 0.6, radius: 4 });
					drawItem(k, pal, carrying.def.kind, plan.rest.x, plan.rest.y, plan.rest.w, plan.rest.h, 0.25);
				}

				// Player
				const slideFade = phase === "sliding" ? Math.max(0, 1 - slideT * 1.2) : 1;
				if (slideFade > 0) {
					drawPlayer(k, pal, player.x, player.y, player.hw, player.hh, player.vy, facing, t);
				}
				if (carrying) {
					const cw = carrying.w * 0.7, ch = carrying.h * 0.7;
					drawItem(k, pal, carrying.def.kind, player.x - cw / 2, player.y - player.hh - ch - 4, cw, ch);
				}

				// Aim + power
				if (phase === "play" && !paused) drawAim();
			},
		}]);

		function drawAim() {
			const d = aimDir();
			const c = center();
			if (charge === "idle") {
				if (!player.grounded) return;
				const p1 = c.add(d.scale(26)), p2 = c.add(d.scale(40));
				k.drawLine({ p1, p2, width: 2, color: pal.text, opacity: 0.35 });
				return;
			}
			const pw = chargePower();
			const s = launchSpeed(pw);
			// Trajectory dots
			for (let i = 1; i <= 22; i++) {
				const tt = i * 0.05;
				const px = c.x + d.x * s * tt;
				const py = c.y + d.y * s * tt + 0.5 * PHYS.gravity * tt * tt;
				if (px < 0 || px > ROOM.w || py > ROOM.h) break;
				k.drawCircle({ pos: v(px, py), radius: 3, color: pal.text, opacity: 0.55 * (1 - i / 24) });
			}
			// Power bar beside the player (fills upward)
			const bx = player.x + (facing > 0 ? -34 : 26), by = player.y + player.hh, bh = 70;
			k.drawRect({ pos: v(bx, by - bh), width: 8, height: bh, color: k.BLACK, opacity: 0.6, radius: 3 });
			const fill = bh * pw;
			const col = pw > 0.85 ? pal.danger : pw > 0.5 ? pal.yellow : pal.green;
			k.drawRect({ pos: v(bx, by - fill), width: 8, height: fill, color: col, radius: 3 });
			k.drawRect({ pos: v(bx, by - bh), width: 8, height: bh, fill: false, outline: { width: 1, color: pal.textDim }, radius: 3 });
		}

		// ---------- Screen-space: vignette, monster, HUD, menu ----------
		const menuButtons: MenuButton[] = [];
		function clickMenu(p: Vec2) {
			for (const b of menuButtons) {
				if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { b.action(); return; }
			}
		}

		k.add([k.fixed(), k.z(10), {
			id: "screenFx",
			draw() {
				const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
				const ps = k.toScreen(center());

				// Vignette centred on the player
				const flick = dim > 0 ? 0.75 + 0.2 * Math.sin(t * 60) : 1;
				const size = H * 5 * flick;
				k.drawSprite({ sprite: "vignette", pos: ps, width: size, height: size, anchor: "center" });

				// Monster: a glowing, blurred shape lurking under the vinyl
				const ms = k.toScreen(v(monsterX, ROOM.h + 30));
				const glow = 0.18 + anger * 0.35 + monsterPulse * 0.25;
				for (let i = 6; i >= 1; i--) {
					k.drawEllipse({ pos: ms, radiusX: (60 + i * 26) * u, radiusY: (34 + i * 16) * u, color: pal.monster, opacity: glow * 0.06 });
				}
				const eyeOpen = Math.min(1, anger * 1.6 + monsterPulse * 0.6);
				if (eyeOpen > 0.15) {
					for (const ex of [-34, 34]) {
						k.drawEllipse({ pos: ms.add(v(ex * u, -24 * u)), radiusX: 10 * u, radiusY: 4 * u * eyeOpen, color: pal.monster, opacity: 0.25 + 0.5 * eyeOpen });
					}
				}

				if (blackout > 0) {
					k.drawRect({ pos: v(0, 0), width: W, height: H, color: k.BLACK, opacity: 0.94 });
					// ...but the eyes still glow.
					for (const ex of [-34, 34]) k.drawEllipse({ pos: ms.add(v(ex * u, -24 * u)), radiusX: 10 * u, radiusY: 4 * u, color: pal.monster, opacity: 0.8 });
				}

				drawHud(W, H, u);
				if (phase === "sliding") {
					k.drawRect({ pos: v(0, 0), width: W, height: H, color: k.BLACK, opacity: Math.min(1, slideT / 1.4) });
				}
				if (paused) drawMenu(W, H, u);
			},
		}]);

		function hintText(): string {
			if (phase === "sliding") return "Wheee... down into the dark.";
			if (carrying && !reachedWardrobe) return "Point beside the wardrobe and press E to put it down. You can jump while carrying.";
			if (launches === 0) {
				return charge === "charging"
					? "Click (or Space) again to jump. Higher bar = bigger jump."
					: "You can't walk. Click (or press Space) to start charging a jump toward the pointer.";
			}
			if (!everCarried) {
				if (elapsed - firstLaunchAt < 5) return "While airborne, A / D (or arrow keys) let you drift a little.";
				return "The wardrobe is too tall to reach from the floor. Get near the toy chest and press E to carry it.";
			}
			if (carrying) return "Point beside the wardrobe and press E to put it down. You can jump while carrying.";
			if (!reachedWardrobe) return "Stand on it, fill the bar to the top, and aim the dots onto the wardrobe.";
			return "The slide hatch is on the shelf above. Get to it to escape the room.";
		}

		function drawHud(W: number, H: number, u: number) {
			const m = 18 * u;
			// Room title
			k.drawText({ text: ROOM_NUMBER.toUpperCase(), pos: v(m, m), size: 13 * u, color: pal.textDim, font: FONT });
			k.drawText({ text: ROOM_TITLE, pos: v(m, m + 16 * u), size: 24 * u, color: pal.text, font: FONT });
			// Air gauge (teaser: steady in Room I)
			const gy = m + 50 * u, gw = 150 * u;
			k.drawText({ text: "AIR", pos: v(m, gy), size: 12 * u, color: pal.textDim, font: FONT });
			k.drawRect({ pos: v(m + 34 * u, gy + 2 * u), width: gw, height: 9 * u, color: k.BLACK, opacity: 0.7, radius: 4 * u });
			k.drawRect({ pos: v(m + 34 * u, gy + 2 * u), width: gw, height: 9 * u, color: pal.moon, opacity: 0.8, radius: 4 * u });
			k.drawText({ text: "steady", pos: v(m + 40 * u + gw, gy), size: 12 * u, color: pal.textDim, font: FONT });
			// Timer
			const secs = Math.floor(elapsed);
			const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
			k.drawText({ text: time, pos: v(W - m, m), size: 26 * u, color: pal.text, font: FONT, anchor: "topright" });

			// Hint box
			const hint = hintText();
			const hw = Math.min(W - 2 * m, 620 * u);
			k.drawRect({ pos: v(W / 2, H - m), width: hw, height: 44 * u, color: k.BLACK, opacity: 0.55, radius: 8 * u, anchor: "bot" });
			k.drawText({ text: hint, pos: v(W / 2, H - m - 22 * u), size: 15 * u, width: hw - 24 * u, align: "center", color: pal.text, font: FONT, anchor: "center" });

			// Toast
			if (toastT > 0) {
				k.drawText({ text: toast, pos: v(W / 2, H - m - 64 * u), size: 15 * u, color: pal.yellow, font: FONT, anchor: "center", opacity: Math.min(1, toastT * 2) });
			}

			// Controls reminder
			k.drawText({ text: "E carry   R restart   Esc menu", pos: v(W - m, m + 34 * u), size: 12 * u, color: pal.textDim, font: FONT, anchor: "topright" });

			if (anger > 0.6) {
				k.drawText({ text: "Something beneath the vinyl stirs...", pos: v(W / 2, m + 8 * u), size: 15 * u, color: pal.monster, font: FONT, anchor: "top", opacity: (anger - 0.6) * 3 });
			}
		}

		function drawMenu(W: number, H: number, u: number) {
			k.drawRect({ pos: v(0, 0), width: W, height: H, color: k.BLACK, opacity: 0.72 });
			k.drawText({ text: "Paused", pos: v(W / 2, H * 0.24), size: 46 * u, color: pal.text, font: FONT, anchor: "center" });
			menuButtons.length = 0;
			if (showControls) {
				const lines = [
					"Click / Space - start charging, then again to jump",
					"Pointer - aim",
					"A / D or Left / Right - drift a little in the air",
					"E - pick up / put down light furniture",
					"Right click - cancel a charge",
					"R - restart room",
					"Esc - menu",
				];
				lines.forEach((l, i) => k.drawText({ text: l, pos: v(W / 2, H * 0.36 + i * 26 * u), size: 17 * u, color: pal.text, font: FONT, anchor: "center" }));
				addButton("Back", W / 2, H * 0.36 + lines.length * 26 * u + 30 * u, u, () => { showControls = false; });
				return;
			}
			addButton("Resume", W / 2, H * 0.40, u, () => { paused = false; });
			addButton("Restart room", W / 2, H * 0.40 + 56 * u, u, () => k.go("game"));
			addButton("Controls", W / 2, H * 0.40 + 112 * u, u, () => { showControls = true; });
		}

		function addButton(label: string, cx: number, cy: number, u: number, action: () => void) {
			const w = 240 * u, h = 42 * u;
			const b = { label, action, x: cx - w / 2, y: cy - h / 2, w, h };
			menuButtons.push(b);
			const mp = k.mousePos();
			const hover = mp.x >= b.x && mp.x <= b.x + w && mp.y >= b.y && mp.y <= b.y + h;
			k.drawRect({ pos: v(b.x, b.y), width: w, height: h, color: hover ? pal.redDark : k.BLACK, opacity: 0.85, radius: 6 * u, outline: { width: 1, color: pal.gold } });
			k.drawText({ text: label, pos: v(cx, cy), size: 19 * u, color: pal.text, font: FONT, anchor: "center" });
		}
	});
}
