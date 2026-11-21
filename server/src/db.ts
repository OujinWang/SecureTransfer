import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const dataDirectory =
  process.env.DATA_DIR ??
  fileURLToPath(new URL("../data/", import.meta.url));

const databasePath = join(dataDirectory, "secure-transfer.db");

mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);

/** 初始化数据库配置和数据表。 */
export function initializeDatabase(): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash BLOB NOT NULL,
      salt BLOB NOT NULL,
      is_vip INTEGER NOT NULL DEFAULT 0 CHECK (is_vip IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL CHECK (size >= 0),
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_files_owner_created
      ON files(owner_id, created_at DESC);
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_shares (
      file_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (file_id, recipient_id),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_file_shares_recipient
    ON file_shares(recipient_id, created_at DESC);
  `);

  // VIP 字段。
  const userColumns = db
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;

  if (!userColumns.some((column) => column.name === "is_vip")) {
    db.exec(`
      ALTER TABLE users
      ADD COLUMN is_vip INTEGER NOT NULL DEFAULT 0
      CHECK (is_vip IN (0, 1))
    `);
  }

  console.log("Database initialized");
}
