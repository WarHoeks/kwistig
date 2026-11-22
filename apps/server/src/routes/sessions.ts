import type { FastifyInstance } from "fastify";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { primaryText, Quiz, type SessionSummary } from "@kwistig/shared";
import { HttpError, parse } from "../http.js";
import { gameSession, team } from "../db/schema.js";
import { photoUrl } from "../game/project.js";
import { requireHost } from "./auth.js";

/** Past (and the current) game sessions with their final standings. */
export async function sessionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireHost(app));

  app.get("/", async (): Promise<SessionSummary[]> => {
    const sessions = app.db
      .select({
        id: gameSession.id,
        quizId: gameSession.quizId,
        state: gameSession.state,
        snapshot: gameSession.quizSnapshot,
        startedAt: gameSession.startedAt,
        endedAt: gameSession.endedAt,
      })
      .from(gameSession)
      .orderBy(desc(gameSession.id))
      .all();
    const ids = sessions.map((s) => s.id);
    const teams = ids.length ? app.db.select().from(team).where(inArray(team.sessionId, ids)).all() : [];
    const activeId = app.game.state?.sessionId ?? null;
    return sessions.map((s) => {
      const quiz = Quiz.safeParse(s.snapshot);
      const ranked = teams.filter((t) => t.sessionId === s.id).sort((a, b) => b.score - a.score);
      let rank = 0;
      return {
        id: s.id,
        quizTitle: quiz.success ? primaryText(quiz.data.title, quiz.data.language) : "?",
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        active: s.id === activeId,
        phase: s.state,
        teams: ranked.map((t, i) => {
          if (i === 0 || t.score !== ranked[i - 1]!.score) rank = i + 1;
          return { name: t.name, emoji: t.emoji, color: t.color, score: t.score, rank, photoUrl: photoUrl(s.id, t.photoPath) };
        }),
      };
    });
  });

  /** Deletes a finished session with its teams, answers and team photos. */
  app.delete("/:id", async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    if (app.game.state?.sessionId === id) throw new HttpError(409, "session_active");
    const res = app.db.delete(gameSession).where(eq(gameSession.id, id)).run();
    if (res.changes === 0) throw new HttpError(404, "session_not_found");
    app.game.deleteSessionFiles(id);
    return reply.status(204).send();
  });
}
