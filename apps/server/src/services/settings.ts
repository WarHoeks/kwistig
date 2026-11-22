import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { setting } from "../db/schema.js";

export function getSetting(db: Db, key: string): string | undefined {
  return db.select().from(setting).where(eq(setting.key, key)).get()?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.insert(setting).values({ key, value }).onConflictDoUpdate({ target: setting.key, set: { value } }).run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(setting).where(eq(setting.key, key)).run();
}
