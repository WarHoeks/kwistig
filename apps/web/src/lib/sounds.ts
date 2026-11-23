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

const BPM = 104;
const EIGHTH = 60 / BPM / 2;
// Eight bars, one chord each (MIDI note numbers of the chord's root, third, fifth).
const CHORDS: [number, number, number][] = [
  [60, 64, 67], // C
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 59, 62], // G
  [60, 64, 67], // C
  [57, 60, 64], // Am
  [50, 53, 57], // Dm
  [55, 59, 62], // G
];
// Which chord tone each eighth note plays: 0-2 = chord, 3 = root an octave up.
const ARP = [0, 1, 2, 3, 2, 1, 2, 1];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function note(a: AudioContext, out: AudioNode, freq: number, t0: number, dur: number, type: OscillatorType, gain: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/**
 * Starts a quiet, looping "thinking" tune (C-Am-F-G with a plucked arpeggio, a
 * walking bass and a soft clock tick). Returns a function that fades it out.
 */
export function startThinkingMusic(): () => void {
  const a = context();
  if (!a) return () => undefined;
  const master = a.createGain();
  master.gain.setValueAtTime(0.0001, a.currentTime);
  master.gain.exponentialRampToValueAtTime(1, a.currentTime + 1.2);
  master.connect(a.destination);

  let step = 0;
  let next = a.currentTime + 0.1;
  const schedule = () => {
    // Schedule everything due in the next 300 ms.
    while (next < a.currentTime + 0.3) {
      const bar = Math.floor(step / 8) % CHORDS.length;
      const beat = step % 8;
      const chord = CHORDS[bar]!;
      const tone = ARP[beat]!;
      const midi = tone === 3 ? chord[0] + 12 : chord[tone]!;
      note(a, master, hz(midi + 12), next, EIGHTH * 1.6, "triangle", 0.035);
      if (beat === 0 || beat === 4) note(a, master, hz(chord[0] - 24), next, EIGHTH * 3.5, "sine", 0.09);
      if (beat === 2 || beat === 6) note(a, master, hz(chord[2] - 24), next, EIGHTH * 1.5, "sine", 0.06);
      if (beat % 2 === 1) note(a, master, 2800, next, 0.03, "square", 0.006);
      next += EIGHTH;
      step++;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 100);
  return () => {
    clearInterval(timer);
    const now = a.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    window.setTimeout(() => master.disconnect(), 1500);
  };
}
