/**
 * Tiny custom AABB physics. KAPLAY's built-in body() stops on contact; a bouncy room
 * needs restitution, so the player and furniture are simulated here instead.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Solid extends Rect {
	/** Restitution: 0 = dead stop, 1 = perfectly elastic. */
	bounce: number;
	id: string;
}

export interface Body {
	/** Centre position. */
	x: number;
	y: number;
	hw: number;
	hh: number;
	vx: number;
	vy: number;
	grounded: boolean;
	ground: Solid | null;
}

export interface ImpactInfo {
	speed: number;
	solid: Solid;
	axis: "x" | "y";
	/** True when the body hit the top of the solid (a landing). */
	fromAbove: boolean;
}

export function overlaps(a: Rect, b: Rect, eps = 0): boolean {
	return a.x < b.x + b.w - eps && a.x + a.w > b.x + eps && a.y < b.y + b.h - eps && a.y + a.h > b.y + eps;
}

export function bodyRect(b: Body): Rect {
	return { x: b.x - b.hw, y: b.y - b.hh, w: b.hw * 2, h: b.hh * 2 };
}

/** Is there a solid directly under the body's feet? */
export function findSupport(b: Body, solids: Solid[]): Solid | null {
	const feet = b.y + b.hh;
	for (const s of solids) {
		if (Math.abs(s.y - feet) <= 1.5 && b.x + b.hw > s.x + 1 && b.x - b.hw < s.x + s.w - 1) return s;
	}
	return null;
}

/**
 * Advance a body by dt. Returns impacts so the game can react (shake, tears, anger...).
 */
export function stepBody(
	b: Body,
	dt: number,
	solids: Solid[],
	gravity: number,
	settleSpeed: number,
	/** Multiplies each surface's restitution (heavy objects bounce less). */
	bounceScale = 1,
): ImpactInfo[] {
	const impacts: ImpactInfo[] = [];

	if (b.grounded) {
		const s = findSupport(b, solids);
		if (s) {
			b.ground = s;
			b.vx = 0;
			b.vy = 0;
			return impacts;
		}
		b.grounded = false;
		b.ground = null;
	}

	b.vy += gravity * dt;

	// X axis
	b.x += b.vx * dt;
	for (const s of solids) {
		if (!overlaps(bodyRect(b), s)) continue;
		if (b.vx > 0) b.x = s.x - b.hw;
		else if (b.vx < 0) b.x = s.x + s.w + b.hw;
		else continue;
		impacts.push({ speed: Math.abs(b.vx), solid: s, axis: "x", fromAbove: false });
		b.vx = -b.vx * s.bounce * bounceScale;
	}

	// Y axis
	b.y += b.vy * dt;
	for (const s of solids) {
		if (!overlaps(bodyRect(b), s)) continue;
		if (b.vy > 0) {
			b.y = s.y - b.hh;
			impacts.push({ speed: b.vy, solid: s, axis: "y", fromAbove: true });
			if (b.vy * s.bounce * bounceScale < settleSpeed) {
				b.vy = 0;
				b.vx = 0;
				b.grounded = true;
				b.ground = s;
			} else {
				b.vy = -b.vy * s.bounce * bounceScale;
				b.vx *= 0.8; // vinyl grabs a little on each bounce
			}
		} else if (b.vy < 0) {
			b.y = s.y + s.h + b.hh;
			impacts.push({ speed: -b.vy, solid: s, axis: "y", fromAbove: false });
			b.vy = -b.vy * s.bounce * bounceScale;
		}
	}

	return impacts;
}
