import { MongoClient } from "mongodb";
import { CONFIG } from "../config.js";
import { logger } from "../logger.js";

let client;
let db;

export async function connectDatabase() {
  if (db) return db;

  client = new MongoClient(CONFIG.MONGODB_URI, {
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 8_000,
    socketTimeoutMS: 15_000,
  });
  await client.connect();
  db = client.db();

  const events = db.collection("events");
  await events.createIndex({ id: 1 }, { unique: true });
  await events.createIndex({ enabled: 1, next_run: 1 });

  logger.info("MongoDB connected", "database");
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error("Database not connected. Call connectDatabase() first.");
  }
  return db;
}

export async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
