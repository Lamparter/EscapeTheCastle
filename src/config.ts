import type { KAPLAYCtx } from "kaplay";

/** The camera always shows this many world units vertically; width depends on aspect ratio. */
export const VIEW_HEIGHT = 540;

export const FONT = `Georgia, "Times New Roman", serif`;

export const PHYS = {
	gravity: 1400,
	/** Launch speed at 0% and 100% charge. Full power reaches ~300 units straight up. */
	minLaunch: 240,
	maxLaunch: 920,
	/** Seconds for the charge bar to go from empty to full (it then swings back down). */
	chargeSweep: 0.9,
	/** A tap (shorter than this, in seconds) is a quick hop; holding this long starts a charge. */
	holdToCharge: 0.2,
	/** Speed of the quick hop. */
	hopSpeed: 470,
	/** A hop pressed in mid-air waits this long for you to touch a surface. */
	hopBuffer: 0.3,
	/** A charged launch pressed in mid-air waits this long for you to touch a surface. */
	launchBuffer: 1.5,
	/** You can still jump this long after leaving a surface (bouncy floors rarely let you rest). */
	contactGrace: 0.08,
	/** Hard floor landings shove you sideways by up to this much: the castle is uneven and chaotic. */
	floorChaos: 90,
	/** Seconds the bar stays at 100% before swinging back down. */
	chargeHold: 0.35,
	/** Below this impact speed a landing settles instead of bouncing again. */
	settleSpeed: 160,
	/** Horizontal acceleration and speed cap for the slight air drift. */
	driftAccel: 520,
	driftMax: 260,
	/** Max distance from the player's centre for picking up / putting down furniture. */
	reach: 120,
	substeps: 4,
};

/** Dark, desaturated bouncy-castle palette. Call once a KAPLAY context exists. */
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
