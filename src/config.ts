import type { KAPLAYCtx } from "kaplay";

/** The camera always shows this many world units vertically; width depends on aspect ratio. */
export const VIEW_HEIGHT = 540;

export const FONT = `Georgia, "Times New Roman", serif`;

export const PHYS = {
	/** Low gravity: everything floats and flies further, for a chaotic feel. */
	gravity: 900,
	/** W / Space jump speed (~110 units high). The double jump uses the same speed. */
	jumpSpeed: 445,
	/** Air jumps available before you touch a surface again. */
	airJumps: 1,
	/** Springing out of the floor with S: speed at the shallowest and deepest dent (~320 high). */
	springMin: 445,
	springMax: 760,
	/** Seconds of holding S to sink fully into the vinyl, and how deep that looks. */
	sinkTime: 0.7,
	sinkDepth: 34,
	/** Holding S while bouncing "digs in": bounces keep only this fraction of their usual energy. */
	digInBounce: 0.3,
	/** Slow walking on surfaces with A / D. */
	walkSpeed: 120,
	/** A jump pressed in mid-air (with no air jump left) waits this long for a landing. */
	jumpBuffer: 0.15,
	/** You can still ground-jump this long after touching a surface. */
	contactGrace: 0.08,
	/** Hard floor landings shove you sideways by up to this much: the bouncy floor is uneven and chaotic. */
	floorChaos: 80,
	/** Below this impact speed a landing settles instead of bouncing again. */
	settleSpeed: 110,
	/** Horizontal acceleration and speed cap for air drift with A / D. */
	driftAccel: 420,
	driftMax: 170,
	/** Max distance from the player's centre for picking up / putting down furniture. */
	reach: 120,
	substeps: 4,
	/** Ledges this tall or lower (the steps in carved furniture tops) are walked and drifted up onto. */
	stepUp: 9,
};

/** Dark, desaturated UI/effects palette. Call once a KAPLAY context exists. */
export function makePalette(k: KAPLAYCtx) {
	return {
		void: k.rgb(6, 5, 9),
		red: k.rgb(86, 34, 40),
		redDark: k.rgb(56, 22, 28),
		blue: k.rgb(32, 44, 80),
		blueDark: k.rgb(20, 28, 54),
		yellow: k.rgb(104, 86, 38),
		yellowDark: k.rgb(70, 58, 26),
		green: k.rgb(32, 68, 48),
		greenDark: k.rgb(20, 46, 32),
		wood: k.rgb(62, 40, 28),
		woodDark: k.rgb(38, 24, 18),
		gold: k.rgb(138, 110, 58),
		linen: k.rgb(132, 124, 112),
		linenDark: k.rgb(92, 84, 76),
		moon: k.rgb(120, 140, 170),
		flame: k.rgb(255, 196, 120),
		skin: k.rgb(196, 170, 150),
		gown: k.rgb(170, 164, 176),
		monster: k.rgb(150, 220, 170),
		text: k.rgb(226, 214, 196),
		textDim: k.rgb(150, 140, 128),
		danger: k.rgb(200, 70, 70),
	};
}

export type Palette = ReturnType<typeof makePalette>;
