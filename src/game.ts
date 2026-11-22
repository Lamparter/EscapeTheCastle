import type { KAPLAYCtx, Vec2 } from "kaplay";
import { FLOOR_ART_HEIGHT, FLOOR_ART_OFFSET } from "./castleArt";
import { FONT, PHYS, VIEW_HEIGHT, type Palette } from "./config";
import { drawItem, drawPlayer, makeRoomArt } from "./draw";
import {
	CASTLE_ART_TOP, CHANDELIER_HIT, FIXED, FLOOR_Y, HATCH, ITEMS, KEY_HANG, PLAYER_START, ROOM, ROOM_NUMBER, ROOM_TITLE,
	type ItemDef,
} from "./level1";
import { type Body, type Rect, type Solid, bodyRect, findSupport, overlaps, stepBody } from "./physics";

interface Item {
	def: ItemDef;
	/** Centre-based physics body; light furniture bounces around too. */
	b: Body;
	carried: boolean;
	/** False until released into the room (the key starts on the chandelier). */
	active: boolean;
}

type Phase = "play" | "sliding";

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
			for (let i = Math.max(0, Math.floor(c - 8)); i <= Math.min(n - 1, Math.ceil(c + 8)); i++) {
				const f = Math.max(0, 1 - Math.abs(i - c) / 9);
				vel[i] += speed * 0.28 * f;
			}
		},
		/** Hold the vinyl down around x (someone sinking into it). */
		press(x: number, depth: number) {
			const c = x / strip;
			for (let i = Math.max(0, Math.floor(c - 7)); i <= Math.min(n - 1, Math.ceil(c + 7)); i++) {
				const f = Math.cos(Math.min(1, Math.abs(i - c) / 7) * Math.PI / 2);
				const target = depth * f;
				if (d[i] < target) { d[i] = target; vel[i] = 0; }
			}
		},
		update(dt: number) {
			const steps = 3, h = dt / steps;
			for (let s = 0; s < steps; s++) {
				for (let i = 0; i < n; i++) {
					const l = d[Math.max(0, i - 1)], r = d[Math.min(n - 1, i + 1)];
					const a = -140 * d[i] - 4.5 * vel[i] + 700 * (l + r - 2 * d[i]);
					vel[i] += a * h;
				}
				for (let i = 0; i < n; i++) d[i] = Math.max(-14, Math.min(40, d[i] + vel[i] * h));
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
		k.setCursor("default");

		// ---------- State ----------
		const player: Body = {
			x: PLAYER_START.x, y: PLAYER_START.y, hw: 13, hh: 22,
			vx: 0, vy: 0, grounded: true, ground: FIXED[0],
		};
		let facing = 1;
		let airJumpsLeft = PHYS.airJumps;
		let bufferedJump = 0; // seconds left on a jump pressed in mid-air with no air jump left
		let lastContact = 0; // elapsed time of the last landing/touch on a surface top
		let sink = 0; // 0..1, how far the player has sunk into the floor with S
		let carrying: Item | null = null;
		let phase: Phase = "play";
		let slideT = 0;
		let paused = false;
		let showControls = false;
		let elapsed = 0;
		let t = 0; // animation clock (keeps running while paused for ambience)

		// Puzzle: chandelier + key
		let keyOnChandelier = true;
		let swing = 0, swingVel = 0;
		let lockedToastCooldown = 0;

		// Tutorial progress (drives hints)
		let jumps = 0;
		let doubleJumps = 0;
		let springs = 0;
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
		let fxOn = true; // dev toggle: hide vignette/darkness to inspect the art

		const floorWave = makeFloorWave(ROOM.w, 12);

		const items: Item[] = ITEMS.map((def) => ({
			def,
			carried: false,
			active: !def.hidden,
			b: { x: def.x, y: def.restOn - def.h / 2, hw: def.w / 2, hh: def.h / 2, vx: 0, vy: 0, grounded: !def.hidden, ground: null },
		}));
		const keyItem = items.find((i) => i.def.id === "key")!;

		function itemSolid(it: Item): Solid {
			return { id: it.def.id, x: it.b.x - it.b.hw, y: it.b.y - it.b.hh, w: it.def.w, h: it.def.h, bounce: it.def.bounce };
		}
		const itemRect = (it: Item): Rect => itemSolid(it);
		/** Things you can stand on / bounce off: fixed furniture plus light items at rest (not the key). */
		const solidsNow = (except?: Item): Solid[] => [
			...FIXED,
			...items.filter((i) => i !== except && i.active && !i.carried && i.b.grounded && i.def.kind !== "key").map(itemSolid),
		];

		const say = (msg: string, secs = 2.4) => { toast = msg; toastT = secs; };
		const pointerWorld = (): Vec2 => k.toWorld(k.mousePos());
		const center = () => v(player.x, player.y);
		const carryFactor = () => carrying ? carrying.def.carrySpeed : 1;
		const walkDir = () => (k.isKeyDown(["d", "right"]) ? 1 : 0) - (k.isKeyDown(["a", "left"]) ? 1 : 0);
		const digging = () => k.isKeyDown(["s", "down"]);
		const onFloor = () => player.grounded && player.ground?.id === "floor";
		const touching = () => player.grounded || elapsed - lastContact <= PHYS.contactGrace;

		// ---------- Jumping ----------
		function afterJump(strength: number) {
			player.grounded = false;
			player.ground = null;
			lastContact = -Infinity;
			bufferedJump = 0;
			// Monster anger: bigger and later jumps anger it more. Teaser only in Room I.
			anger = Math.min(0.85, anger + (0.03 + 0.07 * strength) * (1 + elapsed / 60));
			monsterPulse = Math.max(monsterPulse, 0.4 + strength * 0.6);
		}

		function groundJump() {
			const s = PHYS.jumpSpeed * carryFactor();
			// Never weaker than the bounce you're already riding, but never stacks on top of it.
			player.vy = Math.min(player.vy, -s);
			if (player.grounded) player.vx = walkDir() * PHYS.walkSpeed * carryFactor();
			jumps++;
			afterJump(0.2);
		}

		function airJump() {
			player.vy = -PHYS.jumpSpeed * carryFactor();
			airJumpsLeft--;
			doubleJumps++;
			afterJump(0.35);
		}

		function spring() {
			const s = k.lerp(PHYS.springMin, PHYS.springMax, sink) * carryFactor();
			player.vy = -s;
			player.vx = walkDir() * PHYS.walkSpeed * carryFactor();
			floorWave.hit(player.x, -s * 0.8); // the dent snaps back up
			springs++;
			afterJump(0.4 + sink * 0.6);
			sink = 0;
		}

		function jumpPressed() {
			if (paused || phase !== "play") return;
			if (sink > 0.05 && onFloor()) { spring(); return; }
			if (touching()) { groundJump(); return; }
			if (airJumpsLeft > 0) { airJump(); return; }
			bufferedJump = PHYS.jumpBuffer;
		}

		// ---------- Furniture ----------
		function supportsSomething(item: Item) {
			const r = itemRect(item);
			return items.some((o) => {
				if (o === item || !o.active || o.carried || !o.b.grounded) return false;
				const or = itemRect(o);
				return Math.abs(or.y + or.h - r.y) < 1.5 && or.x < r.x + r.w && or.x + or.w > r.x;
			});
		}

		function nearestGrabbable(): Item | null {
			let best: Item | null = null;
			let bestD = Infinity;
			for (const it of items) {
				if (!it.active || it.carried) continue;
				const r = itemRect(it);
				const cx = k.clamp(player.x, r.x, r.x + r.w);
				const cy = k.clamp(player.y, r.y, r.y + r.h);
				// The key is small and lively: be generous.
				const d = Math.hypot(player.x - cx, player.y - cy) - (it.def.kind === "key" ? 30 : 0);
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
			if (it.def.kind === "key") say("Got the key! Now up to the hatch on the shelf.", 3);
			else say(`Carrying the ${it.def.name}: your jumps are weaker.`, 2.5);
		}

		function updateItems(dt: number) {
			const sub = dt / 2;
			for (const it of items) {
				if (!it.active || it.carried) continue;
				for (let s = 0; s < 2; s++) {
					const wasMoving = !it.b.grounded;
					const impacts = stepBody(it.b, sub, solidsNow(it), PHYS.gravity, PHYS.settleSpeed, it.def.bounceScale);
					for (const im of impacts) {
						if (im.fromAbove && im.solid.id === "floor") {
							floorWave.hit(it.b.x, im.speed * 0.6);
							// Loose things skitter about on the uneven vinyl too.
							if (!it.b.grounded && im.speed > 200) it.b.vx += (Math.random() * 2 - 1) * 60;
						}
					}
					if (it.def.kind !== "key" && wasMoving && it.b.grounded && overlaps(itemRect(it), bodyRect(player))) {
						player.y = it.b.y - it.b.hh - player.hh;
						player.grounded = true;
						player.ground = itemSolid(it);
					}
				}
			}
		}

		/** A hard landing on the floor makes nearby loose furniture jump. */
		function shockwave(x: number, speed: number) {
			if (speed < 350) return;
			for (const it of items) {
				if (!it.active || it.carried || !it.b.grounded || it.b.ground?.id !== "floor") continue;
				const dist = Math.abs(it.b.x - x);
				if (dist > 280) continue;
				const f = (1 - dist / 280) * (speed - 300) / 450;
				it.b.vy = -Math.min(560, 400 * f / it.def.carrySpeed ** 2 * it.def.bounceScale);
				it.b.vx = (Math.sign(it.b.x - x) || 1) * (40 + Math.random() * 90) * f;
				it.b.grounded = false;
				it.b.ground = null;
			}
		}

		function knockKeyLoose(fromX: number) {
			const p = art.chandelierPos(t, swing);
			keyOnChandelier = false;
			keyItem.active = true;
			keyItem.b.x = p.x + KEY_HANG.dx;
			keyItem.b.y = p.y + KEY_HANG.dy;
			keyItem.b.vx = (Math.sign(p.x - fromX) || 1) * (120 + Math.random() * 120);
			keyItem.b.vy = -150;
			keyItem.b.grounded = false;
			k.shake(4);
			monsterPulse = 1;
			say("The key clatters loose! Catch it with E.", 3);
		}

		// Dev-only handle for poking at the level from the browser console (stripped from builds).
		if (import.meta.env.DEV) {
			(window as any).__etc = {
				player, items, toggleCarry, floorWave,
				fx(on: boolean) { fxOn = on; },
				teleport(x: number, y: number) { player.x = x; player.y = y; player.vx = player.vy = 0; player.grounded = false; player.ground = null; },
				jump: jumpPressed,
				state: () => ({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, grounded: player.grounded, ground: player.ground?.id, airJumpsLeft, sink, carrying: carrying?.def.id, keyOnChandelier, phase, elapsed }),
			};
		}

		// ---------- Input ----------
		k.onKeyPress(["w", "up", "space"], jumpPressed);
		k.onKeyRelease(["s", "down"], () => {
			if (paused || phase !== "play") return;
			if (sink > 0.05 && onFloor()) spring();
			sink = 0;
		});
		k.onKeyPress("e", toggleCarry);
		k.onKeyPress("r", () => k.go("game"));
		k.onKeyPress("escape", () => {
			if (phase !== "play") return;
			if (paused && showControls) { showControls = false; return; }
			paused = !paused;
		});
		k.onKeyPress("c", () => { if (paused) showControls = !showControls; });
		k.onMousePress("left", () => { if (paused) clickMenu(k.mousePos()); });

		// ---------- Update ----------
		k.onUpdate(() => {
			const dt = Math.min(k.dt(), 1 / 30);
			t += dt;
			if (paused) return;
			elapsed += dt;
			if (toastT > 0) toastT -= dt;
			lockedToastCooldown = Math.max(0, lockedToastCooldown - dt);
			monsterPulse = Math.max(0, monsterPulse - dt * 1.2);
			anger = Math.max(0, anger - dt * 0.01);
			floorWave.update(dt);
			// Chandelier swing (damped pendulum)
			swingVel += (-9 * swing - 0.5 * swingVel) * dt;
			swing += swingVel * dt;

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

			const dir = walkDir();
			if (dir !== 0) facing = dir;

			// S: sink into the bouncy floor (when resting on it).
			if (digging() && onFloor()) {
				sink = Math.min(1, sink + dt / PHYS.sinkTime);
			} else if (!digging()) {
				sink = 0;
			}
			if (sink > 0) floorWave.press(player.x, sink * PHYS.sinkDepth);

			// A / D: slow walk on surfaces, gentle drift in the air.
			if (player.grounded) {
				if (dir !== 0 && sink === 0) {
					const step = dir * PHYS.walkSpeed * carryFactor() * dt;
					const moved = { ...bodyRect(player), x: player.x - player.hw + step };
					// Walls and furniture sides block walking (the surface you stand on doesn't).
					const blocked = solidsNow().some((s) => s.id !== player.ground?.id && overlaps(moved, s, 0.5));
					if (!blocked) player.x += step;
					player.vx = dir * PHYS.walkSpeed * carryFactor(); // kept if you walk off an edge
				}
			} else if (dir !== 0) {
				const max = PHYS.driftMax * carryFactor();
				if (Math.sign(player.vx) !== dir || Math.abs(player.vx) < max) {
					player.vx += dir * PHYS.driftAccel * carryFactor() * dt;
				}
			}

			if (bufferedJump > 0) bufferedJump -= dt;

			const sub = dt / PHYS.substeps;
			const bounceScale = digging() ? PHYS.digInBounce : 1;
			for (let i = 0; i < PHYS.substeps; i++) {
				const impacts = stepBody(player, sub, solidsNow(), PHYS.gravity, PHYS.settleSpeed, bounceScale);
				for (const im of impacts) {
					if (im.speed > 600) k.shake(Math.min(6, im.speed / 180));
					if (!im.fromAbove) continue;
					lastContact = elapsed;
					airJumpsLeft = PHYS.airJumps;
					if (im.solid.id === "floor") {
						floorWave.hit(player.x, im.speed);
						shockwave(player.x, im.speed);
						// The castle floor is uneven: hard landings throw you sideways a little.
						if (!player.grounded && im.speed > 260 && !digging()) {
							player.vx += (Math.random() * 2 - 1) * PHYS.floorChaos * Math.min(1, im.speed / 700);
						}
					}
				}
				if (player.grounded) { lastContact = elapsed; airJumpsLeft = PHYS.airJumps; }
				if (bufferedJump > 0 && touching()) groundJump();
			}
			if (player.grounded && !findSupport(player, solidsNow())) { player.grounded = false; player.ground = null; }

			updateItems(dt);

			if (player.ground?.id === "wardrobe" || player.ground?.id === "shelf") reachedWardrobe = true;

			// Bumping the chandelier swings it, and the first hit knocks the key loose.
			if (overlaps(bodyRect(player), CHANDELIER_HIT)) {
				const push = player.vx * 0.004 + (player.x < CHANDELIER_HIT.x + CHANDELIER_HIT.w / 2 ? 0.25 : -0.25);
				if (Math.abs(swingVel) < 0.6) swingVel += push;
				if (keyOnChandelier) knockKeyLoose(player.x);
			}

			if (overlaps(bodyRect(player), HATCH)) {
				if (carrying?.def.kind === "key") {
					phase = "sliding";
					carrying.carried = false;
					carrying.active = false;
					carrying = null;
					say("The padlock clicks open...", 2);
				} else if (lockedToastCooldown === 0) {
					say(keyOnChandelier
						? "Padlocked. Something glints on the chandelier..."
						: "Padlocked. Bring the key here (press E near it to carry it).", 3);
					lockedToastCooldown = 3;
				}
			}

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
			const lead = carrying ? pointerWorld().sub(center()).scale(0.2) : v(player.vx * 0.25, 0);
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
				art.hatch(t, phase === "sliding", phase !== "sliding");
				art.chandelier(t, swing, keyOnChandelier);
				for (const f of FIXED) {
					if (f.art) art.placed(f.art);
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
					if (!it.active || it.carried) continue;
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

				// Player (squashes as it sinks into the vinyl)
				const py = player.y + sinkAt(player);
				const slideFade = phase === "sliding" ? Math.max(0, 1 - slideT * 1.2) : 1;
				if (slideFade > 0) drawPlayer(k, player.x, py, player.hh, player.vy + sink * 700, facing, t);
				if (carrying) {
					const s = carrying.def.kind === "key" ? 1 : 0.7;
					const cw = carrying.def.w * s, ch = carrying.def.h * s;
					drawItem(k, pal, carrying.def.kind, player.x - cw / 2, py - player.hh - ch - 4, cw, ch);
				}
				// Double jump ready: a faint wisp above the head while airborne
				if (!player.grounded && airJumpsLeft > 0 && phase === "play") {
					k.drawCircle({ pos: v(player.x, py - player.hh - (carrying ? 40 : 10)), radius: 3, color: pal.moon, opacity: 0.5 + 0.3 * Math.sin(t * 10) });
				}
			},
		}]);

		// ---------- Screen-space: vignette, floor darkness, monster, HUD, menu ----------
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

				if (fxOn) {
					// Vignette centred on the player
					const flick = dim > 0 ? 0.75 + 0.2 * Math.sin(t * 60) : 1;
					const size = H * 5 * flick;
					k.drawSprite({ sprite: "vignette", pos: ps, width: size, height: size, anchor: "center" });
					// The floor is part of the darkness too: it fades to black just below the surface.
					const fy = k.toScreen(v(0, FLOOR_Y - 6)).y;
					if (fy < H) k.drawSprite({ sprite: "floorShade", pos: v(0, fy), width: W, height: Math.max(H - fy, 90 * u) });
				}

				// Monster: a glowing, blurred shape lurking inside the dark floor
				const ms = k.toScreen(v(monsterX, FLOOR_Y + 48));
				const glow = 0.16 + anger * 0.35 + monsterPulse * 0.25;
				for (let i = 6; i >= 1; i--) {
					k.drawEllipse({ pos: ms, radiusX: (60 + i * 26) * u, radiusY: (22 + i * 9) * u, color: pal.monster, opacity: glow * 0.06 });
				}
				const eyeOpen = Math.min(1, anger * 1.6 + monsterPulse * 0.6);
				if (eyeOpen > 0.15) {
					for (const ex of [-34, 34]) {
						k.drawEllipse({ pos: ms.add(v(ex * u, -8 * u)), radiusX: 10 * u, radiusY: 4 * u * eyeOpen, color: pal.monster, opacity: 0.25 + 0.5 * eyeOpen });
					}
				}

				if (blackout > 0) {
					k.drawRect({ pos: v(0, 0), width: W, height: H, color: k.BLACK, opacity: 0.94 });
					// ...but the eyes still glow.
					for (const ex of [-34, 34]) k.drawEllipse({ pos: ms.add(v(ex * u, -8 * u)), radiusX: 10 * u, radiusY: 4 * u, color: pal.monster, opacity: 0.8 });
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
			if (jumps === 0) return "A / D to shuffle along. W or Space to jump.";
			if (doubleJumps === 0) return "Press jump again in mid-air to double jump. It recharges when you land.";
			if (springs === 0) return "Hold S on the bouncy floor to sink into it, then let go to spring up high.";
			if (keyOnChandelier) return "Something glints on the chandelier. Spring up (S), then double jump into it.";
			if (carrying?.def.kind !== "key") return "Catch the key: get close and press E. Hold S while bouncing to dig in and stop.";
			if (!reachedWardrobe) return "The hatch is up on the shelf. Spring onto the wardrobe first.";
			return "Jump + double jump up to the shelf and into the hatch.";
		}

		function drawHud(W: number, H: number, u: number) {
			const m = 18 * u;
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
					"A / D or Left / Right - shuffle along (drift in the air)",
					"W / Space / Up - jump; again in mid-air to double jump",
					"Hold S on the floor - sink in; let go to spring up high",
					"Hold S while bouncing - dig in and stop bouncing",
					"E - pick up / put down (the pointer picks the spot)",
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
