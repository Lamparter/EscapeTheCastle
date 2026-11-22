import type { AudioPlay, KAPLAYCtx } from "kaplay";

/**
 * Music and sound effects (all CC0, from OpenGameArt; see CREDITS.md).
 * Music streams (loadMusic) so the 14 MB ambience doesn't hold up loading.
 */
export function loadAudio(k: KAPLAYCtx) {
	k.loadMusic("music_title", "audio/music_title.mp3");
	k.loadMusic("music_game", "audio/music_game.ogg");
	k.loadSound("scream", "audio/scream.mp3");
	k.loadSound("sting", "audio/sting.mp3");
}

let current: { name: string; play: AudioPlay } | null = null;
let muted = false;

/** Start a looping track (keeps it playing if it's already the current one). */
export function playMusic(k: KAPLAYCtx, name: string, volume: number) {
	if (current?.name === name) return;
	current?.play.stop();
	current = { name, play: k.play(name, { loop: true, volume: muted ? 0 : volume }) };
	(current.play as AudioPlay & { baseVolume?: number }).baseVolume = volume;
}

/** Duck or restore the music (0..1 of its base volume). */
export function musicLevel(level: number) {
	if (!current || muted) return;
	const base = (current.play as AudioPlay & { baseVolume?: number }).baseVolume ?? 1;
	current.play.volume = base * level;
}

export function sfx(k: KAPLAYCtx, name: string, volume = 1, detune = 0) {
	if (muted) return;
	k.play(name, { volume, detune });
}

/** M toggles all sound. */
export function toggleMute() {
	muted = !muted;
	if (current) {
		const base = (current.play as AudioPlay & { baseVolume?: number }).baseVolume ?? 1;
		current.play.volume = muted ? 0 : base;
	}
	return muted;
}
