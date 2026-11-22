CREATE TABLE `answer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`team_id` integer NOT NULL,
	`player_id` integer,
	`sub_index` integer DEFAULT 0 NOT NULL,
	`value` text,
	`submitted_at` text NOT NULL,
	`verdict` text DEFAULT 'pending' NOT NULL,
	`points` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `answer_unique` ON `answer` (`session_id`,`item_id`,`team_id`,`sub_index`);--> statement-breakpoint
CREATE TABLE `game_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer,
	`join_code` text NOT NULL,
	`state` text NOT NULL,
	`state_json` text NOT NULL,
	`quiz_snapshot` text NOT NULL,
	`current_item` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`order` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `round`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_round_order` ON `item` (`round_id`,`order`);--> statement-breakpoint
CREATE TABLE `media_asset` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer,
	`kind` text NOT NULL,
	`path` text,
	`external_id` text,
	`sha256` text,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_sha` ON `media_asset` (`sha256`);--> statement-breakpoint
CREATE TABLE `player` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` integer NOT NULL,
	`nickname` text,
	`token_hash` text NOT NULL,
	`last_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_token_hash_unique` ON `player` (`token_hash`);--> statement-breakpoint
CREATE INDEX `player_team` ON `player` (`team_id`);--> statement-breakpoint
CREATE TABLE `quiz` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`title` text NOT NULL,
	`language` text NOT NULL,
	`description` text,
	`meta` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quiz_uid_unique` ON `quiz` (`uid`);--> statement-breakpoint
CREATE TABLE `round` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quiz_id` integer NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`defaults` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `round_quiz_order` ON `round` (`quiz_id`,`order`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`color` text NOT NULL,
	`photo_path` text,
	`score` real DEFAULT 0 NOT NULL,
	`standings` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `game_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_session` ON `team` (`session_id`);