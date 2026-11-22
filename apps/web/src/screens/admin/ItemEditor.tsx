import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ANSWER_TYPES,
  formatIssues,
  Item as ItemSchema,
  type AnswerType,
  type Item,
  type Language,
  type Media,
  type Question,
  type Round,
  type Slide,
} from "@kwistig/shared";
import { Field, LocalizedInput, OptionalNumber, OptionalText, setOpt } from "./fields";
import { IssueList } from "./IssueList";
import { ImageField, MediaEditor, uploadImage } from "./MediaEditor";

type Props = {
  item: Item;
  round: Round;
  quizLang: Language;
  onChange: (item: Item) => void;
};

/** Answer types the form editor supports; the rest are edited as JSON for now. */
const FORM_TYPES: AnswerType[] = ["multiple_choice", "true_false", "open", "number", "buzzer", "rapid_sequence"];

type Rapid = Extract<Question, { answerType: "rapid_sequence" }>;

/**
 * "What happens next": the same video or track, from 5 s before the question
 * clip ends to 10 s after it, shown after the lock and before the answer.
 */
function continuationOf(m: Media): Media {
  if (m.type !== "youtube" && m.type !== "spotify") return m;
  const end = m.endSec ?? (m.startSec ?? 0) + 15;
  const base = { startSec: Math.max(0, end - 5), endSec: end + 10, play: "before" as const };
  return m.type === "youtube"
    ? { type: "youtube", videoId: m.videoId, ...base, ...(m.hideVideo ? { hideVideo: true } : {}) }
    : { type: "spotify", uri: m.uri, ...base };
}

/** Flitsreeks: button label, timing, scoring and 5–20 images marked yes/no. */
function RapidFields({ q, quizLang, edit }: { q: Rapid; quizLang: Language; edit: (fn: (d: Question) => void) => void }) {
  const { t } = useTranslation();
  const multi = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const editR = (fn: (d: Rapid) => void) => edit((d) => d.answerType === "rapid_sequence" && fn(d));
  const scoring = q.scoring ?? {};

  const addFiles = async (files: FileList) => {
    setBusy(true);
    try {
      const srcs: string[] = [];
      for (const f of Array.from(files).slice(0, 20 - q.images.length)) srcs.push(await uploadImage(f));
      editR((d) => d.images.push(...srcs.map((src) => ({ src, yes: false }))));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <LocalizedInput label={t("editor.buttonLabel")} value={q.buttonLabel} quizLang={quizLang} onChange={(v) => editR((d) => (d.buttonLabel = v ?? ""))} />
      <div className="grid gap-3 sm:grid-cols-3">
        <OptionalNumber label={t("editor.secondsPerImage")} value={q.secondsPerImage} min={1} step="any" placeholder="5" onChange={(v) => editR((d) => setOpt(d, "secondsPerImage", v))} />
        <OptionalNumber label={t("editor.pointsPerImage")} value={scoring.pointsPerImage} min={0} step="any" placeholder="1" onChange={(v) => editR((d) => setOpt((d.scoring ??= {}), "pointsPerImage", v))} />
        <OptionalNumber label={t("editor.wrongPressPenalty")} value={scoring.wrongPressPenalty} min={0} step="any" placeholder="0" onChange={(v) => editR((d) => setOpt((d.scoring ??= {}), "wrongPressPenalty", v))} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-amber-400" checked={scoring.speedBonus ?? false} onChange={(e) => editR((d) => setOpt((d.scoring ??= {}), "speedBonus", e.target.checked || undefined))} />
        {t("editor.speedBonus")}
      </label>

      <fieldset className="space-y-2">
        <legend className="label">{t("editor.sequenceImages", { count: q.images.length })}</legend>
        {q.images.map((img, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg bg-ink-800/50 p-2">
            <span className="mt-5 w-5 text-right text-sm text-ink-400">{i + 1}</span>
            <ImageField label="" compact value={img.src} onChange={(src) => editR((d) => (d.images[i]!.src = src))} />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="inline-flex rounded-lg bg-ink-900 p-0.5" role="group">
                {[true, false].map((yes) => (
                  <button
                    key={String(yes)}
                    type="button"
                    aria-pressed={img.yes === yes}
                    onClick={() => editR((d) => (d.images[i]!.yes = yes))}
                    className={`rounded-md px-3 py-1 text-sm font-semibold ${img.yes === yes ? (yes ? "bg-emerald-500 text-ink-950" : "bg-red-500 text-white") : "text-ink-200"}`}
                  >
                    {yes ? t("editor.imageYes") : t("editor.imageNo")}
                  </button>
                ))}
              </div>
              <LocalizedInput label="" value={img.caption} quizLang={quizLang} onChange={(v) => editR((d) => setOpt(d.images[i]!, "caption", v))} />
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" className="px-1 text-ink-400 disabled:opacity-30" disabled={i === 0} aria-label={t("common.moveUp")} onClick={() => editR((d) => d.images.splice(i - 1, 0, d.images.splice(i, 1)[0]!))}>↑</button>
              <button type="button" className="px-1 text-ink-400 disabled:opacity-30" disabled={i === q.images.length - 1} aria-label={t("common.moveDown")} onClick={() => editR((d) => d.images.splice(i + 1, 0, d.images.splice(i, 1)[0]!))}>↓</button>
              <button type="button" className="px-1 text-red-300" aria-label={t("common.delete")} onClick={() => editR((d) => d.images.splice(i, 1))}>✕</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-ghost btn-sm" disabled={busy || q.images.length >= 20} onClick={() => multi.current?.click()}>
          {busy ? t("common.saving") : t("editor.addImages")}
        </button>
        <input ref={multi} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
      </fieldset>
    </div>
  );
}

export function ItemEditor({ item, round, quizLang, onChange }: Props) {
  const { t } = useTranslation();
  const formSupported = item.kind === "slide" || FORM_TYPES.includes(item.answerType);
  // The parent keys this component by selection, so mode resets per item, not per edit.
  const [mode, setMode] = useState<"form" | "json">(formSupported ? "form" : "json");
  const effectiveMode = formSupported ? mode : "json";

  /** Clone, mutate, emit. */
  const edit = <T extends Item>(fn: (draft: T) => void) => {
    const draft = structuredClone(item) as T;
    fn(draft);
    onChange(draft);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">
          {item.kind === "slide" ? t("editor.kind.slide") : t(`editor.answerTypes.${item.answerType}`)}
        </h2>
        <div className="ml-auto inline-flex rounded-lg bg-ink-800 p-0.5">
          {(["form", "json"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={m === "form" && !formSupported}
              aria-pressed={effectiveMode === m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 text-sm font-semibold disabled:opacity-40 ${
                effectiveMode === m ? "bg-ink-600 text-white" : "text-ink-200"
              }`}
            >
              {m === "form" ? t("admin.edit") : t("editor.jsonEditor")}
            </button>
          ))}
        </div>
      </div>

      {!formSupported && <p className="text-sm text-ink-400">{t("editor.jsonOnly")}</p>}

      {effectiveMode === "json" ? (
        <JsonItemEditor item={item} onChange={onChange} />
      ) : item.kind === "slide" ? (
        <SlideForm slide={item} quizLang={quizLang} edit={edit<Slide>} />
      ) : (
        <QuestionForm question={item} round={round} quizLang={quizLang} edit={edit<Question>} onReplace={onChange} />
      )}
    </div>
  );
}

function SlideForm({
  slide,
  quizLang,
  edit,
}: {
  slide: Slide;
  quizLang: Language;
  edit: (fn: (d: Slide) => void) => void;
}) {
  const { t } = useTranslation();
  const colorId = useId();
  const showId = useId();
  const color = slide.background && "color" in slide.background ? slide.background.color : undefined;
  return (
    <div className="space-y-4">
      <LocalizedInput
        label={t("editor.slideTitle")}
        value={slide.title}
        quizLang={quizLang}
        onChange={(v) => edit((d) => (d.title = v ?? ""))}
      />
      <LocalizedInput
        label={t("editor.slideBody")}
        value={slide.body}
        quizLang={quizLang}
        multiline
        rows={5}
        onChange={(v) => edit((d) => setOpt(d, "body", v))}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("editor.slideShow")} htmlFor={showId}>
          <select
            id={showId}
            className="field"
            value={slide.show ?? "content"}
            onChange={(e) =>
              edit((d) => setOpt(d, "show", e.target.value === "scoreboard" ? "scoreboard" : undefined))
            }
          >
            <option value="content">{t("editor.slideShowContent")}</option>
            <option value="scoreboard">{t("editor.slideShowScoreboard")}</option>
          </select>
        </Field>
        <Field label={t("editor.background")} htmlFor={colorId}>
          <div className="flex gap-2">
            <input
              id={colorId}
              type="color"
              className="h-10 w-14 cursor-pointer rounded border border-ink-600 bg-ink-900"
              value={color ?? "#14122b"}
              onChange={(e) => edit((d) => (d.background = { color: e.target.value }))}
            />
            {slide.background && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => edit((d) => setOpt(d, "background", undefined))}>
                ×
              </button>
            )}
          </div>
        </Field>
        <OptionalNumber
          label={t("editor.countdown")}
          value={slide.countdownSec}
          min={1}
          onChange={(v) => edit((d) => setOpt(d, "countdownSec", v))}
        />
      </div>
      <ImageField
        label={t("editor.backgroundImage")}
        value={slide.background && "image" in slide.background ? slide.background.image : undefined}
        onChange={(src) => edit((d) => (d.background = { image: src }))}
      />
      <MediaEditor label={t("editor.media")} value={slide.media} allowPlayBefore={false} onChange={(m) => edit((d) => setOpt(d, "media", m))} />
    </div>
  );
}

/** Switches a question to another answer type, keeping everything they share. */
function convertQuestion(q: Question, to: AnswerType): Question {
  const { kind, prompt, hostNotes, explanation } = q;
  const common = {
    kind,
    prompt,
    ...(hostNotes !== undefined ? { hostNotes } : {}),
    ...(explanation !== undefined ? { explanation } : {}),
  };
  const extras =
    q.answerType !== "rapid_sequence"
      ? {
          ...(q.points !== undefined ? { points: q.points } : {}),
          ...(q.timeLimitSec !== undefined ? { timeLimitSec: q.timeLimitSec } : {}),
          ...(q.media !== undefined ? { media: q.media } : {}),
          ...(q.revealMedia !== undefined ? { revealMedia: q.revealMedia } : {}),
        }
      : {};
  switch (to) {
    case "multiple_choice":
      return { ...common, ...extras, answerType: to, options: ["A", "B", "C", "D"], correct: 0 };
    case "true_false":
      return { ...common, ...extras, answerType: to, correct: true };
    case "open":
      return { ...common, ...extras, answerType: to, acceptedAnswers: [""] };
    case "number":
      return { ...common, ...extras, answerType: to, correct: 0 };
    case "buzzer":
      return { ...common, ...extras, answerType: to, answer: "" };
    case "rapid_sequence":
      return {
        ...common,
        answerType: to,
        buttonLabel: "JA!",
        images: Array.from({ length: 5 }, (_, i) => ({ src: `media/afbeelding${i + 1}.jpg`, yes: i % 2 === 0 })),
      };
  }
}

function QuestionForm({
  question: q,
  round,
  quizLang,
  edit,
  onReplace,
}: {
  question: Question;
  round: Round;
  quizLang: Language;
  edit: (fn: (d: Question) => void) => void;
  onReplace: (item: Item) => void;
}) {
  const { t } = useTranslation();
  const typeId = useId();
  const roundPoints = round.defaults?.points ?? 1;
  const roundTime = round.defaults?.timeLimitSec;

  return (
    <div className="space-y-4">
      <Field label={t("editor.answerType")} htmlFor={typeId}>
        <select
          id={typeId}
          className="field"
          value={q.answerType}
          onChange={(e) => onReplace(convertQuestion(q, e.target.value as AnswerType))}
        >
          {ANSWER_TYPES.map((a) => (
            <option key={a} value={a}>
              {t(`editor.answerTypes.${a}`)}
            </option>
          ))}
        </select>
      </Field>

      <LocalizedInput
        label={t("editor.prompt")}
        value={q.prompt}
        quizLang={quizLang}
        multiline
        rows={2}
        onChange={(v) => edit((d) => (d.prompt = v ?? ""))}
      />

      {q.answerType !== "rapid_sequence" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionalNumber
            label={t("editor.points")}
            value={q.points}
            min={0}
            step="any"
            placeholder={t("editor.inherit", { value: roundPoints })}
            onChange={(v) => edit((d) => d.answerType !== "rapid_sequence" && setOpt(d, "points", v))}
          />
          <OptionalNumber
            label={t("editor.timeLimit")}
            value={q.timeLimitSec}
            min={5}
            placeholder={t("editor.inherit", { value: roundTime ?? t("editor.none") })}
            onChange={(v) => edit((d) => d.answerType !== "rapid_sequence" && setOpt(d, "timeLimitSec", v))}
          />
        </div>
      )}

      <AnswerFields q={q} quizLang={quizLang} edit={edit} />

      {q.answerType !== "rapid_sequence" && (
        <>
          <MediaEditor
            label={t("editor.media")}
            value={q.media}
            onChange={(m) => edit((d) => d.answerType !== "rapid_sequence" && setOpt(d, "media", m))}
          />
          {(q.media?.type === "youtube" || q.media?.type === "spotify") && !q.revealMedia && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => edit((d) => d.answerType !== "rapid_sequence" && d.media && setOpt(d, "revealMedia", continuationOf(d.media)))}
            >
              + {t("editor.addContinuation")}
            </button>
          )}
          <MediaEditor
            label={t("editor.revealMedia")}
            value={q.revealMedia}
            slot="reveal"
            onChange={(m) => edit((d) => d.answerType !== "rapid_sequence" && setOpt(d, "revealMedia", m))}
          />
        </>
      )}

      <LocalizedInput
        label={t("editor.explanation")}
        value={q.explanation}
        quizLang={quizLang}
        multiline
        rows={2}
        onChange={(v) => edit((d) => setOpt(d, "explanation", v))}
      />
      <OptionalText
        label={t("editor.hostNotes")}
        value={q.hostNotes}
        multiline
        onChange={(v) => edit((d) => setOpt(d, "hostNotes", v))}
      />
    </div>
  );
}

function AnswerFields({
  q,
  quizLang,
  edit,
}: {
  q: Question;
  quizLang: Language;
  edit: (fn: (d: Question) => void) => void;
}) {
  const { t } = useTranslation();
  const groupName = useId();
  const answersId = useId();
  const modeId = useId();

  switch (q.answerType) {
    case "multiple_choice":
      return (
        <fieldset className="space-y-2">
          <legend className="label">{t("editor.options")}</legend>
          {q.options.map((opt, i) => (
            <div key={i} className="flex items-start gap-2">
              <label className="mt-2 flex items-center gap-1.5 text-sm font-bold text-ink-200" title={t("editor.correctOption")}>
                <input
                  type="radio"
                  name={groupName}
                  className="accent-amber-400"
                  checked={q.correct === i}
                  onChange={() => edit((d) => d.answerType === "multiple_choice" && (d.correct = i))}
                />
                {String.fromCharCode(65 + i)}
              </label>
              <div className="flex-1">
                <LocalizedInput
                  label=""
                  value={opt}
                  quizLang={quizLang}
                  onChange={(v) => edit((d) => d.answerType === "multiple_choice" && (d.options[i] = v ?? ""))}
                />
              </div>
              <button
                type="button"
                className="btn-danger btn-sm mt-1"
                disabled={q.options.length <= 2}
                aria-label={t("common.delete")}
                onClick={() =>
                  edit((d) => {
                    if (d.answerType !== "multiple_choice") return;
                    d.options.splice(i, 1);
                    if (d.correct >= i && d.correct > 0) d.correct -= 1;
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={q.options.length >= 6}
            onClick={() => edit((d) => d.answerType === "multiple_choice" && d.options.push(""))}
          >
            {t("editor.addOption")}
          </button>
        </fieldset>
      );

    case "true_false":
      return (
        <fieldset className="flex gap-6">
          <legend className="label">{t("editor.correctOption")}</legend>
          {[true, false].map((v) => (
            <label key={String(v)} className="flex items-center gap-2">
              <input
                type="radio"
                name={groupName}
                className="accent-amber-400"
                checked={q.correct === v}
                onChange={() => edit((d) => d.answerType === "true_false" && (d.correct = v))}
              />
              {v ? t("editor.trueLabel") : t("editor.falseLabel")}
            </label>
          ))}
        </fieldset>
      );

    case "open":
      return (
        <Field label={t("editor.acceptedAnswers")} htmlFor={answersId}>
          <textarea
            id={answersId}
            className="field font-mono"
            rows={Math.max(3, q.acceptedAnswers.length + 1)}
            value={q.acceptedAnswers.join("\n")}
            onChange={(e) =>
              edit((d) => {
                if (d.answerType !== "open") return;
                const lines = e.target.value.split("\n");
                // Keep a trailing empty line while typing, drop other blanks.
                d.acceptedAnswers = lines.filter((l, i) => l.trim() !== "" || i === lines.length - 1);
              })
            }
            onBlur={() =>
              edit((d) => d.answerType === "open" && (d.acceptedAnswers = d.acceptedAnswers.filter((l) => l.trim() !== "")))
            }
          />
        </Field>
      );

    case "number": {
      const mode = q.scoring?.mode ?? "closest";
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionalNumber
            label={t("editor.correctNumber")}
            value={q.correct}
            step="any"
            onChange={(v) => edit((d) => d.answerType === "number" && (d.correct = v ?? 0))}
          />
          <LocalizedInput
            label={t("editor.unit")}
            value={q.unit}
            quizLang={quizLang}
            onChange={(v) => edit((d) => d.answerType === "number" && setOpt(d, "unit", v))}
          />
          <Field label={t("editor.numberScoring")} htmlFor={modeId}>
            <select
              id={modeId}
              className="field"
              value={mode}
              onChange={(e) =>
                edit((d) => {
                  if (d.answerType !== "number") return;
                  d.scoring = e.target.value === "tolerance" ? { mode: "tolerance", tolerance: 0 } : { mode: "closest" };
                })
              }
            >
              <option value="closest">{t("editor.scoringClosest")}</option>
              <option value="tolerance">{t("editor.scoringTolerance")}</option>
            </select>
          </Field>
          {q.scoring?.mode === "tolerance" && (
            <OptionalNumber
              label={t("editor.tolerance")}
              value={q.scoring.tolerance}
              min={0}
              step="any"
              onChange={(v) =>
                edit((d) => d.answerType === "number" && (d.scoring = { mode: "tolerance", tolerance: v ?? 0 }))
              }
            />
          )}
        </div>
      );
    }

    case "buzzer":
      return (
        <LocalizedInput
          label={t("editor.correctOption")}
          value={q.answer}
          quizLang={quizLang}
          onChange={(v) => edit((d) => d.answerType === "buzzer" && (d.answer = v ?? ""))}
        />
      );

    case "rapid_sequence":
      return <RapidFields q={q} quizLang={quizLang} edit={edit} />;
  }
}

/** Raw JSON editing for any item, validated against the Item schema before it is applied. */
function JsonItemEditor({ item, onChange }: { item: Item; onChange: (item: Item) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(item, null, 2));
  const [issues, setIssues] = useState<{ path: string; message: string }[]>();
  const [syntaxError, setSyntaxError] = useState(false);
  const lastEmitted = useRef<Item>(item);

  // Reformat only when the item changed from outside (e.g. undo), not after our own edit.
  useEffect(() => {
    if (item !== lastEmitted.current) {
      lastEmitted.current = item;
      setText(JSON.stringify(item, null, 2));
    }
  }, [item]);

  const apply = (value: string) => {
    setText(value);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setSyntaxError(true);
      return;
    }
    setSyntaxError(false);
    const res = ItemSchema.safeParse(parsed);
    if (!res.success) {
      setIssues(formatIssues(res.error));
      return;
    }
    setIssues(undefined);
    lastEmitted.current = parsed as Item;
    onChange(parsed as Item);
  };

  return (
    <div className="space-y-2">
      <textarea
        aria-label={t("editor.jsonEditor")}
        className="field min-h-96 font-mono text-sm"
        spellCheck={false}
        value={text}
        onChange={(e) => apply(e.target.value)}
      />
      {syntaxError && <p className="text-sm text-red-300">{t("editor.jsonInvalid")}</p>}
      {issues && <IssueList message={t("errors.invalid_quiz")} issues={issues} />}
    </div>
  );
}
