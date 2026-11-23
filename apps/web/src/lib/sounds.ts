/**
 * Sound effects for the TV, synthesised with the Web Audio API: no audio files to
 * license or ship. Browsers only allow sound after a click on the page, which the
 * TV already asks for (YouTube/Spotify).
 */

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundsEnabled(on: boolean) {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.2, slideTo?: number) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sounds = {
  /** A team buzzed: a short game-show buzzer. */
  buzz() {
    tone(180, 0, 0.45, "square", 0.18);
    tone(240, 0, 0.45, "sawtooth", 0.08);
  },
  /** Right answer. */
  correct() {
    tone(880, 0, 0.18, "triangle", 0.25);
    tone(1318, 0.12, 0.35, "triangle", 0.25);
  },
  /** Wrong answer. */
  wrong() {
    tone(220, 0, 0.5, "sawtooth", 0.15, 110);
  },
  /** Answer revealed. */
  reveal() {
    tone(523, 0, 0.12, "triangle", 0.2);
    tone(659, 0.1, 0.12, "triangle", 0.2);
    tone(784, 0.2, 0.3, "triangle", 0.22);
  },
  /** Last seconds of a timer. */
  tick() {
    tone(1200, 0, 0.05, "square", 0.06);
  },
  /** Drum roll before the winner (about 2.5 s). */
  drumroll() {
    for (let i = 0; i < 30; i++) tone(90 + (i % 2) * 8, i * 0.08, 0.07, "triangle", 0.12 + i * 0.004);
  },
  /** The winner. */
  fanfare() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((f, i) => tone(f, i * 0.16, i === notes.length - 1 ? 0.8 : 0.18, "triangle", 0.25));
  },
};
