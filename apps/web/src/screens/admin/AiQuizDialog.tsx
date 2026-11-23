import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AI_ANSWER_TYPES,
  buildAiFixPrompt,
  buildAiPrompt,
  DEFAULT_AI_PROMPT_OPTIONS,
  extractJson,
  formatIssues,
  Quiz,
  type AiPromptOptions,
} from "@kwistig/shared";
import { api, RequestError } from "../../lib/api";
import { IssueList } from "./IssueList";

/** Copies text; falls back to a selected textarea where the Clipboard API is missing (plain http on a LAN IP). */
async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    fallback.focus();
    fallback.select();
    return document.execCommand("copy");
  }
}

type Issues = { path: string; message: string }[];

/**
 * "Quiz met AI": builds a prompt for a chatbot, then imports the JSON it replies
 * with. Validation happens here first, so a fix-up prompt can be offered.
 */
export function AiQuizButton() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<AiPromptOptions>({ ...DEFAULT_AI_PROMPT_OPTIONS, topic: "", language: i18n.language === "en" ? "en" : "nl" });
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState<"prompt" | "fix" | null>(null);
  const [problem, setProblem] = useState<{ message: string; issues: Issues; fix: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  const fixBox = useRef<HTMLTextAreaElement>(null);

  const prompt = useMemo(() => buildAiPrompt(opts), [opts]);
  const set = (patch: Partial<AiPromptOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const copy = async (which: "prompt" | "fix", text: string, box: HTMLTextAreaElement | null) => {
    if (await copyText(text, box)) {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    }
  };

  const importReply = async () => {
    setProblem(null);
    let doc: unknown;
    try {
      doc = extractJson(reply);
    } catch {
      setProblem({ message: t("ai.notJson"), issues: [], fix: buildAiFixPrompt([], true) });
      return;
    }
    const res = Quiz.safeParse(doc);
    if (!res.success) {
      const issues = formatIssues(res.error);
      setProblem({ message: t("errors.invalid_quiz"), issues, fix: buildAiFixPrompt(issues) });
      return;
    }
    setBusy(true);
    try {
      const q = await api<{ id: number }>("/quizzes/import", { method: "POST", body: res.data });
      navigate(`/admin/quiz/${q.id}`);
    } catch (err) {
      const issues = err instanceof RequestError ? err.issues : [];
      setProblem({ message: t("errors.generic"), issues, fix: buildAiFixPrompt(issues) });
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || min)));

  return (
    <>
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)} data-testid="ai-open">
        ✨ {t("ai.button")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={t("ai.title")}>
          <div className="card my-8 w-full max-w-3xl space-y-5 p-6">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h2 className="text-xl font-bold">{t("ai.title")}</h2>
                <p className="mt-1 text-sm text-ink-300">{t("ai.intro")}</p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
                {t("common.close")}
              </button>
            </div>

            {/* Step 1: settings and prompt */}
            <section className="space-y-3">
              <h3 className="font-semibold text-gold-300">1. {t("ai.step1")}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="label">{t("ai.topic")}</span>
                  <input className="field" value={opts.topic} placeholder={t("ai.topicPlaceholder")} onChange={(e) => set({ topic: e.target.value })} data-testid="ai-topic" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label">{t("ai.audience")}</span>
                  <input className="field" value={opts.audience ?? ""} placeholder={t("ai.audiencePlaceholder")} onChange={(e) => set({ audience: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">{t("editor.quizLanguage")}</span>
                  <select className="field" value={opts.language} onChange={(e) => set({ language: e.target.value as AiPromptOptions["language"] })}>
                    <option value="nl">{t("common.languages.nl")}</option>
                    <option value="en">{t("common.languages.en")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label">{t("trivia.difficulty")}</span>
                  <select className="field" value={opts.difficulty} onChange={(e) => set({ difficulty: e.target.value as AiPromptOptions["difficulty"] })}>
                    <option value="mixed">{t("trivia.anyDifficulty")}</option>
                    {(["easy", "medium", "hard"] as const).map((d) => (
                      <option key={d} value={d}>
                        {t(`trivia.difficulties.${d}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">{t("ai.rounds")}</span>
                  <input type="number" className="field" min={1} max={8} value={opts.rounds} onChange={(e) => set({ rounds: num(e.target.value, 1, 8) })} />
                </label>
                <label className="block">
                  <span className="label">{t("ai.perRound")}</span>
                  <input type="number" className="field" min={1} max={20} value={opts.questionsPerRound} onChange={(e) => set({ questionsPerRound: num(e.target.value, 1, 20) })} />
                </label>
              </div>
              <fieldset>
                <legend className="label">{t("ai.types")}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {AI_ANSWER_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-amber-400"
                        checked={opts.types.includes(type)}
                        onChange={(e) => set({ types: e.target.checked ? [...opts.types, type] : opts.types.filter((x) => x !== type) })}
                      />
                      {t(`editor.answerTypes.${type}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-amber-400" checked={opts.bilingual} onChange={(e) => set({ bilingual: e.target.checked })} />
                {t("ai.bilingual")}
              </label>
              <textarea ref={promptBox} readOnly className="field h-40 font-mono text-xs" value={prompt} data-testid="ai-prompt" />
              <button type="button" className="btn-primary" onClick={() => void copy("prompt", prompt, promptBox.current)} disabled={opts.types.length === 0}>
                {copied === "prompt" ? `✓ ${t("ai.copied")}` : t("ai.copyPrompt")}
              </button>
            </section>

            {/* Step 2: paste the reply */}
            <section className="space-y-3">
              <h3 className="font-semibold text-gold-300">2. {t("ai.step2")}</h3>
              <textarea
                className="field h-40 font-mono text-xs"
                value={reply}
                placeholder={t("ai.replyPlaceholder")}
                onChange={(e) => setReply(e.target.value)}
                data-testid="ai-reply"
              />
              {problem && (
                <div className="space-y-2">
                  <IssueList message={problem.message} issues={problem.issues} />
                  <p className="text-sm text-ink-300">{t("ai.fixHint")}</p>
                  <textarea ref={fixBox} readOnly className="sr-only" value={problem.fix} tabIndex={-1} aria-hidden />
                  <button type="button" className="btn-ghost" onClick={() => void copy("fix", problem.fix, fixBox.current)}>
                    {copied === "fix" ? `✓ ${t("ai.copied")}` : t("ai.copyFix")}
                  </button>
                </div>
              )}
              <button type="button" className="btn-primary" disabled={!reply.trim() || busy} onClick={() => void importReply()} data-testid="ai-import">
                {busy ? t("common.loading") : t("ai.import")}
              </button>
              <p className="text-xs text-ink-500">{t("ai.checkFacts")}</p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
