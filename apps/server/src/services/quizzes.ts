import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { primaryText, type Quiz, type QuizSummary, type Round } from "@kwistig/shared";
import type { Db } from "../db/client.js";
import { item, quiz, round } from "../db/schema.js";

/** Builds the quiz document back from rows. Exactly what was saved, so it round-trips. */
export function loadQuiz(db: Db, id: number): (Quiz & { id: number; uid: string }) | undefined {
  const q = db.select().from(quiz).where(eq(quiz.id, id)).get();
  if (!q) return undefined;
  const rounds = db.select().from(round).where(eq(round.quizId, id)).orderBy(asc(round.order)).all();
  const items = db
    .select({ roundId: item.roundId, payload: item.payload })
    .from(item)
    .innerJoin(round, eq(item.roundId, round.id))
    .where(eq(round.quizId, id))
    .orderBy(asc(item.order))
    .all();

  const doc: Quiz = {
    version: 1,
    title: q.meta.title,
    language: q.language,
    ...(q.meta.description !== undefined ? { description: q.meta.description } : {}),
    rounds: rounds.map((r): Round => ({
      title: r.title,
      ...(r.defaults ? { defaults: r.defaults } : {}),
      items: items.filter((i) => i.roundId === r.id).map((i) => i.payload),
    })),
  };
  return { id: q.id, uid: q.uid, ...doc };
}

/** Strips the DB ids loadQuiz adds, giving the pure import/export document. */
export function toDocument(q: Quiz & { id?: number; uid?: string }): Quiz {
  const { id: _id, uid: _uid, ...doc } = q;
  return doc;
}

function writeRounds(db: Db, quizId: number, doc: Quiz) {
  doc.rounds.forEach((r, ri) => {
    const { id: roundId } = db
      .insert(round)
      .values({ quizId, order: ri, title: r.title, defaults: r.defaults ?? null })
      .returning({ id: round.id })
      .get();
    r.items.forEach((it, ii) => {
      db.insert(item).values({ roundId, order: ii, kind: it.kind, payload: it }).run();
    });
  });
}

function rowFields(doc: Quiz) {
  return {
    title: primaryText(doc.title, doc.language),
    language: doc.language,
    description: doc.description !== undefined ? primaryText(doc.description, doc.language) : null,
    meta: { title: doc.title, ...(doc.description !== undefined ? { description: doc.description } : {}) },
  };
}

/** Inserts a validated quiz document as a new quiz. */
export function createQuiz(db: Db, doc: Quiz, uid: string = randomUUID()): number {
  return db.transaction((tx) => {
    const { id } = tx
      .insert(quiz)
      .values({ uid, ...rowFields(doc) })
      .returning({ id: quiz.id })
      .get();
    writeRounds(tx as unknown as Db, id, doc);
    return id;
  });
}

/** Replaces the content of an existing quiz. Returns false if it doesn't exist. */
export function replaceQuiz(db: Db, id: number, doc: Quiz): boolean {
  return db.transaction((tx) => {
    const res = tx
      .update(quiz)
      .set({ ...rowFields(doc), updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` })
      .where(eq(quiz.id, id))
      .run();
    if (res.changes === 0) return false;
    tx.delete(round).where(eq(round.quizId, id)).run();
    writeRounds(tx as unknown as Db, id, doc);
    return true;
  });
}

export function deleteQuiz(db: Db, id: number): boolean {
  return db.delete(quiz).where(eq(quiz.id, id)).run().changes > 0;
}

export function listQuizzes(db: Db): QuizSummary[] {
  const rows = db
    .select({
      id: quiz.id,
      title: quiz.title,
      language: quiz.language,
      description: quiz.description,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
      roundCount: sql<number>`(select count(*) from "round" r where r.quiz_id = "quiz"."id")`,
      itemCount: sql<number>`(select count(*) from "item" i join "round" r on i.round_id = r.id where r.quiz_id = "quiz"."id")`,
    })
    .from(quiz)
    .orderBy(sql`${quiz.updatedAt} desc`)
    .all();
  return rows;
}

/** A starter document for "new quiz": one round with an intro slide. */
export function starterQuiz(title: string, language: Quiz["language"]): Quiz {
  return {
    version: 1,
    title,
    language,
    rounds: [
      {
        title: language === "nl" ? "Ronde 1" : "Round 1",
        items: [{ kind: "slide", title }],
      },
    ],
  };
}
