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

/** A surface must be under at least this much of a body's width to hold it up. */
const EDGE = 1;

/** Is there a solid directly under the body's feet? */
export function findSupport(b: Body, solids: Solid[]): Solid | null {
	const feet = b.y + b.hh;
	for (const s of solids) {
		if (Math.abs(s.y - feet) <= 1.5 && b.x + b.hw > s.x + EDGE && b.x - b.hw < s.x + s.w - EDGE) return s;
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
	/** Ledges up to this tall at the feet are stepped onto instead of blocking sideways motion. */
	stepUp = 0,
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

	// Surfaces follow the sprites' pixels, so a piece of furniture is a stack of rects with small
	// ledges between them (a carved crown, a moulding). Each axis is resolved against the single
	// nearest blocking rect, so overlapping a neighbouring rect never flips the resolution.
	const hitting = () => solids.filter((s) => overlaps(bodyRect(b), s));

	// X axis
	b.x += b.vx * dt;
	if (b.vx !== 0) {
		let hits = hitting();
		// A low ledge at the feet (falling onto or drifting into a stepped top) is stepped up onto,
		// not bounced off, as long as there's room above it.
		const feet = b.y + b.hh;
		if (stepUp > 0 && b.vy >= 0 && hits.length && hits.every((s) => s.y >= feet - stepUp)) {
			const top = Math.min(...hits.map((s) => s.y));
			const lifted = { ...bodyRect(b), y: top - b.hh * 2 };
			if (!solids.some((s) => overlaps(lifted, s, 0.01))) { b.y = top - b.hh; hits = []; }
		}
		if (hits.length) {
			const s = b.vx > 0 ? hits.reduce((a, c) => (c.x < a.x ? c : a)) : hits.reduce((a, c) => (c.x + c.w > a.x + a.w ? c : a));
			b.x = b.vx > 0 ? s.x - b.hw : s.x + s.w + b.hw;
			impacts.push({ speed: Math.abs(b.vx), solid: s, axis: "x", fromAbove: false });
			b.vx = -b.vx * s.bounce * bounceScale;
		}
	}

	// Y axis
	b.y += b.vy * dt;
	let hits = b.vy !== 0 ? hitting() : [];
	if (b.vy > 0) {
		// A sliver of a ledge (less than findSupport's EDGE) can't hold you: slide off it instead of
		// landing on it, or you'd hover on its corner, neither standing nor falling.
		for (const s of hits) {
			const over = Math.min(b.x + b.hw, s.x + s.w) - Math.max(b.x - b.hw, s.x);
			if (over >= EDGE) continue;
			b.x = s.x + s.w / 2 < b.x ? s.x + s.w + b.hw : s.x - b.hw;
		}
		hits = hitting();
	}
	if (hits.length && b.vy > 0) {
		const s = hits.reduce((a, c) => (c.y < a.y ? c : a)); // the highest top
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
	} else if (hits.length && b.vy < 0) {
		const s = hits.reduce((a, c) => (c.y + c.h > a.y + a.h ? c : a)); // the lowest underside
		b.y = s.y + s.h + b.hh;
		impacts.push({ speed: -b.vy, solid: s, axis: "y", fromAbove: false });
		b.vy = -b.vy * s.bounce * bounceScale;
	}

	return impacts;
}
