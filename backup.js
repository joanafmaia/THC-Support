import {
  countBackups,
  exportAllEvents,
  getLatestBackup,
  pruneBackups,
  saveBackup,
} from "./data/events.js";
import { logger } from "./logger.js";
import { CONFIG } from "./config.js";

let intervalHandle = null;
const backupStatus = {
  lastBackupAt: null,
  lastEventCount: null,
  lastError: null,
};

/**
 * Snapshots every event into the `backups` collection.
 * Returns the snapshot summary, or throws so callers can report the failure.
 */
export async function backupDatabase() {
  try {
    const events = await exportAllEvents();
    const createdAt = new Date().toISOString();

    await saveBackup({ events, createdAt });
    const removed = await pruneBackups(CONFIG.BACKUP_KEEP);

    backupStatus.lastBackupAt = createdAt;
    backupStatus.lastEventCount = events.length;
    backupStatus.lastError = null;

    logger.info(
      `Backed up ${events.length} events` + (removed ? ` (pruned ${removed} old snapshots)` : ""),
      "backup"
    );

    return { createdAt, eventCount: events.length };
  } catch (error) {
    backupStatus.lastError = error.message;
    logger.error(`Backup failed: ${error.message}`, "backup");
    throw error;
  }
}

export function startBackupSchedule(intervalHours = 24) {
  if (!CONFIG.BACKUP_ENABLED) {
    logger.info("Backups disabled (BACKUP_ENABLED=false)", "backup");
    return;
  }

  if (intervalHandle) return;

  backupDatabase().catch(() => {
    // Already logged; the schedule should still start.
  });

  intervalHandle = setInterval(() => {
    backupDatabase().catch(() => {});
  }, intervalHours * 60 * 60 * 1000);

  logger.info(`Database backups scheduled every ${intervalHours} hours`, "backup");
}

export function stopBackupSchedule() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info("Backup schedule stopped", "backup");
}

export async function getBackupStatus() {
  const [latest, total] = await Promise.all([getLatestBackup(), countBackups()]);

  return {
    ...backupStatus,
    storedBackups: total,
    latestStoredAt: latest?.created_at ?? null,
    latestEventCount: latest?.event_count ?? null,
  };
}

export function getLastBackupStatus() {
  return { ...backupStatus };
}

export default {
  backupDatabase,
  startBackupSchedule,
  stopBackupSchedule,
  getBackupStatus,
  getLastBackupStatus,
};
