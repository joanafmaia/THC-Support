import { MongoClient } from "mongodb";
import { CONFIG } from "../config.js";
import { logger } from "../logger.js";

let client;
let db;
let heartbeatHandle = null;

export async function connectDatabase() {
  if (db) return db;

  client = new MongoClient(CONFIG.MONGODB_URI, {
    // timeoutMS bounds the whole operation, retries included. Without it a dead
    // socket costs socketTimeout plus an automatic retry, which is long enough
    // for a slash command to give up before the driver does.
    timeoutMS: CONFIG.DB_TIMEOUT_MS,
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
  });

  await client.connect();
  db = client.db();

  const events = db.collection("events");
  await events.createIndex({ id: 1 }, { unique: true });
  await events.createIndex({ enabled: 1, next_run: 1 });
  await db.collection("backups").createIndex({ created_at: -1 });

  logger.info("MongoDB connected", "database");
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error("Database not connected. Call connectDatabase() first.");
  }
  return db;
}

/**
 * Keeps the connection pool warm. Free hosting suspends idle processes, and the
 * first query after waking up would otherwise stall on a stale socket.
 */
export function startDatabaseHeartbeat(intervalMs = 240_000) {
  if (heartbeatHandle) return;

  heartbeatHandle = setInterval(async () => {
    if (!db) return;
    try {
      await db.command({ ping: 1 });
      logger.debug("Database heartbeat ok", "database");
    } catch (error) {
      logger.warn(`Database heartbeat failed: ${error.message}`, "database");
    }
  }, intervalMs);

  heartbeatHandle.unref?.();
}

export function stopDatabaseHeartbeat() {
  if (!heartbeatHandle) return;
  clearInterval(heartbeatHandle);
  heartbeatHandle = null;
}

export async function closeDatabase() {
  stopDatabaseHeartbeat();
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
