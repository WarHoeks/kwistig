import { useCallback, useEffect, useState } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatIssues, primaryText, Quiz, type Item, type Language, type Quiz as QuizDoc } from "@kwistig/shared";
import { api, errorKey, RequestError } from "../../lib/api";
import { Field, LocalizedInput, OptionalNumber, setOpt } from "./fields";
import { IssueList } from "./IssueList";
import { ItemEditor } from "./ItemEditor";

type Selection = { type: "quiz" } | { type: "round"; r: number } | { type: "item"; r: number; i: number };
type Loaded = QuizDoc & { id: number; uid: string };

function stripIds({ id: _id, uid: _uid, ...doc }: Loaded): QuizDoc {
  return doc;
}

export function QuizEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [doc, setDoc] = useState<QuizDoc>();
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<Selection>({ type: "quiz" });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>();
  const [error, setError] = useState<{ message: string; issues: RequestError["issues"] }>();
  const [drag, setDrag] = useState<{ r: number; i: number }>();
  // Bumped when an item moves, so its editor remounts with fresh local state.
  const [selKey, setSelKey] = useState(0);

  useEffect(() => {
    api<Loaded>(`/quizzes/${id}`)
      .then((q) => setDoc(stripIds(q)))
      .catch((err) => setError({ message: t(errorKey(err)), issues: [] }));
  }, [id, t]);

  // Warn before leaving with unsaved changes.
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (confirm(t("common.confirmLeave"))) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker, t]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const update = useCallback((fn: (d: QuizDoc) => void) => {
    setDoc((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setSavedAt(undefined);
  }, []);

  const save = async () => {
    if (!doc) return;
    const res = Quiz.safeParse(doc);
    if (!res.success) {
      setError({ message: t("errors.invalid_quiz"), issues: formatIssues(res.error) });
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const q = await api<Loaded>(`/quizzes/${id}`, { method: "PUT", body: doc });
      setDoc(stripIds(q));
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      setError({ message: t(errorKey(err)), issues: err instanceof RequestError ? err.issues : [] });
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!doc) {
    return (
      <main className="mx-auto max-w-7xl p-4">
        {error ? <IssueList message={error.message} issues={[]} /> : <p className="text-ink-400">{t("common.loading")}</p>}
      </main>
    );
  }

  const lang = doc.language;

  const moveItem = (from: { r: number; i: number }, to: { r: number; i: number }) => {
    if (from.r === to.r && from.i === to.i) return;
    // Removing first shifts later indexes in the same round down by one.
    const target = from.r === to.r && from.i < to.i ? { r: to.r, i: to.i - 1 } : to;
    if (from.r === target.r && from.i === target.i) return;
    update((d) => {
      const [moved] = d.rounds[from.r]!.items.splice(from.i, 1);
      if (moved) d.rounds[target.r]!.items.splice(target.i, 0, moved);
    });
    setSel({ type: "item", ...target });
    setSelKey((k) => k + 1);
  };

  const moveRound = (r: number, delta: number) => {
    const to = r + delta;
    if (to < 0 || to >= doc.rounds.length) return;
    update((d) => {
      const [moved] = d.rounds.splice(r, 1);
      d.rounds.splice(to, 0, moved!);
    });
    setSel({ type: "round", r: to });
  };

  const addItem = (r: number, kind: "slide" | "question") => {
    const item: Item =
      kind === "slide"
        ? { kind: "slide", title: t("editor.untitled") }
        : { kind: "question", answerType: "multiple_choice", prompt: "", options: ["", "", "", ""], correct: 0 };
    const i = doc.rounds[r]!.items.length;
    update((d) => d.rounds[r]!.items.push(item));
    setSel({ type: "item", r, i });
    setSelKey((k) => k + 1);
  };

  const addRound = () => {
    const r = doc.rounds.length;
    update((d) =>
      d.rounds.push({ title: t("editor.newRoundTitle"), items: [{ kind: "slide", title: t("editor.newRoundTitle") }] }),
    );
    setSel({ type: "round", r });
  };

  const deleteRound = (r: number) => {
    const title = primaryText(doc.rounds[r]!.title, lang);
    if (!confirm(t("editor.confirmDeleteRound", { title }))) return;
    update((d) => d.rounds.splice(r, 1));
    setSel({ type: "quiz" });
  };

  const deleteItem = (r: number, i: number) => {
    update((d) => d.rounds[r]!.items.splice(i, 1));
    setSel({ type: "round", r });
  };

  const itemLabel = (item: Item) =>
    primaryText(item.kind === "slide" ? item.title : item.prompt, lang) || t("editor.untitled");

  const selectedRound = sel.type !== "quiz" ? doc.rounds[sel.r] : undefined;
  const selectedItem = sel.type === "item" ? selectedRound?.items[sel.i] : undefined;

  return (
    <main className="mx-auto max-w-7xl px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/admin" className="btn-ghost btn-sm">
          ← {t("common.back")}
        </Link>
        <h1 className="truncate text-xl font-bold">{primaryText(doc.title, lang) || t("editor.untitled")}</h1>
        <div className="ml-auto flex items-center gap-3">
          {dirty && <span className="text-sm text-gold-300">{t("common.unsavedChanges")}</span>}
          {savedAt && !dirty && <span className="text-sm text-emerald-300">{t("common.saved")}</span>}
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <IssueList message={error.message} issues={error.issues} onClose={() => setError(undefined)} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* Outline */}
        <nav aria-label={t("editor.rounds")} className="space-y-3">
          <button
            type="button"
            onClick={() => setSel({ type: "quiz" })}
            className={`card w-full p-3 text-left font-semibold ${sel.type === "quiz" ? "border-gold-400" : "hover:border-ink-600"}`}
          >
            {t("editor.quizTitle")} &amp; {t("editor.quizLanguage").toLowerCase()}
          </button>

          {doc.rounds.map((round, r) => (
            <section key={r} className="card overflow-hidden" aria-label={primaryText(round.title, lang)}>
              <div
                className={`flex items-center gap-1 border-b border-ink-700 px-3 py-2 ${
                  sel.type === "round" && sel.r === r ? "bg-ink-700" : ""
                }`}
              >
                <button type="button" className="min-w-0 flex-1 truncate text-left font-semibold" onClick={() => setSel({ type: "round", r })}>
                  <span className="mr-2 text-xs text-ink-400">{t("editor.round", { n: r + 1 })}</span>
                  {primaryText(round.title, lang) || t("editor.untitled")}
                </button>
                <button type="button" className="btn-ghost btn-sm" aria-label={t("common.moveUp")} disabled={r === 0} onClick={() => moveRound(r, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  aria-label={t("common.moveDown")}
                  disabled={r === doc.rounds.length - 1}
                  onClick={() => moveRound(r, 1)}
                >
                  ↓
                </button>
              </div>
              <ol
                className="min-h-8 py-1"
                onDragOver={(e) => drag && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) moveItem(drag, { r, i: round.items.length });
                  setDrag(undefined);
                }}
              >
                {round.items.map((item, i) => {
                  const active = sel.type === "item" && sel.r === r && sel.i === i;
                  return (
                    <li
                      key={i}
                      draggable
                      title={t("common.dragToReorder")}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDrag({ r, i });
                      }}
                      onDragEnd={() => setDrag(undefined)}
                      onDragOver={(e) => drag && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (drag) moveItem(drag, { r, i });
                        setDrag(undefined);
                      }}
                      className={`group flex items-center gap-2 px-3 py-1.5 ${active ? "bg-ink-700" : "hover:bg-ink-800"} ${
                        drag && drag.r === r && drag.i === i ? "opacity-40" : ""
                      }`}
                    >
                      <span className="cursor-grab select-none text-ink-600" aria-hidden>
                        ⠿
                      </span>
                      <button
                        type="button"
                        onClick={() => setSel({ type: "item", r, i })}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            item.kind === "slide" ? "bg-sky-500/20 text-sky-200" : "bg-gold-400/20 text-gold-300"
                          }`}
                        >
                          {item.kind === "slide" ? t("editor.kind.slide") : t(`editor.answerTypes.${item.answerType}`)}
                        </span>
                        <span className="truncate text-sm">{itemLabel(item)}</span>
                      </button>
                      <span className="hidden gap-0.5 group-hover:flex group-focus-within:flex">
                        <button
                          type="button"
                          className="px-1 text-ink-400 hover:text-white disabled:opacity-30"
                          aria-label={t("common.moveUp")}
                          disabled={i === 0}
                          onClick={() => moveItem({ r, i }, { r, i: i - 1 })}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="px-1 text-ink-400 hover:text-white disabled:opacity-30"
                          aria-label={t("common.moveDown")}
                          disabled={i === round.items.length - 1}
                          onClick={() => moveItem({ r, i }, { r, i: i + 2 })}
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div className="flex items-center gap-2 border-t border-ink-800 px-3 py-2 text-sm">
                <span className="text-ink-400">{t("editor.addItem")}</span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => addItem(r, "question")}>
                  + {t("editor.addQuestion")}
                </button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => addItem(r, "slide")}>
                  + {t("editor.addSlide")}
                </button>
              </div>
            </section>
          ))}

          <button type="button" className="btn-ghost w-full" onClick={addRound}>
            + {t("editor.addRound")}
          </button>
        </nav>

        {/* Detail panel */}
        <section className="card p-5" aria-live="polite">
          {sel.type === "quiz" && (
            <div className="space-y-4">
              <LocalizedInput label={t("editor.quizTitle")} value={doc.title} quizLang={lang} onChange={(v) => update((d) => (d.title = v ?? ""))} />
              <LocalizedInput
                label={t("editor.description")}
                value={doc.description}
                quizLang={lang}
                multiline
                onChange={(v) => update((d) => setOpt(d, "description", v))}
              />
              <Field label={t("editor.quizLanguage")} htmlFor="quiz-lang">
                <select
                  id="quiz-lang"
                  className="field max-w-xs"
                  value={lang}
                  onChange={(e) => update((d) => (d.language = e.target.value as Language))}
                >
                  <option value="nl">{t("common.languages.nl")}</option>
                  <option value="en">{t("common.languages.en")}</option>
                </select>
              </Field>
            </div>
          )}

          {sel.type === "round" && selectedRound && (
            <div className="space-y-4">
              <LocalizedInput
                label={t("editor.roundTitle")}
                value={selectedRound.title}
                quizLang={lang}
                onChange={(v) => update((d) => (d.rounds[sel.r]!.title = v ?? ""))}
              />
              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="label">{t("editor.defaults")}</legend>
                <OptionalNumber
                  label={t("editor.defaultPoints")}
                  value={selectedRound.defaults?.points}
                  min={0}
                  step="any"
                  placeholder="1"
                  onChange={(v) =>
                    update((d) => {
                      const round = d.rounds[sel.r]!;
                      const defaults = { ...round.defaults };
                      setOpt(defaults, "points", v);
                      setOpt(round, "defaults", Object.keys(defaults).length ? defaults : undefined);
                    })
                  }
                />
                <OptionalNumber
                  label={t("editor.defaultTimeLimit")}
                  value={selectedRound.defaults?.timeLimitSec}
                  min={5}
                  placeholder={t("editor.none")}
                  onChange={(v) =>
                    update((d) => {
                      const round = d.rounds[sel.r]!;
                      const defaults = { ...round.defaults };
                      setOpt(defaults, "timeLimitSec", v);
                      setOpt(round, "defaults", Object.keys(defaults).length ? defaults : undefined);
                    })
                  }
                />
              </fieldset>
              <button type="button" className="btn-danger" disabled={doc.rounds.length <= 1} onClick={() => deleteRound(sel.r)}>
                {t("editor.deleteRound")}
              </button>
            </div>
          )}

          {sel.type === "item" && selectedRound && selectedItem && (
            <div className="space-y-6">
              <ItemEditor
                key={`${sel.r}-${sel.i}-${selKey}`}
                item={selectedItem}
                round={selectedRound}
                quizLang={lang}
                onChange={(item) => update((d) => (d.rounds[sel.r]!.items[sel.i] = item))}
              />
              <button
                type="button"
                className="btn-danger"
                disabled={selectedRound.items.length <= 1}
                onClick={() => deleteItem(sel.r, sel.i)}
              >
                {t("editor.deleteItem")}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
