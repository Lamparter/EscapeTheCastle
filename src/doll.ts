import type { KAPLAYCtx } from "kaplay";
import { spriteKey } from "./sprites";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * The player: a real Victorian bisque doll (Rijksmuseum BK-1972-141, CC0), cut into parts,
 * re-proportioned like a dancer and dressed as a goth ballerina (black curls, satin bodice, lace ruff,
 * tulle tutu, pointe shoes), animated as a cut-out rig. See tools/cut_doll.py and tools/pose_sheet.py. Every part is a photo layer of the same size; each one is
 * rotated about its joint, and the whole body is squashed, stretched, leaned and spun.
 *
 * She faces the viewer, so limbs move like a marionette's: "out" angles raise both arms (or legs)
 * outwards, mirrored; "swing" angles sway them together. Degrees, clockwise on screen.
 */

export interface DollInput {
	grounded: boolean;
	walking: boolean;
	vx: number;
	vy: number;
	/** 0..1, how far she has sunk into the floor (holding S). */
	sink: number;
	carrying: boolean;
	facing: number;
}

type Pose = {
	armOut: number; armSwing: number;
	legOut: number; legSwing: number; walk: number;
	head: number; skirt: number; lean: number;
	bob: number; sx: number; sy: number; skirtSx: number; skirtSy: number;
};

const REST: Pose = { armOut: 0, armSwing: 0, legOut: 0, legSwing: 0, walk: 0, head: 0, skirt: 0, lean: 0, bob: 0, sx: 1, sy: 1, skirtSx: 1, skirtSy: 1 };

const P = SPRITES.pdoll.pivots;
/** Offsets below are tuned in units of the original 112-unit doll; scale them with her size. */
const U = SPRITES.pdoll.h / 112;

export function makeDoll(k: KAPLAYCtx) {
	const pose: Pose = { ...REST };
	let t = 0;
	let walkPhase = 0;
	let squash = 0;       // landing squash, decays
	let stretch = 0;      // take-off stretch, decays
	let spin = 0;         // double-jump twirl progress (1 -> 0)
	let twitch = 0;       // creepy head twitch, decays
	let twitchDir = 1;
	let nextTwitch = 4 + Math.random() * 5;

	const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);

	return {
		/** A hard landing: squash, and her head jolts. */
		land(speed: number) {
			squash = Math.max(squash, Math.min(1, speed / 700));
			if (speed > 500) { twitch = Math.max(twitch, 0.6); twitchDir = Math.random() < 0.5 ? -1 : 1; }
		},
		jump(strength: number) { stretch = Math.max(stretch, 0.4 + strength * 0.6); },
		twirl() { spin = 1; },

		update(dt: number, s: DollInput) {
			t += dt;
			squash = Math.max(0, squash - dt * 5);
			stretch = Math.max(0, stretch - dt * 4);
			spin = Math.max(0, spin - dt / 0.38);
			twitch = Math.max(0, twitch - dt * 2.2);
			nextTwitch -= dt;
			if (nextTwitch <= 0 && s.grounded) { twitch = 1; twitchDir = Math.random() < 0.5 ? -1 : 1; nextTwitch = 5 + Math.random() * 6; }

			const target: Pose = { ...REST };
			const breath = Math.sin(t * 2.3);
			if (s.grounded) {
				if (s.walking) {
					// A stiff, waddling doll walk: rock side to side, lift each leg in turn, arms swaying
					walkPhase += dt * 9;
					const w = Math.sin(walkPhase);
					target.walk = 1;
					target.armOut = 7;
					target.armSwing = 16 * w;
					target.legSwing = 6 * w;
					target.lean = 5 * w + 3;
					target.bob = -Math.abs(Math.cos(walkPhase)) * 3 * U;
					target.skirt = -4 * w;
					target.head = -3 * w;
				} else {
					// Idle: breathing, a slow sway, the head drifting to one side
					target.armOut = 3 + 2 * Math.sin(t * 1.3);
					target.armSwing = 2 * Math.sin(t * 0.8);
					target.bob = breath * 0.6 * U;
					target.head = 5 * Math.sin(t * 0.55) - 4;
					target.skirt = 1.5 * Math.sin(t * 0.9);
				}
				if (s.sink > 0) {
					// Digging into the vinyl: crouch, arms out for balance
					target.sy = 1 - 0.3 * s.sink;
					target.sx = 1 + 0.16 * s.sink;
					target.armOut = 60 * s.sink;
					target.legOut = 8 * s.sink;
					target.head = 6 * s.sink;
					target.skirtSx = 1 + 0.15 * s.sink;
				}
			} else if (s.vy < 0) {
				// Rising: arms flung up, legs together, skirt flaring
				target.armOut = 150;
				target.legOut = -4;
				target.skirtSx = 1.12;
				target.skirtSy = 0.92;
				target.head = -4;
				target.lean = Math.max(-14, Math.min(14, s.vx * 0.04));
			} else {
				// Falling: arms flailing overhead, legs kicking, the skirt billowing up
				const flail = Math.sin(t * 19);
				target.armOut = 160 + 12 * flail;
				target.armSwing = 10 * Math.sin(t * 13);
				target.legOut = 12;
				target.legSwing = 10 * Math.sin(t * 15);
				target.skirtSx = 1.2;
				target.skirtSy = 0.84;
				target.head = 8;
				target.lean = Math.max(-14, Math.min(14, s.vx * 0.04));
			}
			if (s.carrying) {
				// Holding the item up over her head
				target.armOut = 168 + 3 * breath;
				target.armSwing = 0;
			}

			const r = s.grounded ? 14 : 10;
			for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key] = ease(pose[key], target[key], r, dt);
		},

		/** Draw with the feet at (x, feetY). */
		draw(x: number, feetY: number, facing: number, opacity = 1) {
			const s = SPRITES.pdoll;
			const sx = pose.sx * (1 + 0.22 * squash - 0.15 * stretch);
			const sy = pose.sy * (1 - 0.26 * squash + 0.24 * stretch);
			const twirl = spin > 0 ? Math.cos((1 - spin) * Math.PI * 2) : 1;
			const headTwitch = twitch > 0 ? 18 * twitchDir * Math.sin(Math.min(1, (1 - twitch) * 6) * Math.PI / 2) * twitch : 0;
			// Walking: each leg lifts in turn
			const lift = 3.5 * U * pose.walk;
			const liftL = -Math.max(0, Math.sin(walkPhase)) * lift, liftR = -Math.max(0, -Math.sin(walkPhase)) * lift;

			const part = (name: SpriteName, pivot: readonly number[], angle: number, dy = 0, scaleX = 1, scaleY = 1) => {
				k.pushTransform();
				k.pushTranslate(pivot[0], pivot[1] + dy);
				if (angle) k.pushRotate(angle);
				if (scaleX !== 1 || scaleY !== 1) k.pushScale(scaleX, scaleY);
				k.pushTranslate(-pivot[0], -pivot[1]);
				k.drawSprite({ sprite: spriteKey(name), pos: k.vec2(0, 0), width: s.w, height: s.h, opacity });
				k.popTransform();
			};

			k.pushTransform();
			k.pushTranslate(x, feetY);
			k.pushScale((facing < 0 ? -1 : 1) * twirl, 1);
			k.pushRotate(pose.lean);
			k.pushScale(sx, sy);
			k.pushTranslate(-P.feet[0], -P.feet[1] + pose.bob);
			// Back to front: legs, body (bodice), skirt, head, arms
			part("pdoll_leg_l", P.hip_l, pose.legOut + pose.legSwing, liftL);
			part("pdoll_leg_r", P.hip_r, -pose.legOut + pose.legSwing, liftR);
			part("pdoll_body", P.waist, pose.skirt * 0.25);
			part("pdoll_skirt", P.waist, pose.skirt, 0, pose.skirtSx, pose.skirtSy);
			part("pdoll_head", P.neck, pose.head + headTwitch);
			part("pdoll_arm_l", P.shoulder_l, pose.armOut + pose.armSwing);
			part("pdoll_arm_r", P.shoulder_r, -pose.armOut + pose.armSwing);
			k.popTransform();
		},
	};
}
