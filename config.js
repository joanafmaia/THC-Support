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
  DB_TIMEOUT_MS: Number(process.env.DB_TIMEOUT_MS) || 10_000,

  // Scheduler
  CHECK_INTERVAL_MS: Number(process.env.CHECK_INTERVAL_MS) || 60_000, // 1 minute
  MAX_SEND_ATTEMPTS: Number(process.env.MAX_SEND_ATTEMPTS) || 5,
  // If next_run is older than this, skip sending (bot was asleep) and only
  // jump the schedule forward. Default: 2 check intervals.
  OVERDUE_SKIP_GRACE_MS:
    Number(process.env.OVERDUE_SKIP_GRACE_MS) ||
    (Number(process.env.CHECK_INTERVAL_MS) || 60_000) * 2,

  // Discord Message
  MAX_MESSAGE_LENGTH: 2000,
  EMBED_COLOR: 0x00A651, // Hulk green

  // Shown in embeds so duplicate / stale instances are easy to spot.
  // Prefer Render's commit; fall back to a pinned marker so /health never says "local" in prod by accident.
  BUILD: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "a404000-dev").slice(0, 7),

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  // Backups
  BACKUP_ENABLED: process.env.BACKUP_ENABLED !== "false",
  BACKUP_INTERVAL_HOURS: Number(process.env.BACKUP_INTERVAL_HOURS) || 24,
  BACKUP_KEEP: Number(process.env.BACKUP_KEEP) || 14,

  // Rate limiting
  RATE_LIMIT_COOLDOWN_MS: Number(process.env.RATE_LIMIT_COOLDOWN_MS) || 5000,

  // Stats protection (optional)
  STATS_TOKEN: process.env.STATS_TOKEN || "",

  // Staff roles that may use /event and /backup.
  // Names are a fallback; IDs are preferred (THC R4 / R5).
  ALLOWED_ROLE_NAMES: (process.env.ALLOWED_ROLE_NAMES || "R4,R5")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ALLOWED_ROLE_IDS: (
    process.env.ALLOWED_ROLE_IDS ||
    "1526990769171202130,1526990454539944157"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

export default CONFIG;
