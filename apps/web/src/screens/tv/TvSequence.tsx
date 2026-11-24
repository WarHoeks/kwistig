import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PublicItem, SequenceState, TvView } from "@kwistig/shared";
import { useNow } from "../../lib/socket";
import { useQuizText } from "../../lib/text";

type Question = Extract<PublicItem, { kind: "question" }>;

/** Where a server-timed sequence is at `now` (server time). */
export function sequencePosition(seq: SequenceState, now: number) {
  const t = now - seq.startAt;
  if (t < 0) return { phase: "countdown" as const, countdown: Math.ceil(-t / 1000), index: -1, frac: 0 };
  const index = Math.floor(t / seq.ms);
  if (index >= seq.count) return { phase: "done" as const, countdown: 0, index: seq.count - 1, frac: 1 };
  return { phase: "running" as const, countdown: 0, index, frac: (t - index * seq.ms) / seq.ms };
}

export function SequenceView({ view, clockOffset }: { view: TvView; clockOffset: number }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const q = view.item as Question;
  const seq = view.sequence;
  const running = view.step === "answering" && !!seq;
  const now = useNow(running) + clockOffset;
  const images = q.sequence?.images ?? [];

  if (view.step === "revealed" && view.reveal?.images) return <SequenceReveal view={view} />;

  if (running) {
    const pos = sequencePosition(seq, now);
    if (pos.phase === "countdown") {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-10">
          <p className="max-w-[1500px] text-center font-display text-[72px] leading-tight">{text(q.prompt)}</p>
          <p key={pos.countdown} className="animate-[pop_500ms_ease-out] font-display text-[320px] leading-none text-gold-400">
            {pos.countdown}
          </p>
        </div>
      );
    }
    if (pos.phase === "running") {
      const caption = q.sequence?.captions?.[pos.index];
      return (
        <div className="flex h-full flex-col px-20 pb-12 pt-12" data-testid="tv-sequence" data-index={pos.index}>
          <div className="flex items-center justify-between gap-10">
            <p className="min-w-0 truncate font-display text-[52px] leading-tight">{text(q.prompt)}</p>
            <p className="shrink-0 rounded-full bg-white/10 px-8 py-2 font-display text-[64px] tabular-nums">
              {pos.index + 1} / {seq.count}
            </p>
          </div>
          <FramedImage key={pos.index} src={images[pos.index]!} />
          {caption && (
            <p className="mt-6 truncate text-center font-display text-[72px] leading-tight" data-testid="tv-sequence-caption">
              {text(caption)}
            </p>
          )}
          <div className="mt-8 h-4 shrink-0 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-gold-400" style={{ width: `${pos.frac * 100}%` }} />
          </div>
        </div>
      );
    }
  }

  // Before the start and after the last image.
  const done = view.step === "locked" || (running && sequencePosition(seq, now).phase === "done");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-12 px-32 text-center">
      <p className="text-[36px] font-semibold uppercase tracking-[0.2em] text-gold-300/80">
        {t("tv.flitsreeks")} · {t("tv.imagesCount", { count: images.length })}
      </p>
      <h1 className="font-display text-[100px] leading-[1.05]">{text(q.prompt)}</h1>
      <p className="rounded-full bg-gold-400 px-14 py-6 font-display text-[64px] text-ink-950">{text(q.sequence?.buttonLabel)}</p>
      <p className="text-[44px] text-ink-200">{done ? t("tv.sequenceDone") : t("tv.sequenceHint")}</p>
    </div>
  );
}

/**
 * The image as large as fits, scaled up too, with the rounded corners on the
 * image itself rather than on a letterboxed box around it.
 */
function FramedImage({ src }: { src: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  return (
    <div className="mt-8 flex min-h-0 flex-1 items-center justify-center [container-type:size]">
      <img
        src={src}
        alt=""
        onLoad={(e) => e.currentTarget.naturalHeight && setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        style={ratio ? { width: `min(100cqw, ${ratio * 100}cqh)`, aspectRatio: ratio } : undefined}
        className="max-h-full max-w-full rounded-[32px] object-cover shadow-2xl shadow-black/50"
      />
    </div>
  );
}

function SequenceReveal({ view }: { view: TvView }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const images = view.reveal!.images!;
  const teams = view.teams.length;

  const img = view.spotlight !== null ? images[view.spotlight] : undefined;
  if (img && view.spotlight !== null) {
    return (
      <div className="flex h-full gap-14 p-16">
        <img src={img.src} alt="" className="min-w-0 flex-1 rounded-[32px] object-contain" />
        <div className="flex w-[560px] shrink-0 flex-col justify-center gap-8">
          <p className="font-display text-[64px] text-ink-200">
            {view.spotlight + 1} / {images.length}
          </p>
          <YesNo yes={img.yes} big />
          {img.caption && <p className="text-[56px] font-bold leading-tight">{text(img.caption)}</p>}
          <p className="text-[40px] text-ink-200">{t("tv.pressedBy", { count: img.presses, total: teams })}</p>
        </div>
      </div>
    );
  }

  const cols = images.length <= 6 ? 3 : images.length <= 12 ? 4 : 5;
  return (
    <div className="flex h-full flex-col px-16 py-10">
      <h1 className="mb-8 truncate font-display text-[52px] leading-tight">{text((view.item as Question).prompt)}</h1>
      <ul className="grid min-h-0 flex-1 gap-6" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {images.map((img, i) => (
          <li key={i} className={`relative overflow-hidden rounded-3xl ring-[6px] ${img.yes ? "ring-emerald-400" : "ring-red-500/70"}`}>
            <img src={img.src} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/90 to-transparent p-4 pt-14">
              <div className="min-w-0">
                <YesNo yes={img.yes} />
                {img.caption && <p className="mt-1 truncate text-[28px] font-semibold">{text(img.caption)}</p>}
              </div>
              <span className="shrink-0 rounded-full bg-white/15 px-4 py-1 text-[28px] font-bold" title={t("tv.pressedBy", { count: img.presses, total: teams })}>
                👆 {img.presses}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function YesNo({ yes, big = false }: { yes: boolean; big?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block rounded-full font-bold ${big ? "px-8 py-3 text-[56px]" : "px-4 py-1 text-[28px]"} ${
        yes ? "bg-emerald-500 text-ink-950" : "bg-red-500 text-white"
      }`}
    >
      {yes ? t("tv.yes") : t("tv.no")}
    </span>
  );
}
