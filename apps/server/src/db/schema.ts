import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Item, LocalizedText, RoundDefaults } from "@kwistig/shared";
import type { z } from "zod";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text("created_at").notNull().default(now);

export const quiz = sqliteTable("quiz", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Stable id that travels in quiz packages, for "replace existing". */
  uid: text("uid").notNull().unique(),
  /** Primary-language title, for listing and sorting. */
  title: text("title").notNull(),
  language: text("language", { enum: ["nl", "en"] }).notNull(),
  /** Primary-language description, for listing. */
  description: text("description"),
  /** The exact LocalizedText values from the quiz document. */
  meta: text("meta", { mode: "json" })
    .$type<{ title: LocalizedText; description?: LocalizedText }>()
    .notNull(),
  createdAt: createdAt(),
  updatedAt: text("updated_at").notNull().default(now),
});

export const round = sqliteTable(
  "round",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    quizId: integer("quiz_id")
      .notNull()
      .references(() => quiz.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    title: text("title", { mode: "json" }).$type<LocalizedText>().notNull(),
    defaults: text("defaults", { mode: "json" }).$type<z.infer<typeof RoundDefaults>>(),
  },
  (t) => [uniqueIndex("round_quiz_order").on(t.quizId, t.order)],
);

export const item = sqliteTable(
  "item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roundId: integer("round_id")
      .notNull()
      .references(() => round.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    kind: text("kind", { enum: ["question", "slide"] }).notNull(),
    /** The item exactly as validated by the Item schema. */
    payload: text("payload", { mode: "json" }).$type<Item>().notNull(),
  },
  (t) => [uniqueIndex("item_round_order").on(t.roundId, t.order)],
);

export const mediaAsset = sqliteTable(
  "media_asset",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    quizId: integer("quiz_id").references(() => quiz.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["image", "youtube", "spotify", "news"] }).notNull(),
    /** Path under DATA_DIR/media for stored files. */
    path: text("path"),
    /** YouTube id, Spotify URI or news URL. */
    externalId: text("external_id"),
    sha256: text("sha256"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("media_sha").on(t.sha256)],
);

export const gameSession = sqliteTable("game_session", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quizId: integer("quiz_id").references(() => quiz.id, { onDelete: "set null" }),
  joinCode: text("join_code").notNull(),
  /** Machine phase, denormalised for queries. */
  state: text("state").notNull(),
  /** Full machine state snapshot, written on every transition. */
  stateJson: text("state_json", { mode: "json" }).$type<unknown>().notNull(),
  /** The quiz as it was when the session started, so editing mid-game is safe. */
  quizSnapshot: text("quiz_snapshot", { mode: "json" }).$type<unknown>().notNull(),
  currentItem: integer("current_item"),
  startedAt: createdAt(),
  endedAt: text("ended_at"),
});

export const team = sqliteTable(
  "team",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => gameSession.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    emoji: text("emoji").notNull(),
    color: text("color").notNull(),
    photoPath: text("photo_path"),
    score: real("score").notNull().default(0),
    standings: text("standings", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("team_session").on(t.sessionId)],
);

export const player = sqliteTable(
  "player",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    nickname: text("nickname"),
    tokenHash: text("token_hash").notNull().unique(),
    lastSeen: text("last_seen").notNull().default(now),
  },
  (t) => [index("player_team").on(t.teamId)],
);

export const answer = sqliteTable(
  "answer",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => gameSession.id, { onDelete: "cascade" }),
    /** Position of the item in the session's run order. */
    itemId: integer("item_id").notNull(),
    teamId: integer("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    playerId: integer("player_id").references(() => player.id, { onDelete: "set null" }),
    /** Image number in a flitsreeks; 0 otherwise. */
    subIndex: integer("sub_index").notNull().default(0),
    value: text("value", { mode: "json" }).$type<unknown>(),
    submittedAt: text("submitted_at").notNull(),
    verdict: text("verdict", { enum: ["correct", "half", "wrong", "pending"] }).notNull().default("pending"),
    points: real("points").notNull().default(0),
  },
  (t) => [uniqueIndex("answer_unique").on(t.sessionId, t.itemId, t.teamId, t.subIndex)],
);

export const setting = sqliteTable("setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
