import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exportAllEvents } from "./data/events.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "backups");
const backupStatus = {
  lastBackupAt: null,
  lastBackupPath: null,
  lastError: null,
};

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Export all events to a JSON backup file
 */
export async function backupDatabase() {
  try {
    const timestamp = new Date().toISOString().split("T")[0];
    const backupPath = path.join(BACKUP_DIR, `events-${timestamp}.json`);

    if (!fs.existsSync(backupPath)) {
      const events = await exportAllEvents();
      fs.writeFileSync(backupPath, JSON.stringify(events, null, 2), "utf-8");
      logger.info(`Database backed up: ${backupPath}`, "backup");
    }

    backupStatus.lastBackupAt = new Date().toISOString();
    backupStatus.lastBackupPath = backupPath;
    backupStatus.lastError = null;
  } catch (error) {
    backupStatus.lastError = error.message;
    logger.error(`Backup failed: ${error.message}`, "backup");
  }
}

/**
 * Start automatic backups
 */
export function startBackupSchedule(intervalHours = 24) {
  backupDatabase();

  setInterval(() => backupDatabase(), intervalHours * 60 * 60 * 1000);
  logger.info(`Database backups scheduled every ${intervalHours} hours`, "backup");
}

export function getLastBackupStatus() {
  return { ...backupStatus };
}

export default {
  backupDatabase,
  startBackupSchedule,
  getLastBackupStatus,
};
