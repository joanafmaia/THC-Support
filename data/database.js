import Database from "better-sqlite3";
import fs from "fs";

const dbPath = "./data/events.db";

// Ensure the folder exists
if (!fs.existsSync("./data")) {
  fs.mkdirSync("./data");
}

const db = new Database(dbPath);

// Create table if it doesn't exist
db.prepare(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message TEXT NOT NULL,

    -- When to send (UTC, ISO string)
    next_run TEXT NOT NULL,

    -- repeat: once | daily | every2days | weekly | monthly
    repeat_type TEXT NOT NULL,

    -- For weekly: 0-6 (Sun-Sat). For monthly: 1-31. Otherwise null
    repeat_value INTEGER,

    enabled INTEGER DEFAULT 1,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`).run();

const existingColumns = db.prepare("PRAGMA table_info(events)").all().map((col) => col.name);
if (!existingColumns.includes("last_error")) {
  db.prepare("ALTER TABLE events ADD COLUMN last_error TEXT").run();
}
if (!existingColumns.includes("last_attempt_at")) {
  db.prepare("ALTER TABLE events ADD COLUMN last_attempt_at TEXT").run();
}

export default db;
