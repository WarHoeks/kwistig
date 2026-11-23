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
  return context();
}

function context(): AudioContext | null {
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

/** Call from a click: lets the browser start the audio context for later sounds. */
export function unlockAudio() {
  context();
}

// ---------------------------------------------------------------- thinking music

const BPM = 112;
const BASE_EIGHTH = 60 / BPM / 2;
// Eight bars in A minor, one chord each (MIDI notes: root, third, fifth). The E
// major chords (with G#) pull back to Am, which keeps the tension up.
const CHORDS: [number, number, number][] = [
  [57, 60, 64], // Am
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [52, 56, 59], // E
  [50, 53, 57], // Dm
  [50, 53, 57], // Dm
  [52, 56, 59], // E
  [52, 56, 59], // E
];
// Which chord tone each eighth note plays: 0-2 = chord, 3 = root an octave up.
const ARP = [0, 2, 1, 2, 3, 2, 1, 2];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function note(a: AudioContext, out: AudioNode, freq: number, t0: number, dur: number, type: OscillatorType, gain: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export interface ThinkingMusic {
  /** 1 = normal speed; higher plays faster (the last seconds of the timer). */
  setTempo(factor: number): void;
  /** Fades out and stops. */
  stop(): void;
}

/**
 * Starts a quiet, tense, looping tune: a pulsing low bass on every eighth, a
 * minor arpeggio and a tick-tock clock. The tempo can change while it plays.
 */
export function startThinkingMusic(): ThinkingMusic {
  const a = context();
  if (!a) return { setTempo: () => undefined, stop: () => undefined };
  const master = a.createGain();
  master.gain.setValueAtTime(0.0001, a.currentTime);
  master.gain.exponentialRampToValueAtTime(1, a.currentTime + 1);
  master.connect(a.destination);

  let tempo = 1;
  let step = 0;
  let next = a.currentTime + 0.1;
  const schedule = () => {
    // Schedule everything due in the next 250 ms.
    while (next < a.currentTime + 0.25) {
      const eighth = BASE_EIGHTH / tempo;
      const bar = Math.floor(step / 8) % CHORDS.length;
      const beat = step % 8;
      const chord = CHORDS[bar]!;
      const tone = ARP[beat]!;
      const midi = tone === 3 ? chord[0] + 12 : chord[tone]!;
      // Pulsing bass: short low notes on every eighth, accent on the beat.
      note(a, master, hz(chord[0] - 24), next, eighth * 0.8, "triangle", beat % 2 === 0 ? 0.11 : 0.07);
      // Arpeggio, a little brighter as the tempo rises.
      note(a, master, hz(midi + 12), next, eighth * 1.2, "triangle", 0.03 + (tempo - 1) * 0.02);
      // Clock: tick on the beat, tock in between.
      if (beat % 2 === 0) note(a, master, beat % 4 === 0 ? 1600 : 1250, next, 0.035, "sine", 0.05);
      // A high held note on the last bar of every four, to build up.
      if (beat === 0 && bar % 4 === 3) note(a, master, hz(chord[1] + 24), next, eighth * 7, "sine", 0.015);
      next += eighth;
      step++;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 50);
  return {
    setTempo(factor) {
      tempo = Math.min(2, Math.max(0.5, factor));
    },
    stop() {
      clearInterval(timer);
      const now = a.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      window.setTimeout(() => master.disconnect(), 1500);
    },
  };
}
