import type { KAPLAYCtx, Vec2 } from "kaplay";
import { FLOOR_ART_HEIGHT, FLOOR_ART_OFFSET } from "./castleArt";
import { FONT, PHYS, VIEW_HEIGHT, type Palette } from "./config";
import { drawItem, drawPlayer, makeRoomArt } from "./draw";
import {
	CASTLE_ART_TOP, FIXED, FLOOR_Y, HATCH, ITEMS, PLAYER_START, ROOM, ROOM_NUMBER, ROOM_TITLE, type ItemDef,
} from "./level1";
import { type Body, type Rect, type Solid, bodyRect, findSupport, overlaps, stepBody } from "./physics";

interface Item {
	def: ItemDef;
	/** Centre-based physics body; light furniture bounces around too. */
	b: Body;
	carried: boolean;
}

type ChargeState = "idle" | "charging";
type Phase = "play" | "sliding";

interface PendingJump {
	kind: "hop" | "launch";
	power: number;
	/** Seconds left before the buffered press is dropped. */
	ttl: number;
}

interface MenuButton {
	label: string;
	action: () => void;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A ripple simulation for the floor's vinyl: strips on springs, coupled to their neighbours. */
function makeFloorWave(width: number, strip: number) {
	const n = Math.ceil(width / strip) + 1;
	const d = new Float32Array(n);
	const vel = new Float32Array(n);
	return {
		strip,
		n,
		d,
		hit(x: number, speed: number) {
			const c = x / strip;
			for (let i = Math.max(0, Math.floor(c - 4)); i <= Math.min(n - 1, Math.ceil(c + 4)); i++) {
				const f = Math.max(0, 1 - Math.abs(i - c) / 4.5);
				vel[i] += speed * 0.09 * f;
			}
		},
		update(dt: number) {
			const steps = 3, h = dt / steps;
			for (let s = 0; s < steps; s++) {
				for (let i = 0; i < n; i++) {
					const l = d[Math.max(0, i - 1)], r = d[Math.min(n - 1, i + 1)];
					const a = -160 * d[i] - 5 * vel[i] + 1400 * (l + r - 2 * d[i]);
					vel[i] += a * h;
				}
				for (let i = 0; i < n; i++) d[i] = Math.max(-10, Math.min(22, d[i] + vel[i] * h));
			}
		},
		at(x: number) {
			const c = Math.max(0, Math.min(n - 1.001, x / strip));
			const i = Math.floor(c), f = c - i;
			return d[i] * (1 - f) + d[i + 1] * f;
		},
	};
}

export function registerGameScene(k: KAPLAYCtx, pal: Palette) {
	k.scene("game", () => {
		const v = k.vec2;
		const art = makeRoomArt(k, pal);
		k.setCursor("crosshair");

		// ---------- State ----------
		const player: Body = {
			x: PLAYER_START.x, y: PLAYER_START.y, hw: 13, hh: 22,
			vx: 0, vy: 0, grounded: true, ground: FIXED[0],
		};
		let facing = 1;
		let charge: ChargeState = "idle";
		let chargeTime = 0;
		let pressing = false; // jump button held, not yet turned into a hop or a charge
		let pressTime = 0;
		let pending: PendingJump | null = null;
		let lastContact = 0; // elapsed time of the last landing/touch on a surface top
		let carrying: Item | null = null;
		let phase: Phase = "play";
		let slideT = 0;
		let paused = false;
		let showControls = false;
		let elapsed = 0;
		let t = 0; // animation clock (keeps running while paused for ambience)

		// Tutorial progress (drives hints)
		let jumps = 0;
		let charged = 0;
		let firstJumpAt = -1;
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

		const floorWave = makeFloorWave(ROOM.w, 24);

		const items: Item[] = ITEMS.map((def) => ({
			def,
			carried: false,
			b: { x: def.x, y: def.restOn - def.h / 2, hw: def.w / 2, hh: def.h / 2, vx: 0, vy: 0, grounded: true, ground: null },
		}));

		function itemSolid(it: Item): Solid {
			return { id: it.def.id, x: it.b.x - it.b.hw, y: it.b.y - it.b.hh, w: it.def.w, h: it.def.h, bounce: it.def.bounce };
		}
		const itemRect = (it: Item): Rect => itemSolid(it);
		/** Things you can stand on / bounce off: fixed furniture plus light items that are at rest. */
		const solidsNow = (except?: Item): Solid[] => [
			...FIXED,
			...items.filter((i) => i !== except && !i.carried && i.b.grounded).map(itemSolid),
		];

		const say = (msg: string, secs = 2.2) => { toast = msg; toastT = secs; };

		const pointerWorld = (): Vec2 => k.toWorld(k.mousePos());
		const center = () => v(player.x, player.y);
		const carryFactor = () => carrying ? carrying.def.carrySpeed : 1;

		// ---------- Aiming & jumping ----------
		function aimDir(): Vec2 {
			let d = pointerWorld().sub(center());
			if (d.len() < 1) d = v(0, -1);
			d = d.unit();
			if (d.y > -0.12) d = v(Math.sign(d.x || 1) * Math.sqrt(1 - 0.12 * 0.12), -0.12);
			return d;
		}

		function chargePower(): number {
			// Swings 0 -> 1 -> 0 continuously until the launch click, pausing briefly at full
			// power so a full-strength jump is easy to hit (also on a touchpad).
			const up = PHYS.chargeSweep, hold = PHYS.chargeHold;
			const p = chargeTime % (2 * up + hold);
			if (p < up) return p / up;
			if (p < up + hold) return 1;
			return 1 - (p - up - hold) / up;
		}

		function jumpSpeed(j: { kind: "hop" | "launch"; power: number }) {
			const base = j.kind === "hop" ? PHYS.hopSpeed : k.lerp(PHYS.minLaunch, PHYS.maxLaunch, j.power);
			return base * carryFactor();
		}

		const canJumpNow = () => player.grounded || elapsed - lastContact <= PHYS.contactGrace;

		/** Fire the buffered jump if we're touching something. Replaces the current velocity, so
		 * bounces never stack into a higher jump than a normal one. */
		function tryFire() {
			if (!pending || !canJumpNow() || phase !== "play") return;
			const d = aimDir();
			const s = jumpSpeed(pending);
			player.vx = d.x * s;
			player.vy = d.y * s;
			player.grounded = false;
			player.ground = null;
			lastContact = -Infinity;
			jumps++;
			if (pending.kind === "launch") charged++;
			if (firstJumpAt < 0) firstJumpAt = elapsed;
			// Monster anger: bigger and later jumps anger it more. Teaser only in Room I.
			const p = pending.kind === "hop" ? 0.2 : pending.power;
			anger = Math.min(0.85, anger + (0.03 + 0.08 * p) * (1 + elapsed / 60));
			monsterPulse = Math.max(monsterPulse, 0.4 + p * 0.6);
			pending = null;
		}

		function jumpPressed() {
			if (paused || phase !== "play") return;
			if (charge === "charging") {
				// Second click: launch at the bar's current level (now, or on the next touch).
				pending = { kind: "launch", power: chargePower(), ttl: PHYS.launchBuffer };
				charge = "idle";
				tryFire();
				return;
			}
			pressing = true;
			pressTime = 0;
		}

		function jumpReleased() {
			if (!pressing) return;
			pressing = false;
			if (paused || phase !== "play") return;
			// Released before the hold threshold: a quick hop.
			pending = { kind: "hop", power: 0, ttl: PHYS.hopBuffer };
			tryFire();
		}

		// ---------- Furniture ----------
		function supportsSomething(item: Item) {
			const r = itemRect(item);
			return items.some((o) => {
				if (o === item || o.carried || !o.b.grounded) return false;
				const or = itemRect(o);
				return Math.abs(or.y + or.h - r.y) < 1.5 && or.x < r.x + r.w && or.x + or.w > r.x;
			});
		}

		function nearestGrabbable(): Item | null {
			let best: Item | null = null;
			let bestD = Infinity;
			for (const it of items) {
				if (it.carried) continue;
				const r = itemRect(it);
				const cx = k.clamp(player.x, r.x, r.x + r.w);
				const cy = k.clamp(player.y, r.y, r.y + r.h);
				const d = Math.hypot(player.x - cx, player.y - cy);
				if (d <= PHYS.reach && d < bestD) { best = it; bestD = d; }
			}
			return best;
		}

		/** Where the carried item would be dropped, and where it would come to rest. */
		function dropPlan(it: Item) {
			let off = pointerWorld().sub(center());
			if (off.len() > PHYS.reach) off = off.unit().scale(PHYS.reach);
			const cx = player.x + off.x;
			const cy = player.y + off.y;
			const start = { x: cx - it.def.w / 2, y: cy - it.def.h / 2, w: it.def.w, h: it.def.h };
			const solids = solidsNow(it);
			let blocked = solids.some((s) => overlaps(start, s)) || overlaps(start, bodyRect(player));
			let restTop = Infinity;
			for (const s of solids) {
				if (s.x < start.x + start.w && s.x + s.w > start.x && s.y >= start.y + start.h - 0.5) restTop = Math.min(restTop, s.y);
			}
			const rest = { x: start.x, y: restTop - it.def.h, w: it.def.w, h: it.def.h };
			if (overlaps(rest, bodyRect(player), 1)) blocked = true;
			return { start, rest, blocked };
		}

		function toggleCarry() {
			if (paused || phase !== "play") return;
			if (carrying) {
				const plan = dropPlan(carrying);
				if (plan.blocked) { say("No room to put it there."); return; }
				const b = carrying.b;
				b.x = plan.start.x + b.hw;
				b.y = plan.start.y + b.hh;
				b.vx = 0;
				b.vy = 0;
				b.grounded = false;
				b.ground = null;
				carrying.carried = false;
				carrying = null;
				return;
			}
			const it = nearestGrabbable();
			if (!it) { say("Nothing light enough within reach."); return; }
			if (player.ground?.id === it.def.id) { say("You're standing on it."); return; }
			if (supportsSomething(it)) { say("Something is resting on top of it."); return; }
			it.carried = true;
			carrying = it;
			everCarried = true;
			say(`Carrying the ${it.def.name}: your jumps are weaker.`, 2.5);
		}

		function updateItems(dt: number) {
			const sub = dt / 2;
			for (const it of items) {
				if (it.carried) continue;
				for (let s = 0; s < 2; s++) {
					const wasMoving = !it.b.grounded;
					const impacts = stepBody(it.b, sub, solidsNow(it), PHYS.gravity, PHYS.settleSpeed, it.def.bounceScale);
					for (const im of impacts) {
						if (im.fromAbove && im.solid.id === "floor") floorWave.hit(it.b.x, im.speed * 0.6);
					}
					// Came to rest on top of the player? Lift the player onto it.
					if (wasMoving && it.b.grounded && overlaps(itemRect(it), bodyRect(player))) {
						player.y = it.b.y - it.b.hh - player.hh;
						player.grounded = true;
						player.ground = itemSolid(it);
					}
				}
			}
		}

		/** A hard landing on the floor makes nearby loose furniture jump. */
		function shockwave(x: number, speed: number) {
			if (speed < 450) return;
			for (const it of items) {
				if (it.carried || !it.b.grounded || it.b.ground?.id !== "floor") continue;
				const dist = Math.abs(it.b.x - x);
				if (dist > 260) continue;
				const f = (1 - dist / 260) * (speed - 400) / 500;
				it.b.vy = -Math.min(520, 380 * f / it.def.carrySpeed ** 2 * it.def.bounceScale);
				it.b.vx = (Math.sign(it.b.x - x) || 1) * (40 + Math.random() * 80) * f;
				it.b.grounded = false;
				it.b.ground = null;
			}
		}

		// Dev-only handle for poking at the level from the browser console (stripped from builds).
		if (import.meta.env.DEV) {
			(window as any).__etc = {
				player, items, toggleCarry,
				teleport(x: number, y: number) { player.x = x; player.y = y; player.vx = player.vy = 0; player.grounded = false; player.ground = null; },
				state: () => ({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, grounded: player.grounded, ground: player.ground?.id, carrying: carrying?.def.id, charge, pending, phase, elapsed }),
			};
		}

		// ---------- Input ----------
		k.onMousePress("left", () => {
			if (paused) { clickMenu(k.mousePos()); return; }
			jumpPressed();
		});
		k.onMouseRelease("left", jumpReleased);
		k.onMousePress("right", () => { charge = "idle"; pending = null; pressing = false; });
		k.onKeyPress("space", jumpPressed);
		k.onKeyRelease("space", jumpReleased);
		k.onKeyPress("e", toggleCarry);
		k.onKeyPress("r", () => k.go("game"));
		k.onKeyPress("escape", () => {
			if (phase !== "play") return;
			if (paused && showControls) { showControls = false; return; }
			paused = !paused;
			pressing = false;
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
			floorWave.update(dt);

			if (phase === "sliding") {
				slideT += dt;
				const target = v(HATCH.x + HATCH.w / 2, HATCH.y + HATCH.h - 30);
				player.x = k.lerp(player.x, target.x, Math.min(1, dt * 6));
				player.y = k.lerp(player.y, target.y, Math.min(1, dt * 6));
				if (slideT > 1.6) k.go("escaped", { time: elapsed });
				updateItems(dt);
				updateCamera(dt);
				return;
			}

			// Holding the button past the threshold turns it into a charge. The bar then keeps
			// swinging after release, and the next click launches.
			if (pressing) {
				pressTime += dt;
				if (pressTime >= PHYS.holdToCharge) {
					pressing = false;
					charge = "charging";
					chargeTime = 0;
				}
			}
			if (charge === "charging") chargeTime += dt;
			if (pending) {
				pending.ttl -= dt;
				if (pending.ttl <= 0) pending = null;
			}

			// Slight air drift (weaker while carrying)
			if (!player.grounded) {
				const dir = (k.isKeyDown(["d", "right"]) ? 1 : 0) - (k.isKeyDown(["a", "left"]) ? 1 : 0);
				const max = PHYS.driftMax * carryFactor();
				// Drift can always slow you down, but can only push you up to the cap.
				if (dir !== 0 && (Math.sign(player.vx) !== dir || Math.abs(player.vx) < max)) {
					player.vx += dir * PHYS.driftAccel * carryFactor() * dt;
				}
			}

			const sub = dt / PHYS.substeps;
			for (let i = 0; i < PHYS.substeps; i++) {
				const impacts = stepBody(player, sub, solidsNow(), PHYS.gravity, PHYS.settleSpeed);
				for (const im of impacts) {
					if (im.speed > 650) k.shake(Math.min(6, im.speed / 200));
					if (!im.fromAbove) continue;
					lastContact = elapsed;
					if (im.solid.id === "floor") {
						floorWave.hit(player.x, im.speed);
						shockwave(player.x, im.speed);
						// The castle floor is uneven: hard landings throw you sideways a little.
						if (!player.grounded && im.speed > 300) {
							player.vx += (Math.random() * 2 - 1) * PHYS.floorChaos * Math.min(1, im.speed / 900);
						}
					}
				}
				if (player.grounded) lastContact = elapsed;
				tryFire();
			}
			if (player.grounded && !findSupport(player, solidsNow())) { player.grounded = false; player.ground = null; }

			updateItems(dt);

			if (player.ground?.id === "wardrobe" || player.ground?.id === "shelf") reachedWardrobe = true;

			const aim = aimDir();
			if (Math.abs(aim.x) > 0.05) facing = Math.sign(aim.x);

			if (overlaps(bodyRect(player), HATCH)) {
				phase = "sliding";
				charge = "idle";
				pending = null;
				if (carrying) {
					const b = carrying.b;
					b.x = player.x; b.y = player.y - 60; b.vx = b.vy = 0; b.grounded = false;
					carrying.carried = false;
					carrying = null;
				}
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
			ty = k.clamp(ty, vh / 2 - 70, ROOM.h + 60 - vh / 2);
			camPos = camPos.lerp(v(tx, ty), Math.min(1, dt * 5));
			k.setCamScale(s);
			k.setCamPos(camPos);
		}
		k.setCamScale(camScale());
		updateCamera(1);

		/** Visual sink of things resting on the rippling floor. */
		const sinkAt = (b: Body) => (b.grounded && b.ground?.id === "floor") || (!b.grounded && b.y + b.hh >= FLOOR_Y - 1)
			? floorWave.at(b.x) : 0;

		// ---------- World drawing ----------
		k.add([k.z(0), {
			id: "worldArt",
			draw() {
				k.drawSprite({ sprite: "castleRoom", pos: v(0, -CASTLE_ART_TOP), width: ROOM.w, height: ROOM.h + CASTLE_ART_TOP });
				art.portrait(player.x, player.y);
				art.hatch(t, phase === "sliding");
				art.chandelier(t);
				for (const f of FIXED) {
					if (f.kind === "bed") art.bed(f);
					else if (f.kind === "wardrobe") art.wardrobe(f);
					else if (f.kind === "shelf") art.shelf(f);
				}

				// Rippling floor: the floor art sliced into strips, each offset by the wave.
				const w = floorWave.strip;
				for (let i = 0; i < floorWave.n - 1; i++) {
					const x = i * w;
					if (x >= ROOM.w) break;
					const sw = Math.min(w, ROOM.w - x);
					k.drawSprite({
						sprite: "castleFloor",
						pos: v(x, FLOOR_Y - FLOOR_ART_OFFSET + floorWave.d[i]),
						width: sw + 0.6,
						height: FLOOR_ART_HEIGHT,
						quad: k.quad(x / ROOM.w, 0, sw / ROOM.w, 1),
					});
				}
				art.rockingHorse(t, floorWave.at(760));

				for (const it of items) {
					if (it.carried) continue;
					const r = itemRect(it);
					drawItem(k, pal, it.def.kind, r.x, r.y + sinkAt(it.b), r.w, r.h);
				}

				// Drop preview
				if (carrying && phase === "play") {
					const plan = dropPlan(carrying);
					const col = plan.blocked ? pal.danger : pal.text;
					k.drawRect({ pos: v(plan.rest.x, plan.rest.y), width: plan.rest.w, height: plan.rest.h, fill: false, outline: { width: 2, color: col }, opacity: 0.6, radius: 4 });
					drawItem(k, pal, carrying.def.kind, plan.rest.x, plan.rest.y, plan.rest.w, plan.rest.h, 0.25);
				}

				// Player
				const py = player.y + sinkAt(player);
				const slideFade = phase === "sliding" ? Math.max(0, 1 - slideT * 1.2) : 1;
				if (slideFade > 0) drawPlayer(k, pal, player.x, py, player.hw, player.hh, player.vy, facing, t);
				if (carrying) {
					const cw = carrying.def.w * 0.7, ch = carrying.def.h * 0.7;
					drawItem(k, pal, carrying.def.kind, player.x - cw / 2, py - player.hh - ch - 4, cw, ch);
				}

				if (phase === "play" && !paused) drawAim(py);
			},
		}]);

		function drawTrajectory(c: Vec2, d: Vec2, s: number, opacity: number) {
			for (let i = 1; i <= 22; i++) {
				const tt = i * 0.05;
				const px = c.x + d.x * s * tt;
				const py = c.y + d.y * s * tt + 0.5 * PHYS.gravity * tt * tt;
				if (px < 0 || px > ROOM.w || py > ROOM.h) break;
				k.drawCircle({ pos: v(px, py), radius: 3, color: pal.text, opacity: opacity * (1 - i / 24) });
			}
		}

		function drawAim(py: number) {
			const d = aimDir();
			const c = v(player.x, py);
			// Hold-to-charge progress ring
			if (pressing && pressTime > 0.05) {
				const f = Math.min(1, pressTime / PHYS.holdToCharge);
				k.drawCircle({ pos: c, radius: 34, fill: false, outline: { width: 2, color: pal.textDim }, opacity: 0.3 });
				k.drawCircle({ pos: c, radius: 34, start: -90, end: -90 + 360 * f, color: pal.yellow, opacity: 0.25 });
			}
			if (charge === "idle") {
				const p1 = c.add(d.scale(26)), p2 = c.add(d.scale(40));
				k.drawLine({ p1, p2, width: 2, color: pal.text, opacity: canJumpNow() ? 0.4 : 0.15 });
				if (pending?.kind === "launch") drawTrajectory(c, d, jumpSpeed(pending), 0.35);
				return;
			}
			const pw = chargePower();
			drawTrajectory(c, d, jumpSpeed({ kind: "launch", power: pw }), 0.55);
			// Power bar beside the player (fills upward)
			const bx = player.x + (facing > 0 ? -34 : 26), by = py + player.hh, bh = 70;
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
			if (charge === "charging") return "Click (or Space) again to launch. Higher bar = bigger jump.";
			if (carrying && !reachedWardrobe) return "Point beside the wardrobe and press E to put it down. You can jump while carrying.";
			if (jumps === 0) return "You can't walk. Tap Click (or Space) to hop toward the pointer.";
			if (charged === 0) return "Hold Click (or Space) for a moment to start charging a bigger jump.";
			if (!everCarried) {
				if (elapsed - firstJumpAt < 9) return "Jump presses in mid-air fire the moment you touch something. A / D drift a little.";
				return "The wardrobe is too tall to reach from the floor. Get near the toy chest and press E to carry it.";
			}
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
			const hw = Math.min(W - 2 * m, 640 * u);
			k.drawRect({ pos: v(W / 2, H - m), width: hw, height: 44 * u, color: k.BLACK, opacity: 0.55, radius: 8 * u, anchor: "bot" });
			k.drawText({ text: hint, pos: v(W / 2, H - m - 22 * u), size: 15 * u, width: hw - 24 * u, align: "center", color: pal.text, font: FONT, anchor: "center" });

			if (toastT > 0) {
				k.drawText({ text: toast, pos: v(W / 2, H - m - 64 * u), size: 15 * u, color: pal.yellow, font: FONT, anchor: "center", opacity: Math.min(1, toastT * 2) });
			}

			k.drawText({ text: "E carry   R restart   Esc menu", pos: v(W - m, m + 34 * u), size: 12 * u, color: pal.textDim, font: FONT, anchor: "topright" });

			if (anger > 0.6) {
				k.drawText({ text: "Something beneath the vinyl stirs...", pos: v(W / 2, m + 8 * u), size: 15 * u, color: pal.monster, font: FONT, anchor: "top", opacity: (anger - 0.6) * 3 });
			}
		}

		function drawMenu(W: number, H: number, u: number) {
			k.drawRect({ pos: v(0, 0), width: W, height: H, color: k.BLACK, opacity: 0.72 });
			k.drawText({ text: "Paused", pos: v(W / 2, H * 0.22), size: 46 * u, color: pal.text, font: FONT, anchor: "center" });
			menuButtons.length = 0;
			if (showControls) {
				const lines = [
					"Tap Click / Space - quick hop toward the pointer",
					"Hold Click / Space - start charging; click again to launch",
					"Pointer - aim",
					"A / D or Left / Right - drift a little in the air",
					"E - pick up / put down light furniture",
					"Right click - cancel a charge",
					"R - restart room      Esc - menu",
				];
				lines.forEach((l, i) => k.drawText({ text: l, pos: v(W / 2, H * 0.34 + i * 26 * u), size: 17 * u, color: pal.text, font: FONT, anchor: "center" }));
				addButton("Back", W / 2, H * 0.34 + lines.length * 26 * u + 30 * u, u, () => { showControls = false; });
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
