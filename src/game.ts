import type { KAPLAYCtx, Vec2 } from "kaplay";
import { FONT, PHYS, VIEW_HEIGHT, type Palette } from "./config";
import { drawItem, drawPlayer, glow, makeRoomArt } from "./draw";
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
		let monsterX = player.x;
		let flickerT = 6 + Math.random() * 6;
		let blackout = 0;
		let dim = 0;
		let fxOn = true; // dev toggle: hide vignette/darkness to inspect the art
		let showHitboxes = false; // dev toggle: outline every solid (debug only)

		const floorWave = makeFloorWave(ROOM.w, 12);

		const items: Item[] = ITEMS.map((def) => ({
			def,
			carried: false,
			active: !def.hidden,
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
				player, items, toggleCarry, floorWave,
				fx(on: boolean) { fxOn = on; },
				hitboxes(on: boolean) { showHitboxes = on; },
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
					const STEP = 9, feet = player.y + player.hh;
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
				const impacts = stepBody(player, sub, solidsNow(), PHYS.gravity, PHYS.settleSpeed, bounceScale);
				for (const im of impacts) {
					if (im.speed > 600) k.shake(Math.min(6, im.speed / 180));
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
				// The room shell, then the rippling floor, then every object in front of the floor.
				const room = SPRITES.room;
				k.drawSprite({ sprite: spriteKey("room"), pos: v(room.x, room.y), width: room.w, height: room.h });
				const fl = SPRITES.floor;
				const w = floorWave.strip;
				for (let i = 0; i < floorWave.n - 1; i++) {
					const x = i * w;
					if (x >= fl.w) break;
					const sw = Math.min(w, fl.w - x);
					k.drawSprite({
						sprite: spriteKey("floor"),
						pos: v(fl.x + x, fl.y + floorWave.d[i]),
						width: sw + 0.6,
						height: fl.h,
						quad: k.quad(x / fl.w, 0, sw / fl.w, 1),
					});
				}
				art.portrait(player.x);
				art.hatch(t, phase === "sliding", phase !== "sliding");
				art.chandelier(t, swing, keyOnChandelier);
				for (const f of FURNITURE) art.furniture(f);
				art.rockingHorse(t, floorWave.at(760));

				for (const it of items) {
					if (!it.active || it.carried) continue;
					const r = itemRect(it);
					drawItem(k, it.def.sprite, { ...r, y: r.y + sinkAt(it.b) });
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
				if (slideFade > 0) drawPlayer(k, player.x, py + player.hh, player.hw, player.vy + sink * 700, facing, t);
				if (carrying) {
					const s = carrying.def.kind === "key" ? 1 : 0.7;
					const cw = carrying.def.w * s, ch = carrying.def.h * s;
					drawItem(k, carrying.def.sprite, { x: player.x - cw / 2, y: py - player.hh - ch - 4, w: cw, h: ch });
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
					const size = H * 5 * flick;
					k.drawSprite({ sprite: "vignette", pos: ps, width: size, height: size, anchor: "center" });
					// The floor's underside sinks into the darkness (below the floor's front edge, behind nothing).
					const fy = k.toScreen(v(0, FLOOR_Y + 8)).y;
					if (fy < H) k.drawSprite({ sprite: "floorShade", pos: v(0, fy), width: W, height: Math.max(H - fy, 90 * u) });
				}

				// Monster: a pale face (a photo-textured render) glowing up through the dark beneath the floor.
				const ms = k.toScreen(v(monsterX, FLOOR_Y + 70));
				const m = SPRITES.monster;
				const presence = 0.12 + anger * 0.4 + monsterPulse * 0.25;
				const mw = m.w * u * 1.1, mh = m.h * u * 1.1;
				const green = k.rgb(150, 235, 180);
				k.drawSprite({ sprite: "monster_glow", pos: ms, width: mw * 1.6, height: mh * 1.6, anchor: "center", color: green, opacity: presence * 0.9 });
				k.drawSprite({ sprite: spriteKey("monster"), pos: ms, width: mw, height: mh, anchor: "center", color: green, opacity: presence * 0.35 });
				const eyeOpen = Math.min(1, anger * 1.6 + monsterPulse * 0.6);
				const eyes = [ms.add(v(-0.13 * mw, -0.22 * mh)), ms.add(v(0.1 * mw, -0.22 * mh))];
				if (eyeOpen > 0.15) for (const e of eyes) glow(k, e, 14 * u * eyeOpen, green, 0.3 + 0.6 * eyeOpen);

				if (blackout > 0) {
					ui.shade(0, 0, W, H, 0.94);
					// ...but the eyes still glow.
					for (const e of eyes) glow(k, e, 14 * u, green, 0.9);
				}

				drawHud(W, H, u);
				if (phase === "sliding") ui.shade(0, 0, W, H, Math.min(1, slideT / 1.4));
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
				k.drawText({ text: toast, pos: v(W / 2, H - m - 64 * u), size: 15 * u, color: pal.yellow, font: FONT, anchor: "center", opacity: Math.min(1, toastT * 2) });
			}

			if (anger > 0.6) {
				k.drawText({ text: "Something beneath the floorboards stirs...", pos: v(W / 2, m + 8 * u), size: 15 * u, color: pal.monster, font: FONT, anchor: "top", opacity: (anger - 0.6) * 3 });
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
