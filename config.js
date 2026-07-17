import dotenv from "dotenv";
dotenv.config();

/**
 * Centralized bot configuration
 */
export const CONFIG = {
  // Discord
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  COMMAND_PREFIX: "/",

  // HTTP Server
  PORT: process.env.PORT || 3000,

  // Database
  MONGODB_URI: process.env.MONGODB_URI,

  // Scheduler
  CHECK_INTERVAL_MS: Number(process.env.CHECK_INTERVAL_MS) || 60_000, // 1 minute
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 5000, // 5 seconds

  // Discord Message
  MAX_MESSAGE_LENGTH: 2000,
  EMBED_COLOR: 0x5865F2, // Discord Blurple

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  // Backups
  BACKUP_INTERVAL_HOURS: Number(process.env.BACKUP_INTERVAL_HOURS) || 24,

  // Rate limiting
  RATE_LIMIT_COOLDOWN_MS: Number(process.env.RATE_LIMIT_COOLDOWN_MS) || 5000,

  // Stats protection (optional)
  STATS_TOKEN: process.env.STATS_TOKEN || "",
};

export default CONFIG;
