import { useTranslation } from "react-i18next";
import type { PublicMedia, Step, TimerState } from "@kwistig/shared";
import { useNow } from "../../lib/socket";
import { RevealImage } from "./RevealImage";

/** How far an image's reveal effect has progressed (0–1), from the server timer. */
export function useRevealProgress(step: Step | null, timer: TimerState | null, clockOffset: number): number {
  const now = useNow(step === "answering" && !!timer, 100);
  if (step === "locked" || step === "revealed") return 1;
  if (step !== "answering" || !timer || timer.durationMs <= 0) return 0;
  const elapsed = now + clockOffset - (timer.endsAt - timer.durationMs);
  return Math.min(1, Math.max(0, elapsed / timer.durationMs));
}

/**
 * The visual part of a question's media on the TV. YouTube and Spotify players
 * are mounted separately (they must keep playing across view changes); this
 * renders images, news and the audio-only covers.
 */
export function TvMediaPanel({
  media,
  progress,
  className = "",
  playerSlot,
}: {
  media: PublicMedia;
  progress: number;
  className?: string;
  /** Where the YouTube player is shown, for video media. */
  playerSlot?: React.ReactNode;
}) {
  const { t } = useTranslation();
  switch (media.type) {
    case "image":
      return <RevealImage src={media.src} effect={media.reveal} progress={progress} className={`rounded-[32px] ${className}`} />;
    case "news":
      return (
        <figure className={`flex flex-col overflow-hidden rounded-[32px] bg-white text-ink-950 ${className}`}>
          {media.image && <img src={media.image} alt="" className="min-h-0 flex-1 object-cover" />}
          <figcaption className="px-10 py-8 font-serif text-[52px] font-bold leading-tight" data-testid="tv-headline">
            {media.headline ?? t("tv.newsUnavailable")}
          </figcaption>
        </figure>
      );
    case "youtube":
      return <div className={`relative overflow-hidden rounded-[32px] bg-black ${className}`}>{playerSlot}</div>;
    case "spotify":
      return <AudioCover className={className} label={t("tv.listen")} />;
  }
}

/** Animated equaliser shown instead of video/track info for audio-only clips. */
export function AudioCover({ className = "", label }: { className?: string; label: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-10 rounded-[32px] bg-gradient-to-br from-ink-800 to-ink-950 ${className}`}>
      <div className="flex h-[260px] items-end gap-5" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className="w-[34px] rounded-full bg-gold-400"
            style={{ height: "100%", animation: `eq 1.1s ${(i * 137) % 600}ms ease-in-out infinite alternate`, transformOrigin: "bottom" }}
          />
        ))}
      </div>
      <p className="text-[48px] font-semibold text-ink-200">{label}</p>
    </div>
  );
}
