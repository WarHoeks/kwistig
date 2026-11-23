import { useEffect, useRef, useState } from "react";
import type { PublicTeam, TeamStanding } from "@kwistig/shared";
import { TeamAvatar } from "./TeamAvatar";
import { calm, confettiFrom, firstTime } from "../lib/effects";

/** Hand-drawn crack paths (viewBox 0 0 100 100); each level adds the next set. */
const CRACKS = [
  ["M8 0 L22 18 L16 30 L30 44 L26 58", "M22 18 L34 14 L44 22"],
  ["M100 30 L82 38 L86 52 L70 60 L74 74 L60 86", "M82 38 L92 50"],
  ["M40 100 L46 84 L36 72 L50 62 L58 48", "M46 84 L60 90 L70 100", "M36 72 L20 76"],
];

/**
 * A team's photo (or emoji) with its standings: gold frame for the leader, cracks
 * for last place (deepening 1–3), a crown for the round winner. Effects play once
 * per change: confetti for a new leader, poof when dethroned, shake + crack when
 * entering last place, sparkles and healing cracks for a comeback.
 */
export function TeamPhoto({
  team,
  standing,
  seq,
  size,
  rounded = "rounded-2xl",
  animate = true,
  showCrown = false,
}: {
  team: Pick<PublicTeam, "id" | "name" | "emoji" | "color" | "photoUrl">;
  standing: TeamStanding | undefined;
  seq: number;
  size: number;
  rounded?: string;
  animate?: boolean;
  /** Round-end scoreboard: crown for the round winner. */
  showCrown?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fx, setFx] = useState<string | null>(null);
  const [healing, setHealing] = useState<number>(0);
  const leader = !!standing?.leader;
  const crack = standing?.crack ?? 0;
  const event = standing?.event ?? null;

  useEffect(() => {
    if (!animate || !event || !firstTime(`${seq}:${team.id}:${event}`)) return;
    if (event === "gainedLead") confettiFrom(ref.current);
    if (event === "comeback") setHealing(3);
    if (!calm()) {
      setFx(event);
      const t = setTimeout(() => setFx(null), 1600);
      return () => clearTimeout(t);
    }
  }, [animate, event, seq, team.id]);

  useEffect(() => {
    if (!healing) return;
    const t = setTimeout(() => setHealing(0), 1200);
    return () => clearTimeout(t);
  }, [healing]);

  const drawn = healing || crack;
  return (
    <div
      ref={ref}
      className={`relative shrink-0 ${fx === "enteredLast" ? "animate-[shake_500ms_ease-in-out]" : ""}`}
      style={{ width: size, height: size }}
      data-testid={`team-photo-${team.id}`}
      data-leader={leader}
      data-crack={crack}
    >
      <TeamAvatar team={team} size={size} rounded={rounded} />
      {/* Gold frame for the leader; it "poofs" away when the lead is lost. */}
      {(leader || fx === "dethroned") && (
        <div
          className={`pointer-events-none absolute -inset-[6%] ${rounded} border-[length:calc(var(--s)*0.06)] border-gold-400 shadow-[0_0_calc(var(--s)*0.2)_rgba(251,191,36,0.7)] ${
            fx === "dethroned" ? "animate-[poof_900ms_ease-out_forwards]" : ""
          }`}
          style={{ ["--s" as string]: `${size}px` }}
        />
      )}
      {showCrown && standing?.roundWinner && (
        <span className="pointer-events-none absolute -top-[38%] left-1/2 -translate-x-1/2" style={{ fontSize: size * 0.45 }} aria-hidden>
          👑
        </span>
      )}
      {/* Cracks: drawn in when they appear, drawn back out when healing. */}
      {drawn > 0 && (
        <svg viewBox="0 0 100 100" className={`pointer-events-none absolute inset-0 ${rounded} overflow-hidden`} aria-hidden>
          {CRACKS.slice(0, drawn).map((paths, level) =>
            paths.map((d, i) => (
              <path
                key={`${level}-${i}`}
                d={d}
                fill="none"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                strokeDasharray={100}
                className={
                  calm()
                    ? ""
                    : healing
                      ? "animate-[crack-heal_1100ms_ease-in_forwards]"
                      : fx === "enteredLast" || (fx === null && level === crack - 1)
                        ? "animate-[crack-draw_700ms_ease-out_both]"
                        : ""
                }
                style={{ filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))" }}
              />
            )),
          )}
        </svg>
      )}
      {/* Sparkles for a comeback. */}
      {fx === "comeback" && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className="absolute animate-[sparkle_1200ms_ease-out_forwards] text-gold-300"
              style={{
                left: `${10 + ((i * 37) % 80)}%`,
                top: `${10 + ((i * 53) % 80)}%`,
                fontSize: size * 0.18,
                animationDelay: `${(i % 5) * 90}ms`,
              }}
            >
              ✦
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
