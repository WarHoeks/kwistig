import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TEAM_COLORS, type JoinInfo, type JoinResult } from "@kwistig/shared";
import { LanguageToggle } from "../../components/LanguageToggle";
import { api, RequestError } from "../../lib/api";
import { loadPlayer, savePlayer } from "../../lib/player";
import { useQuizText } from "../../lib/text";
import { setLanguage } from "../../i18n";

const EMOJIS = ["🦊", "🐙", "🦄", "🐝", "🦖", "🐧", "🦁", "🐸", "🍕", "🚀", "🎸", "🧠", "🌵", "🍄", "⚡", "🎩"];

export function JoinScreen() {
  const { t } = useTranslation();
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  /** Set once the player picks a tab, so loading the team list doesn't override it. */
  const modeChosen = useRef(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJIS[Math.floor(Math.random() * EMOJIS.length)]!);
  const [color, setColor] = useState<(typeof TEAM_COLORS)[number]>(TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)]!);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const text = useQuizText(info?.quizLang);

  useEffect(() => {
    // Already in this game on this phone: go straight back.
    if (loadPlayer()?.code === code.toUpperCase()) {
      navigate("/play", { replace: true });
      return;
    }
    api<JoinInfo>(`/join/${encodeURIComponent(code)}`)
      .then((i) => {
        setInfo(i);
        if (!localStorage.getItem("kwistig.lang")) setLanguage(i.quizLang, false);
        if (i.teams.length > 0 && !modeChosen.current) setMode("existing");
      })
      .catch(() => setError(t("join.invalidCode")));
  }, [code, navigate, t]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "new"
          ? { mode, code, name, emoji, color, ...(nickname ? { nickname } : {}) }
          : { mode, code, teamId, ...(nickname ? { nickname } : {}) };
      const res = await api<JoinResult>("/join", { method: "POST", body });
      savePlayer({ token: res.token, code: code.toUpperCase() });
      navigate("/play", { replace: true });
    } catch (err) {
      const c = err instanceof RequestError ? err.code : "internal_error";
      setError(t(`game.errors.${c}`, { defaultValue: t("errors.generic") }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 pb-8 pt-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-2xl text-gold-400">{t("app.name")}</span>
        <LanguageToggle />
      </div>

      {!info && !error && <p className="text-ink-400">{t("common.loading")}</p>}
      {error && !info && <p className="card p-5 text-lg">{error}</p>}

      {info && info.phase === "finished" && <p className="card p-5 text-lg">{t("join.finished")}</p>}

      {info && info.phase !== "finished" && (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div>
            <p className="text-sm uppercase tracking-widest text-ink-400">{t("join.title")}</p>
            <h1 className="text-2xl font-bold">{text(info.quizTitle)}</h1>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-ink-800 p-1" role="tablist">
            {(["new", "existing"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  modeChosen.current = true;
                }}
                className={`rounded-lg py-3 font-semibold ${mode === m ? "bg-gold-400 text-ink-950" : "text-ink-200"}`}
              >
                {m === "new" ? t("join.newTeam") : t("join.joinTeam")}
              </button>
            ))}
          </div>

          {mode === "new" ? (
            <>
              <div>
                <label htmlFor="team-name" className="label">
                  {t("join.teamName")}
                </label>
                <input
                  id="team-name"
                  className="field py-3 text-lg"
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <fieldset>
                <legend className="label">{t("join.emoji")}</legend>
                <div className="grid grid-cols-8 gap-1.5">
                  {EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      aria-pressed={emoji === e}
                      onClick={() => setEmoji(e)}
                      className={`aspect-square rounded-lg text-2xl ${emoji === e ? "bg-white/20 ring-2 ring-gold-400" : "bg-ink-800"}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="label">{t("join.color")}</legend>
                <div className="flex flex-wrap gap-2">
                  {TEAM_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                      className={`h-10 w-10 rounded-full ${color === c ? "ring-4 ring-white" : ""}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="label">{t("join.pickTeam")}</legend>
              {info.teams.length === 0 && <p className="text-ink-400">{t("join.noTeams")}</p>}
              {info.teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  aria-pressed={teamId === team.id}
                  onClick={() => setTeamId(team.id)}
                  className={`flex items-center gap-3 rounded-xl p-3 text-left ${
                    teamId === team.id ? "bg-white/15 ring-2 ring-gold-400" : "bg-ink-800"
                  }`}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg text-2xl" style={{ background: team.color }}>
                    {team.emoji}
                  </span>
                  <span className="flex-1 truncate text-lg font-semibold">{team.name}</span>
                  <span className="text-sm text-ink-400">{t("join.players", { count: team.players })}</span>
                </button>
              ))}
            </fieldset>
          )}

          <div>
            <label htmlFor="nickname" className="label">
              {t("join.nickname")}
            </label>
            <input
              id="nickname"
              className="field py-3"
              maxLength={24}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="given-name"
            />
            <p className="mt-1 text-xs text-ink-400">{t("join.nicknameHint")}</p>
          </div>

          {error && (
            <p role="alert" className="text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary py-4 text-lg"
            disabled={busy || (mode === "new" ? name.trim() === "" : teamId === null)}
          >
            {mode === "new" ? t("join.create") : t("join.join")}
          </button>
        </form>
      )}
    </main>
  );
}
