import type { TimerState } from "@kwistig/shared";
import { useNow } from "../lib/socket";

/** Remaining ms of a server timer, using the server clock offset. */
export function useRemaining(timer: TimerState | null, clockOffset: number): number | null {
  const now = useNow(!!timer);
  if (!timer) return null;
  return Math.max(0, timer.endsAt - (now + clockOffset));
}

export function CountdownBar({
  timer,
  clockOffset,
  className = "",
}: {
  timer: TimerState | null;
  clockOffset: number;
  className?: string;
}) {
  const remaining = useRemaining(timer, clockOffset);
  if (!timer || remaining === null) return null;
  const frac = timer.durationMs > 0 ? remaining / timer.durationMs : 0;
  const urgent = remaining < 5000;
  return (
    <div
      className={`overflow-hidden rounded-full bg-white/10 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.round(timer.durationMs / 1000)}
      aria-valuenow={Math.ceil(remaining / 1000)}
    >
      <div
        className={`h-full rounded-full ${urgent ? "bg-red-500" : "bg-gold-400"}`}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}

export function CountdownNumber({ timer, clockOffset, className = "" }: { timer: TimerState | null; clockOffset: number; className?: string }) {
  const remaining = useRemaining(timer, clockOffset);
  if (remaining === null) return null;
  return (
    <span className={`tabular-nums ${remaining < 5000 ? "text-red-400" : ""} ${className}`}>{Math.ceil(remaining / 1000)}</span>
  );
}
