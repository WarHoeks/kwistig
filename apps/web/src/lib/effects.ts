import confetti from "canvas-confetti";

/**
 * Standings effects. Calm mode (admin setting) or the OS "reduce motion" setting
 * turns off confetti, particles and shaking; frames and cracks stay, static.
 */

let calmSetting = false;
export function setCalmMode(on: boolean) {
  calmSetting = on;
}
export function calm(): boolean {
  return calmSetting || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Each standings change plays its effect once, even if the screen re-renders or remounts. */
const played = new Set<string>();
export function firstTime(key: string): boolean {
  if (played.has(key)) return false;
  played.add(key);
  return true;
}

/** Confetti from an element's position on screen. */
export function confettiFrom(el: Element | null, opts: { shower?: boolean } = {}) {
  if (!el || calm()) return;
  const r = el.getBoundingClientRect();
  const origin = { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
  if (opts.shower) {
    void confetti({ particleCount: 160, spread: 120, startVelocity: 35, origin: { x: origin.x, y: Math.max(0, origin.y - 0.2) }, colors: ["#fbbf24", "#fcd34d", "#ffffff", "#f97316"] });
  } else {
    void confetti({ particleCount: 70, spread: 70, startVelocity: 28, scalar: 0.9, origin, colors: ["#fbbf24", "#fcd34d", "#ffffff"] });
  }
}

/** Big celebration for the winner. */
export function winnerConfetti() {
  if (calm()) return;
  const end = Date.now() + 2500;
  const frame = () => {
    void confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.7 } });
    void confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.7 } });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}
