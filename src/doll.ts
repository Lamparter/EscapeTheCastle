import type { KAPLAYCtx } from "kaplay";
import { spriteKey } from "./sprites";
import { SPRITES, type SpriteName } from "./sprites.generated";

/**
 * The player: a Victorian Gothic porcelain doll, animated as a cut-out rig.
 *
 * Each body part is its own photoreal render layer (all the same size and alignment), and the
 * render script exported the joint positions. Here every part is rotated about its joint, and the
 * whole body is squashed, stretched, leaned and spun, all as transforms on the images.
 *
 * Angles are in degrees, clockwise on screen, for the doll facing right (mirrored when facing left).
 * A limb hanging down at 0 swings forward at negative angles and backwards at positive ones.
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
	armFront: number; armBack: number;
	legFront: number; legBack: number;
	head: number; skirt: number; lean: number;
	bob: number; sx: number; sy: number; skirtSx: number; skirtSy: number;
};

const REST: Pose = { armFront: 0, armBack: 0, legFront: 0, legBack: 0, head: 0, skirt: 0, lean: 0, bob: 0, sx: 1, sy: 1, skirtSx: 1, skirtSy: 1 };

const P = SPRITES.doll.pivots;

export function makeDoll(k: KAPLAYCtx) {
	const pose: Pose = { ...REST };
	let t = 0;
	let walkPhase = 0;
	let squash = 0;       // landing squash, decays
	let stretch = 0;      // take-off stretch, decays
	let spin = 0;         // double-jump twirl progress (1 -> 0)
	let twitch = 0;       // creepy head twitch, decays
	let nextTwitch = 4 + Math.random() * 5;
	let nextBlink = 2 + Math.random() * 3;
	let blink = 0;

	const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);

	return {
		/** A hard landing: squash, and the sleep-eyes clack shut for a moment. */
		land(speed: number) {
			squash = Math.max(squash, Math.min(1, speed / 700));
			if (speed > 450) blink = 0.18;
		},
		jump(strength: number) { stretch = Math.max(stretch, 0.4 + strength * 0.6); },
		twirl() { spin = 1; },

		update(dt: number, s: DollInput) {
			t += dt;
			squash = Math.max(0, squash - dt * 5);
			stretch = Math.max(0, stretch - dt * 4);
			spin = Math.max(0, spin - dt / 0.38);
			twitch = Math.max(0, twitch - dt * 2.2);
			blink = Math.max(0, blink - dt);
			nextBlink -= dt;
			if (nextBlink <= 0) { blink = 0.13; nextBlink = 2.5 + Math.random() * 3.5; }
			nextTwitch -= dt;
			if (nextTwitch <= 0 && s.grounded) { twitch = 1; nextTwitch = 5 + Math.random() * 6; }

			const target: Pose = { ...REST };
			const breath = Math.sin(t * 2.3);
			if (s.grounded) {
				if (s.walking) {
					walkPhase += dt * 10;
					const w = Math.sin(walkPhase);
					target.armFront = 24 * w;
					target.armBack = -24 * w;
					target.legFront = -20 * w;
					target.legBack = 20 * w;
					target.bob = -Math.abs(Math.cos(walkPhase)) * 2.6;
					target.skirt = 3 * Math.sin(walkPhase * 2);
					target.head = 2.5 * w;
					target.lean = 4;
				} else {
					// Idle: breathing, a slow sway, and the head drifting to one side
					target.armFront = 3 * Math.sin(t * 1.3);
					target.armBack = -3 * Math.sin(t * 1.3 + 0.6);
					target.bob = breath * 0.6;
					target.head = 4 * Math.sin(t * 0.55) - 3;
					target.skirt = 1.2 * Math.sin(t * 0.9);
				}
				if (s.sink > 0) {
					// Digging into the vinyl: crouch down, arms out for balance
					target.sy = 1 - 0.3 * s.sink;
					target.sx = 1 + 0.16 * s.sink;
					target.armFront = -55 * s.sink;
					target.armBack = 50 * s.sink;
					target.head = 8 * s.sink;
					target.skirtSx = 1 + 0.12 * s.sink;
				}
			} else if (s.vy < 0) {
				// Rising: arms reach up, legs tuck, the skirt flares
				target.armFront = -150;
				target.armBack = -125;
				target.legFront = -25;
				target.legBack = 18;
				target.skirtSx = 1.1;
				target.skirtSy = 0.92;
				target.head = -6;
				target.lean = Math.max(-14, Math.min(14, s.vx * 0.04));
			} else {
				// Falling: arms flail above the head, the skirt billows up
				const flail = Math.sin(t * 19);
				target.armFront = -165 + 14 * flail;
				target.armBack = -140 - 14 * flail;
				target.legFront = 12 + 8 * Math.sin(t * 14);
				target.legBack = -10 - 8 * Math.sin(t * 14);
				target.skirtSx = 1.16;
				target.skirtSy = 0.86;
				target.head = 8;
				target.lean = Math.max(-14, Math.min(14, s.vx * 0.04));
			}
			if (s.carrying) {
				// Holding the item up over her head with both hands
				target.armFront = -172 + 3 * breath;
				target.armBack = -160 + 3 * breath;
			}

			const r = s.grounded ? 14 : 10;
			for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key] = ease(pose[key], target[key], r, dt);
		},

		/** Draw with the feet at (x, feetY). */
		draw(x: number, feetY: number, facing: number, opacity = 1) {
			const s = SPRITES.doll;
			const sq = squash, st = stretch;
			const sx = pose.sx * (1 + 0.22 * sq - 0.15 * st);
			const sy = pose.sy * (1 - 0.26 * sq + 0.24 * st);
			const twirl = spin > 0 ? Math.cos((1 - spin) * Math.PI * 2) : 1;
			const headTwitch = twitch > 0 ? 17 * Math.sin(Math.min(1, (1 - twitch) * 6) * Math.PI / 2) * twitch : 0;
			const eyesShut = blink > 0 || twitch > 0.85;

			const part = (name: SpriteName, pivot: readonly number[], angle: number, scaleX = 1, scaleY = 1) => {
				k.pushTransform();
				k.pushTranslate(pivot[0], pivot[1]);
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
			// Back to front: far ringlets, far arm, legs, skirt, bodice, head, near arm
			part("doll_hair", P.neck, pose.head * 0.5 + headTwitch * 0.4);
			part("doll_arm_back", P.shoulder_back, pose.armBack);
			part("doll_leg_back", P.hip_back, pose.legBack);
			part("doll_leg_front", P.hip_front, pose.legFront);
			part("doll_skirt", P.waist, pose.skirt, pose.skirtSx, pose.skirtSy);
			part("doll_torso", P.waist, pose.skirt * 0.3);
			part(eyesShut ? "doll_head_blink" : "doll_head", P.neck, pose.head + headTwitch);
			part("doll_arm_front", P.shoulder_front, pose.armFront);
			k.popTransform();
		},
	};
}
