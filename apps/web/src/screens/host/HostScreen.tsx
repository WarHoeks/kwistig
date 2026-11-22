import { createContext, useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { isIdle, type HostIntent, type HostView, type ServerView } from "@kwistig/shared";
import { PinGate } from "../../components/PinGate";
import { LanguageToggle } from "../../components/LanguageToggle";
import { useGameSocket } from "../../lib/socket";
import { HostGame } from "./HostGame";
import { HostTeams } from "./HostTeams";
import { HostMessages } from "./HostMessages";
import { QuizPicker } from "./QuizPicker";

type Send = (intent: HostIntent) => Promise<boolean>;
const HostCtx = createContext<{ send: Send; view: HostView | null; clockOffset: number }>({
  send: async () => false,
  view: null,
  clockOffset: 0,
});
export const useHost = () => useContext(HostCtx);

type Tab = "game" | "teams" | "messages" | "quizzes";

export function HostScreen() {
  return <PinGate>{() => <HostLive />}</PinGate>;
}

function HostLive() {
  const { t } = useTranslation();
  const game = useGameSocket<ServerView<HostView>>({ role: "host" });
  const view = game.view && !isIdle(game.view) ? game.view : null;
  const [tab, setTab] = useState<Tab>("game");
  const [toast, setToast] = useState<string | null>(null);

  const send: Send = useCallback(
    async (intent) => {
      const ack = await game.send(intent);
      if (!ack.ok) {
        setToast(t(`game.errors.${ack.error}`, { defaultValue: t("errors.generic") }));
        setTimeout(() => setToast(null), 4000);
      }
      return ack.ok;
    },
    [game, t],
  );

  const activeTab: Tab = view ? tab : "quizzes";
  const teamsBadge = view?.teamsDetail.some((tm) => tm.players.length > 0 && tm.players.every((p) => !p.online));

  return (
    <HostCtx.Provider value={{ send, view, clockOffset: game.clockOffset }}>
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-800 bg-ink-950/95 px-4 py-2.5 backdrop-blur">
          <span className="font-display text-xl text-gold-400">{t("app.name")}</span>
          {view && (
            <span className="rounded-md bg-ink-800 px-2 py-0.5 font-mono text-sm font-bold tracking-widest" title={t("host.code")}>
              {view.joinCode}
            </span>
          )}
          {!game.connected && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold">{t("play.offline")}</span>}
          <LanguageToggle className="ml-auto" />
          <a href="/admin" className="rounded-lg bg-ink-800 px-2.5 py-1 text-sm font-semibold text-ink-200 hover:text-white" title={t("host.toAdmin")}>
            ⚙ {t("host.admin")}
          </a>
        </header>

        <main className="flex-1 px-4 pb-28 pt-4">
          {activeTab === "game" && view && <HostGame />}
          {activeTab === "teams" && view && <HostTeams />}
          {activeTab === "messages" && view && <HostMessages />}
          {activeTab === "quizzes" && (
            <>
              {!view && <p className="mb-4 text-ink-200">{t("host.noSession")}</p>}
              <QuizPicker onStarted={() => setTab("game")} />
            </>
          )}
        </main>

        {toast && (
          <div role="alert" className="fixed inset-x-4 bottom-24 z-30 mx-auto max-w-lg rounded-xl bg-red-600 px-4 py-3 font-semibold shadow-xl">
            {toast}
          </div>
        )}

        {view && (
          <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-ink-800 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
            <div className="mx-auto grid max-w-xl grid-cols-4">
              {(["game", "teams", "messages", "quizzes"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  aria-current={activeTab === k ? "page" : undefined}
                  className={`relative py-3.5 text-sm font-semibold ${activeTab === k ? "text-gold-400" : "text-ink-400"}`}
                >
                  {t(`host.tabs.${k}`)}
                  {k === "teams" && teamsBadge && <span className="absolute right-[30%] top-2.5 h-2 w-2 rounded-full bg-red-500" />}
                  {k === "messages" && view.overlay.message && (
                    <span className="absolute right-[22%] top-2.5 h-2 w-2 rounded-full bg-gold-400" />
                  )}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>
    </HostCtx.Provider>
  );
}
