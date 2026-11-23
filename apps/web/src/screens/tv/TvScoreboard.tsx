import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGroup, motion } from "framer-motion";
import type { PublicTeam, TvView } from "@kwistig/shared";
import { TeamPhoto } from "../../components/TeamPhoto";
import { formatScore } from "../../lib/text";
import { calm, confettiFrom, firstTime, winnerConfetti } from "../../lib/effects";
import { sounds } from "../../lib/sounds";

/** The order the TV last showed, so rank changes can animate from there. */
let lastOrder: number[] = [];

const sortTeams = (teams: PublicTeam[]) => [...teams].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));

/**
 * Ranked standings with team photos and their standings effects. Rows start in the
 * previously shown order and glide to the new one (Framer Motion layout).
 * After a reveal that ended a round, round winners get a crown and confetti.
 */
export function Scoreboard({ view, title, final = false }: { view: TvView; title?: string; final?: boolean }) {
  if (final) return <Finale view={view} />;
  return <Standings view={view} title={title} />;
}

function Standings({ view, title }: { view: TvView; title?: string }) {
  const { t, i18n } = useTranslation();
  const target = sortTeams(view.teams);
  const byId = new Map(view.teams.map((tm) => [tm.id, tm]));
  const start = lastOrder.filter((id) => byId.has(id));
  const fresh = target.filter((tm) => !start.includes(tm.id)).map((tm) => tm.id);
  const [order, setOrder] = useState<number[]>(start.length ? [...start, ...fresh] : target.map((tm) => tm.id));
  const standings = new Map(view.standings?.teams.map((s) => [s.teamId, s]));
  const seq = view.standings?.seq ?? 0;
  const roundEnd = view.standings?.roundIndex !== null && view.standings?.roundIndex !== undefined;
  const list = useRef<HTMLOListElement>(null);

  // Slide to the new order after a beat, then remember it.
  const targetKey = target.map((tm) => tm.id).join(",");
  useEffect(() => {
    const ids = targetKey.split(",").map(Number);
    const timer = setTimeout(() => setOrder(ids), calm() ? 0 : 700);
    lastOrder = ids;
    return () => clearTimeout(timer);
  }, [targetKey]);

  // Round winners: confetti shower once per standings change.
  useEffect(() => {
    if (!roundEnd || !firstTime(`round:${seq}`)) return;
    const winners = view.standings!.teams.filter((s) => s.roundWinner);
    if (winners.length === 0) return;
    const timer = setTimeout(() => {
      for (const w of winners) confettiFrom(list.current?.querySelector(`[data-team="${w.teamId}"]`) ?? null, { shower: true });
    }, 900);
    return () => clearTimeout(timer);
  }, [roundEnd, seq, view.standings]);

  const many = view.teams.length > 8;
  const rowH = many ? 78 : 104;
  return (
    <div className="flex h-full flex-col px-32 py-14">
      <h1 className="text-center font-display text-[96px] text-gold-400">{title ?? t("tv.scoreboard")}</h1>
      <LayoutGroup>
        <ol ref={list} className={`mx-auto mt-10 flex w-full max-w-[1400px] flex-col ${many ? "gap-3" : "gap-5"}`}>
          {order.map((id) => {
            const team = byId.get(id);
            if (!team) return null;
            const st = standings.get(id);
            return (
              <motion.li
                layout={!calm()}
                transition={{ type: "spring", stiffness: 140, damping: 20 }}
                key={id}
                data-team={id}
                className={`flex items-center gap-8 rounded-[28px] px-8 ${st?.leader ? "bg-gold-400/15" : "bg-white/5"}`}
                style={{ height: rowH }}
              >
                <span className="w-[90px] text-center font-display text-[56px] tabular-nums">{team.rank}</span>
                <TeamPhoto team={team} standing={st} seq={seq} size={rowH - 22} showCrown={roundEnd} />
                <span className="min-w-0 flex-1 truncate text-[52px] font-bold">{team.name}</span>
                <span className="font-display text-[64px] tabular-nums">{formatScore(team.score, i18n.language)}</span>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>
    </div>
  );
}

/**
 * "En de winnaar is…": a drum roll, then the teams from last place up, and finally
 * the winner large with confetti and a fanfare.
 */
function Finale({ view }: { view: TvView }) {
  const { t, i18n } = useTranslation();
  const ranked = sortTeams(view.teams);
  const winners = ranked.filter((tm) => tm.rank === 1);
  const rest = ranked.filter((tm) => tm.rank !== 1).reverse(); // last place first
  const skip = calm();
  const [shown, setShown] = useState(skip ? rest.length : -1); // -1: drum roll
  const [winnerShown, setWinnerShown] = useState(skip);
  const standings = new Map(view.standings?.teams.map((s) => [s.teamId, s]));

  useEffect(() => {
    if (skip || !firstTime(`finale:${view.sessionId}`)) {
      setShown(rest.length);
      setWinnerShown(true);
      return;
    }
    sounds.drumroll();
    const timers: ReturnType<typeof setTimeout>[] = [];
    rest.forEach((_, i) => timers.push(setTimeout(() => setShown(i + 1), 2600 + i * 900)));
    timers.push(
      setTimeout(() => {
        setShown(rest.length);
        setWinnerShown(true);
        sounds.fanfare();
        winnerConfetti();
      }, 2600 + rest.length * 900 + 800),
    );
    return () => timers.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full gap-16 px-24 py-16" data-testid="tv-finale">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-[48px] font-semibold uppercase tracking-[0.2em] text-gold-300/80">{t("tv.finaleTitle")}</p>
        {winnerShown ? (
          <motion.div initial={skip ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 120, damping: 12 }} className="mt-10 flex flex-col items-center gap-8">
            <div className="flex gap-10">
              {winners.map((w) => (
                <TeamPhoto key={w.id} team={w} standing={standings.get(w.id)} seq={-1} size={winners.length > 1 ? 260 : 380} rounded="rounded-[40px]" animate={false} />
              ))}
            </div>
            <p className="font-display text-[110px] leading-none text-gold-400" data-testid="finale-winner">
              {winners.map((w) => w.name).join(" & ")}
            </p>
            <p className="text-[56px] font-bold">
              🏆 {t("tv.winner")} · {formatScore(winners[0]?.score ?? 0, i18n.language)}
            </p>
          </motion.div>
        ) : (
          <p className="mt-16 animate-pulse font-display text-[160px] text-gold-400">…</p>
        )}
      </div>
      <ol className="flex w-[680px] shrink-0 flex-col justify-center gap-4">
        {rest.map((tm, i) =>
          i < shown ? (
            <motion.li
              key={tm.id}
              initial={skip ? false : { x: 120, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="flex items-center gap-6 rounded-3xl bg-white/5 px-6 py-3"
            >
              <span className="w-[60px] text-center font-display text-[44px]">{tm.rank}</span>
              <TeamPhoto team={tm} standing={standings.get(tm.id)} seq={-1} size={72} animate={false} />
              <span className="min-w-0 flex-1 truncate text-[40px] font-bold">{tm.name}</span>
              <span className="font-display text-[48px] tabular-nums">{formatScore(tm.score, i18n.language)}</span>
            </motion.li>
          ) : null,
        )}
      </ol>
    </div>
  );
}
