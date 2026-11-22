import type { KAPLAYCtx, Vec2 } from "kaplay";
import { FONT, PHYS, VIEW_HEIGHT, type Palette } from "./config";
import { makeDoll } from "./doll";
import { drawItem, glow, makeRoomArt } from "./draw";
import {
	CHANDELIER, FIXED, FLOOR_Y, FURNITURE, HATCH, ITEMS, PLAYER_SIZE, PLAYER_START, ROOM, ROOM_NUMBER, ROOM_TITLE,
	type ItemDef,
} from "./level1";
import { type Body, type Rect, type Solid, bodyRect, findSupport, overlaps, stepBody } from "./physics";
import { spriteKey, spriteOrigin, spriteSolids } from "./sprites";
import { SPRITES } from "./sprites.generated";
import { makeUi } from "./ui";

interface Item {
	def: ItemDef;
	/** Centre-based physics body; light furniture bounces around too. */
	b: Body;
	carried: boolean;
	/** False until released into the room (the key starts on the chandelier). */
	active: boolean;
	/** Tumbling while airborne (radians), and a squash on landing (decays). */
	rot: number;
	squash: number;
}

type Phase = "play" | "sliding";

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
		const art = makeRoomArt(k);
		const ui = makeUi(k, pal);
		k.setCursor("default");

		// ---------- State ----------
		const player: Body = {
			x: PLAYER_START.x, y: PLAYER_START.y, ...PLAYER_SIZE,
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
		/** The monster: fades in and out somewhere in the darkness beyond the vignette's light. */
		const MONSTER_EYES = [{ x: 0.244, y: 0.21 }, { x: 0.482, y: 0.213 }];
		const MONSTER_GLOW_PAD = 60;
		const ghost = { a: 0, state: "hidden" as "hidden" | "in" | "hold" | "out" | "lunge", t: 6 + Math.random() * 6, x: 0, y: 0, flip: 1, scale: 1 };
		/** Fade-to-black after the monster lunges: rises during the lunge, holds, then lifts. */
		let lungeDark = 0, lungeHold = 0;
		const doll = makeDoll(k);
		let flickerT = 2 + Math.random() * 3;
		let blackout = 0;
		let dim = 0;
		let fxOn = true; // dev toggle: hide vignette/darkness to inspect the art
		let showHitboxes = false; // dev toggle: outline every solid (debug only)
		let devZoom = 1; // dev toggle: zoom the camera in to inspect animation

		const floorWave = makeFloorWave(ROOM.w, 12);

		const items: Item[] = ITEMS.map((def) => ({
			def,
			carried: false,
			active: !def.hidden,
			rot: 0,
			squash: 0,
			b: { x: def.x, y: def.restOn - def.h / 2, hw: def.w / 2, hh: def.h / 2, vx: 0, vy: 0, grounded: !def.hidden, ground: null },
		}));
		const keyItem = items.find((i) => i.def.id === "key")!;

		/** An item's body: the tight box around its sprite's visible pixels. */
		const itemRect = (it: Item): Rect => ({ x: it.b.x - it.b.hw, y: it.b.y - it.b.hh, w: it.def.w, h: it.def.h });
		/** A resting item as solids: the rectangles covering its sprite's visible pixels. */
		function itemSolids(it: Item): Solid[] {
			const o = spriteOrigin(it.def.sprite, itemRect(it));
			return spriteSolids(it.def.sprite, it.def.id, o.x, o.y, it.def.bounce);
		}
		/** Things you can stand on / bounce off: fixed furniture plus light items at rest (not the key). */
		const solidsNow = (except?: Item): Solid[] => [
			...FIXED,
			...items.filter((i) => i !== except && i.active && !i.carried && i.b.grounded && i.def.kind !== "key").flatMap(itemSolids),
		];

		const say = (msg: string, secs = 2.4) => { toast = msg; toastT = secs; };
		const pointerWorld = (): Vec2 => k.toWorld(k.mousePos());
		const center = () => v(player.x, player.y);
		const carryFactor = () => carrying ? carrying.def.carrySpeed : 1;
		const walkDir = () => (k.isKeyDown(["d", "right"]) ? 1 : 0) - (k.isKeyDown(["a", "left"]) ? 1 : 0);
		const digging = () => k.isKeyDown(["s", "down"]);
		const onFloor = () => player.grounded && player.ground?.id === "floor";
		/** On a surface, just left one, or still rising from a bounce off one: a jump here is a ground
		 * jump, so the air jump stays available (the floor keeps you bouncing for seconds). */
		const touching = () => player.grounded || elapsed - lastContact <= PHYS.contactGrace
			|| (player.vy < 0 && elapsed - lastContact <= PHYS.bounceGrace);

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
			doll.jump(0.3);
			afterJump(0.2);
		}

		function airJump() {
			// Always adds one jump's worth of height: while still rising fast (after a spring) it adds to
			// the climb instead of replacing it with a slower one.
			const s = PHYS.jumpSpeed * carryFactor();
			player.vy = player.vy < 0 ? -Math.hypot(player.vy, s) : -s;
			airJumpsLeft--;
			doubleJumps++;
			doll.jump(0.5);
			doll.twirl();
			afterJump(0.35);
		}

		function spring() {
			const s = k.lerp(PHYS.springMin, PHYS.springMax, sink) * carryFactor();
			player.vy = -s;
			player.vx = walkDir() * PHYS.walkSpeed * carryFactor();
			floorWave.hit(player.x, -s * 0.8); // the dent snaps back up
			springs++;
			doll.jump(1);
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
			return items.some((o) => o !== item && o.active && !o.carried && o.b.grounded && o.b.ground?.id === item.def.id);
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
				// Tumble while flying; settle back upright on landing.
				it.squash = Math.max(0, it.squash - dt * 4);
				if (!it.b.grounded) it.rot += it.b.vx * dt * (it.def.kind === "key" ? 0.06 : 0.012);
				else {
					const target = Math.round(it.rot / (Math.PI * 2)) * Math.PI * 2;
					it.rot += (target - it.rot) * Math.min(1, dt * 12);
				}
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
						for (const im of impacts) if (im.fromAbove && im.speed > 120) it.squash = Math.max(it.squash, Math.min(1, im.speed / 600));
					if (it.def.kind !== "key" && wasMoving && it.b.grounded && overlaps(itemRect(it), bodyRect(player))) {
						player.y = it.b.y - it.b.hh - player.hh;
						player.grounded = true;
						player.ground = { ...itemRect(it), id: it.def.id, bounce: it.def.bounce };
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
			const kb = art.hangingKeyBox(t, swing);
			keyOnChandelier = false;
			keyItem.active = true;
			keyItem.b.x = kb.x + kb.w / 2;
			keyItem.b.y = kb.y + kb.h / 2;
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
				player, items, toggleCarry, floorWave, ghost,
				fx(on: boolean) { fxOn = on; },
				hitboxes(on: boolean) { showHitboxes = on; },
				zoom(z: number) { devZoom = z; },
				teleport(x: number, y: number) { player.x = x; player.y = y; player.vx = player.vy = 0; player.grounded = false; player.ground = null; },
				jump: jumpPressed,
				state: () => ({ x: player.x, y: player.y, vx: player.vx, vy: player.vy, grounded: player.grounded, ground: player.ground?.id, airJumpsLeft, sink, carrying: carrying?.def.id, keyOnChandelier, phase, elapsed }),
			};
		}

		// ---------- Photo mode (dev only): ?shot=<name> stages a scene for store screenshots ----------
		let hideHud = false, freezePlayer = false, freezeGhost = false;
		const shot = import.meta.env.DEV ? new URLSearchParams(location.search).get("shot") : null;
		if (shot) {
			const calm = () => { flickerT = 1e9; blackout = 0; dim = 0; };
			const place = (x: number, feetY: number, vy = 0, face = 1) => {
				player.x = x; player.y = feetY - player.hh; player.vx = 0; player.vy = vy;
				player.grounded = vy === 0 && feetY === FLOOR_Y; player.ground = null; facing = face;
			};
			const showGhost = (dx: number, dy: number, scale = 1, flip = 1) => {
				ghost.state = "hold"; ghost.t = 1e9; ghost.a = 1; ghost.scale = scale; ghost.flip = flip;
				ghost.x = player.x + dx; ghost.y = player.y + dy; freezeGhost = true;
			};
			calm();
			hideHud = !shot.endsWith("-hud");
			const name = shot.replace(/-hud$/, "");
			if (name === "nursery") { place(1160, FLOOR_Y, 0, -1); }
			if (name === "leap") { place(905, 194 + 26 + player.hh * 2, -150); freezePlayer = true; floorWave.hit(905, 900); }
			if (name === "spring") { place(700, FLOOR_Y - 150, -500); freezePlayer = true; floorWave.hit(700, 1100); }
			if (name === "fall") { place(560, FLOOR_Y - 260, 260, -1); freezePlayer = true; }
			if (name === "monster") { place(1130, FLOOR_Y); anger = 0.75; showGhost(-330, -40); }
			if (name === "watched") { place(1400, 419); anger = 0.6; showGhost(-300, -70, 1, -1); }
			if (name === "lunge") { place(1120, FLOOR_Y, 0, -1); anger = 0.85; showGhost(-150, -40, 2.1); lungeDark = 0.3; monsterPulse = 1; }
			if (name === "shelf") { place(1712, 322, 0, 1); }
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
			if (freezePlayer) {
				floorWave.update(dt);
				doll.update(dt, { grounded: false, walking: false, vx: player.vx, vy: player.vy, sink: 0, carrying: !!carrying, facing });
				if (!freezeGhost) updateGhost(dt);
				updateCamera(dt);
				return;
			}
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
				const target = v(HATCH.cx, HATCH.bottom - 40);
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
					// Surfaces follow the sprites' pixels, so they can be uneven: step up small ledges,
					// but anything taller than STEP blocks you.
					const STEP = PHYS.stepUp, feet = player.y + player.hh;
					const hits = solidsNow().filter((s) => overlaps(moved, s, 0.01));
					if (hits.every((s) => s.y >= feet - STEP)) {
						player.x += step;
						const top = Math.min(feet, ...hits.map((s) => s.y));
						player.y = top - player.hh;
					}
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
				const impacts = stepBody(player, sub, solidsNow(), PHYS.gravity, PHYS.settleSpeed, bounceScale, PHYS.ledgeAssist);
				for (const im of impacts) {
					if (im.speed > 600) k.shake(Math.min(6, im.speed / 180));
					if (im.fromAbove && im.speed > 150) doll.land(im.speed);
					if (!im.fromAbove) continue;
					lastContact = elapsed;
					airJumpsLeft = PHYS.airJumps;
					if (im.solid.id === "floor") {
						floorWave.hit(player.x, im.speed);
						shockwave(player.x, im.speed);
						// The bouncy floor is uneven: hard landings throw you sideways a little.
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

			// Bumping the chandelier (its visible pixels, or the key) swings it; the first hit knocks the key loose.
			const pr = bodyRect(player);
			if (art.chandelierRects(t, swing, keyOnChandelier).some((r) => overlaps(pr, r))) {
				const push = player.vx * 0.004 + (player.x < CHANDELIER.x ? 0.25 : -0.25);
				if (Math.abs(swingVel) < 0.6) swingVel += push;
				if (keyOnChandelier) knockKeyLoose(player.x);
			}

			if (art.hatchRects().some((r) => overlaps(pr, r))) {
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

			doll.update(dt, {
				grounded: player.grounded, walking: player.grounded && dir !== 0 && sink === 0,
				vx: player.vx, vy: player.vy, sink, carrying: !!carrying, facing,
			});
			if (!freezeGhost) updateGhost(dt);

			// Random light flicker / short blackouts
			flickerT -= dt;
			if (flickerT <= 0) {
				if (Math.random() < 0.45) blackout = 0.14; else dim = 0.5;
				flickerT = 2.5 + Math.random() * 3.5; // the lights are unreliable: flicker often
			}
			blackout = Math.max(0, blackout - dt);
			dim = Math.max(0, dim - dt);

			updateCamera(dt);
		});

		// ---------- The monster's apparitions ----------
		function updateGhost(dt: number) {
			const lit = Math.hypot(ghost.x - player.x, ghost.y - player.y) < 200;
			switch (ghost.state) {
				case "hidden":
					ghost.t -= dt;
					if (ghost.t <= 0) {
						// Appear somewhere out in the dark, just beyond the light around the doll.
						const ang = Math.random() * Math.PI * 2, dist = 290 + Math.random() * 60;
						ghost.x = player.x + Math.cos(ang) * dist;
						ghost.y = player.y - 30 + Math.sin(ang) * dist * 0.75;
						ghost.flip = Math.random() < 0.5 ? -1 : 1;
						ghost.scale = 1;
						ghost.state = "in";
						k.shake(4 + 6 * anger); // the room shudders as it arrives
					}
					break;
				case "in":
					ghost.a = Math.min(1, ghost.a + dt / 1.8);
					if (ghost.a >= 1) { ghost.state = "hold"; ghost.t = 1.5 + Math.random() * 2.5 + anger * 2; }
					break;
				case "hold":
					ghost.t -= dt;
					// Drifts closer while you're not looking...
					ghost.x += Math.sign(player.x - ghost.x) * 6 * dt;
					if (ghost.t <= 0) {
						// Sometimes, instead of fading away, it rushes at her...
						if (Math.random() < 0.1 + 0.18 * anger) { ghost.state = "lunge"; ghost.t = 0; monsterPulse = 1; }
						else ghost.state = "out";
					}
					break;
				case "lunge": {
					ghost.t += dt;
					const p = Math.min(1, ghost.t / 0.55), e = p * p;
					ghost.x += (player.x - ghost.x) * Math.min(1, dt * (4 + 14 * e));
					ghost.y += (player.y - 20 - ghost.y) * Math.min(1, dt * (4 + 14 * e));
					ghost.scale = 1 + 2.4 * e;
					ghost.a = 1;
					lungeDark = Math.max(lungeDark, e);
					k.shake(2 + 9 * e);
					if (p >= 1) {
						// ...and the screen goes black; when it lifts, it's gone.
						ghost.state = "hidden";
						ghost.a = 0;
						ghost.scale = 1;
						ghost.t = (9 + Math.random() * 9) * (1 - 0.5 * anger);
						lungeDark = 1;
						lungeHold = 0.4;
						anger = Math.min(0.85, anger + 0.1);
					}
					break;
				}
				case "out":
					ghost.a = Math.max(0, ghost.a - dt / 1.4);
					if (ghost.a <= 0) { ghost.state = "hidden"; ghost.t = (7 + Math.random() * 9) * (1 - 0.5 * anger); }
					break;
			}
			// It shrinks from the light: walk towards it and it vanishes quickly.
			if (lungeHold > 0) lungeHold -= dt;
			else if (ghost.state !== "lunge") lungeDark = Math.max(0, lungeDark - dt / 0.9);
			if (lit && ghost.state !== "hidden" && ghost.state !== "lunge") {
				ghost.state = "out";
				ghost.a = Math.max(0, ghost.a - dt / 0.35);
			}
		}

		// ---------- Camera ----------
		let camPos = v(player.x, player.y);
		function camScale() { return (k.height() / VIEW_HEIGHT) * devZoom; }
		function updateCamera(dt: number) {
			const s = camScale();
			const vw = k.width() / s;
			const vh = VIEW_HEIGHT;
			const lead = carrying ? pointerWorld().sub(center()).scale(0.2) : v(player.vx * 0.25, 0);
			let tx = player.x + lead.x;
			let ty = player.y - (devZoom > 1 ? 10 : 40) + lead.y;
			tx = vw >= ROOM.w ? ROOM.w / 2 : k.clamp(tx, vw / 2, ROOM.w - vw / 2);
			if (devZoom === 1) ty = k.clamp(ty, vh / 2 - 70, ROOM.h + 60 - vh / 2);
			camPos = camPos.lerp(v(tx, ty), Math.min(1, dt * 5));
			k.setCamScale(s);
			k.setCamPos(camPos);
		}
		k.setCamScale(camScale());
		updateCamera(1);

		/** Visual sink of things resting on the rippling floor. */
		const sinkAt = (b: Body) => (b.grounded && b.ground?.id === "floor") || (!b.grounded && b.y + b.hh >= FLOOR_Y - 1)
			? floorWave.at(b.x) : 0;

		/**
		 * The floor photo as one continuous mesh that bends like rubber: each column of vertices is
		 * pushed down by the wave, the walking surface most and the far edge least, so the texture
		 * stretches smoothly into the dent instead of being cut into slices.
		 */
		const FLOOR_ROWS = [[0, 0], [12, 0.35], [66, 1], [102, 0.85], [120, 0.5]] as const; // [px row in the 120-unit image, weight]
		function drawFloor() {
			const fl = SPRITES.floor;
			const data = k.getSprite(spriteKey("floor"))?.data;
			if (!data) return;
			const q = data.frames[0];
			const step = floorWave.strip;
			const cols = Math.ceil(fl.w / step) + 1;
			const pts: Vec2[] = [], uv: Vec2[] = [], indices: number[] = [];
			for (let c = 0; c < cols; c++) {
				const x = Math.min(fl.w, c * step);
				const dip = floorWave.d[Math.min(floorWave.n - 1, c)];
				for (const [row, weight] of FLOOR_ROWS) {
					pts.push(v(fl.x + x, fl.y + row + dip * weight));
					uv.push(v(q.x + (x / fl.w) * q.w, q.y + (row / fl.h) * q.h));
				}
			}
			const R = FLOOR_ROWS.length;
			for (let c = 0; c < cols - 1; c++) {
				for (let r = 0; r < R - 1; r++) {
					const i = c * R + r, j = (c + 1) * R + r;
					indices.push(i, j, i + 1, i + 1, j, j + 1);
				}
			}
			k.drawPolygon({ pts, uv, tex: data.tex, indices, triangulate: false });
		}

		// ---------- World drawing ----------
		k.add([k.z(0), {
			id: "worldArt",
			draw() {
				// The room shell, then the rippling floor, then every object in front of the floor.
				const room = SPRITES.room;
				k.drawSprite({ sprite: spriteKey("room"), pos: v(room.x, room.y), width: room.w, height: room.h });
				drawFloor();
				art.portrait(player.x);
				art.hatch(t, phase === "sliding", phase === "sliding" ? Math.min(1, slideT / 0.9) : 0);
				art.chandelier(t, swing, keyOnChandelier);
				for (const f of FURNITURE) art.furniture(f);
				art.rockingHorse(t, floorWave.at(760));

				for (const it of items) {
					if (!it.active || it.carried) continue;
					const r = itemRect(it);
					const bottom = v(r.x + r.w / 2, r.y + r.h + sinkAt(it.b));
					// Tumbling in flight, squashing on landing (around its centre / its base)
					k.pushTransform();
					k.pushTranslate(bottom.x, bottom.y - r.h / 2);
					if (it.rot) k.pushRotate(k.rad2deg(it.rot));
					k.pushTranslate(0, r.h / 2);
					if (it.squash) k.pushScale(1 + 0.12 * it.squash, 1 - 0.16 * it.squash);
					drawItem(k, it.def.sprite, { x: -r.w / 2, y: -r.h, w: r.w, h: r.h });
					k.popTransform();
				}

				if (import.meta.env.DEV && showHitboxes) {
					for (const r of [...solidsNow(), ...art.chandelierRects(t, swing, keyOnChandelier), ...art.hatchRects(), bodyRect(player)]) {
						k.drawRect({ pos: v(r.x, r.y), width: r.w, height: r.h, fill: false, outline: { width: 1, color: k.rgb(0, 255, 120) } });
					}
				}

				// Drop preview: a ghost of the item where it would land (tinted red if it can't go there)
				if (carrying && phase === "play") {
					const plan = dropPlan(carrying);
					drawItem(k, carrying.def.sprite, plan.rest, 0.35 + 0.1 * Math.sin(t * 6), plan.blocked ? k.rgb(255, 90, 80) : k.rgb(200, 220, 255));
				}

				// Player (squashes as it sinks into the vinyl)
				const py = player.y + sinkAt(player);
				const slideFade = phase === "sliding" ? Math.max(0, 1 - slideT * 1.2) : 1;
				if (slideFade > 0) doll.draw(player.x, py + player.hh, facing, slideFade);
				if (carrying) {
					// Held up over her head, bobbing with her arms
					const s = carrying.def.kind === "key" ? 1 : 0.7;
					const cw = carrying.def.w * s, ch = carrying.def.h * s;
					const bob = Math.sin(t * 2.3) * 1.5 + (player.grounded ? 0 : -4);
					drawItem(k, carrying.def.sprite, { x: player.x - cw / 2, y: py - player.hh - ch - 2 + bob, w: cw, h: ch });
				}
				// Double jump ready: a faint glimmer above the head while airborne
				if (!player.grounded && airJumpsLeft > 0 && phase === "play") {
					glow(k, v(player.x, py - player.hh - (carrying ? 40 : 10)), 9, k.rgb(160, 185, 230), 0.55 + 0.3 * Math.sin(t * 10));
				}
			},
		}]);

		// ---------- Screen-space: vignette, floor darkness, monster, HUD, menu (images + effects only) ----------
		k.add([k.fixed(), k.z(10), {
			id: "screenFx",
			draw() {
				const W = k.width(), H = k.height(), u = H / VIEW_HEIGHT;
				const ps = k.toScreen(center());

				if (fxOn) {
					// Vignette centred on the player
					const flick = dim > 0 ? 0.75 + 0.2 * Math.sin(t * 60) : 1;
					// The darkness breathes, and closes in as the monster grows angrier
					const size = H * 5 * flick * (1 + 0.035 * Math.sin(t * 0.7) - 0.12 * anger);
					k.drawSprite({ sprite: "vignette", pos: ps, width: size, height: size, anchor: "center" });
					// Old-film grain crawling over everything
					k.drawSprite({ sprite: "grain", pos: v(-Math.random() * 256, -Math.random() * 256), width: W + 256, height: H + 256, tiled: true, opacity: 0.1 + 0.08 * anger });
					// Now and then the room "hitches": a single blood-dark frame, like a skipped reel
					if (t % 9.7 < 0.06 || (anger > 0.4 && t % 4.3 < 0.04)) {
						k.drawSprite({ sprite: "shade", pos: v(0, 0), width: W, height: H, color: k.rgb(90, 0, 8), opacity: 0.45 });
					}
					// The floor's underside sinks into the darkness (below the floor's front edge, behind nothing).
					const fy = k.toScreen(v(0, FLOOR_Y + 8)).y;
					if (fy < H) k.drawSprite({ sprite: "floorShade", pos: v(0, fy), width: W, height: Math.max(H - fy, 90 * u) });
				}

				// Monster: a pale marble face (a photo-textured render) that fades in somewhere in the darkness.
				const m = SPRITES.monster;
				const green = k.rgb(150, 235, 180);
				const gs = k.toScreen(v(ghost.x, ghost.y));
				const breathe = 1 + 0.035 * Math.sin(t * 1.7);
				const mw = m.w * u * 1.05 * breathe * ghost.scale, mh = m.h * u * 1.05 * breathe * ghost.scale;
				const jitter = anger > 0.5 ? Math.sin(t * 31) * 1.2 * u : 0;
				const strength = (0.45 + 0.5 * Math.min(1, anger + 0.2) + monsterPulse * 0.2) * ghost.a;
				// Eye centres measured on the monster render (fractions of its width/height).
				const eyes = MONSTER_EYES.map((e) => gs.add(v((e.x - 0.5) * mw * ghost.flip + jitter, (e.y - 0.5) * mh)));
				// The blurred glow copy has MONSTER_GLOW_PAD px of padding around the same image: scale it to match.
				const gpx = m.w * 3, gpy = m.h * 3;
				const gw = mw * (gpx + 2 * MONSTER_GLOW_PAD) / gpx, gh = mh * (gpy + 2 * MONSTER_GLOW_PAD) / gpy;
				if (ghost.a > 0.01) {
					k.drawSprite({ sprite: "monster_glow", pos: gs.add(v(jitter, 0)), width: gw, height: gh, anchor: "center", color: green, opacity: strength * 0.75, flipX: ghost.flip < 0 });
					k.drawSprite({ sprite: spriteKey("monster"), pos: gs.add(v(jitter, 0)), width: mw, height: mh, anchor: "center", color: green, opacity: strength * 0.32, flipX: ghost.flip < 0 });
					for (const e of eyes) glow(k, e, 7 * u, green, strength * (0.55 + 0.45 * Math.sin(t * 3) ** 2));
				}

				if (blackout > 0) {
					ui.shade(0, 0, W, H, 0.94);
					// ...but its eyes still glow, wherever it is.
					for (const e of eyes) glow(k, e, 8 * u, green, 0.9);
				}

				if (!hideHud) drawHud(W, H, u);
				if (phase === "sliding") ui.shade(0, 0, W, H, Math.min(1, slideT / 1.4));
				if (lungeDark > 0) ui.shade(0, 0, W, H, lungeDark);
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
			// Title plaque with the air gauge (teaser: steady in Room I)
			ui.panel(m - 8 * u, m - 8 * u, 250 * u, 82 * u, 0.85);
			k.drawText({ text: ROOM_NUMBER.toUpperCase(), pos: v(m, m), size: 13 * u, color: pal.textDim, font: FONT });
			k.drawText({ text: ROOM_TITLE, pos: v(m, m + 16 * u), size: 24 * u, color: pal.text, font: FONT });
			const gy = m + 50 * u;
			k.drawText({ text: "AIR", pos: v(m, gy), size: 12 * u, color: pal.textDim, font: FONT });
			ui.gauge(m + 34 * u, gy + 1 * u, 140 * u, 11 * u, 1);
			k.drawText({ text: "steady", pos: v(m + 182 * u, gy), size: 12 * u, color: pal.textDim, font: FONT });
			// Timer and controls reminder
			const secs = Math.floor(elapsed);
			const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
			ui.panel(W - m - 200 * u, m - 8 * u, 208 * u, 58 * u, 0.85);
			k.drawText({ text: time, pos: v(W - m, m - 2 * u), size: 26 * u, color: pal.text, font: FONT, anchor: "topright" });
			k.drawText({ text: "E carry   R restart   Esc menu", pos: v(W - m, m + 30 * u), size: 12 * u, color: pal.textDim, font: FONT, anchor: "topright" });

			const hint = hintText();
			const hw = Math.min(W - 2 * m, 640 * u);
			ui.panel(W / 2 - hw / 2, H - m - 44 * u, hw, 44 * u, 0.9);
			k.drawText({ text: hint, pos: v(W / 2, H - m - 22 * u), size: 15 * u, width: hw - 24 * u, align: "center", color: pal.text, font: FONT, anchor: "center" });

			if (toastT > 0) {
				const rise = Math.min(1, (2.4 - Math.min(2.4, toastT)) * 5);
				k.drawText({ text: toast, pos: v(W / 2, H - m - (52 + 12 * rise) * u), size: 15 * u, color: pal.yellow, font: FONT, anchor: "center", opacity: Math.min(1, toastT * 2, rise) });
			}

			if (anger > 0.4 && ghost.a > 0.5) {
				k.drawText({ text: "Something watches from the dark...", pos: v(W / 2, m + 8 * u), size: 15 * u, color: pal.monster, font: FONT, anchor: "top", opacity: Math.min(1, (anger - 0.4) * 3) * ghost.a });
			}
		}

		function drawMenu(W: number, H: number, u: number) {
			ui.shade(0, 0, W, H, 0.72);
			const pw = 520 * u, ph = 360 * u;
			ui.panel(W / 2 - pw / 2, H * 0.12, pw, ph, 0.95);
			k.drawText({ text: "Paused", pos: v(W / 2, H * 0.22), size: 46 * u, color: pal.text, font: FONT, anchor: "center" });
			ui.clearButtons();
			if (showControls) {
				const lines = [
					"A / D or Left / Right - shuffle along (drift in the air)",
					"W / Space / Up - jump; again in mid-air to double jump",
					"Hold S on the floor - sink in; let go to spring up high",
					"Hold S while bouncing - dig in and stop bouncing",
					"E - pick up / put down (the pointer picks the spot)",
					"R - restart room      Esc - menu",
				];
				lines.forEach((l, i) => k.drawText({ text: l, pos: v(W / 2, H * 0.32 + i * 24 * u), size: 15 * u, color: pal.text, font: FONT, anchor: "center" }));
				ui.button("Back", W / 2, H * 0.32 + lines.length * 24 * u + 24 * u, u, () => { showControls = false; });
				return;
			}
			ui.button("Resume", W / 2, H * 0.36, u, () => { paused = false; });
			ui.button("Restart room", W / 2, H * 0.36 + 56 * u, u, () => k.go("game"));
			ui.button("Controls", W / 2, H * 0.36 + 112 * u, u, () => { showControls = true; });
		}

		function clickMenu(p: Vec2) {
			ui.click(p);
		}
	});
}
