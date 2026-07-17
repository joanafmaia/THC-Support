import db from "./data/database.js";
import { logger } from "./logger.js";
import { CONFIG } from "./config.js";

/**
 * Adds a new event to the database
 */
export function addEvent(name, channelId, message, nextRun, repeatType, repeatValue = null) {
  try {
    const stmt = db.prepare(`
      INSERT INTO events (name, channel_id, message, next_run, repeat_type, repeat_value, enabled)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(name, channelId, message, nextRun, repeatType, repeatValue);
    logger.info(`Event added: ${name} (ID: ${result.lastInsertRowid})`, "scheduler");
    return result.lastInsertRowid;
  } catch (error) {
    logger.error(`Error adding event: ${error.message}`, "scheduler");
    return null;
  }
}

/**
 * Updates an existing event
 */
export function updateEvent(eventId, name, channelId, message, nextRun, repeatType, repeatValue = null) {
  try {
    const stmt = db.prepare(`
      UPDATE events
      SET name = ?, channel_id = ?, message = ?, next_run = ?, repeat_type = ?, repeat_value = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(name, channelId, message, nextRun, repeatType, repeatValue, eventId);
    logger.info(`Event updated: ${name} (ID: ${eventId})`, "scheduler");
  } catch (error) {
    logger.error(`Error updating event: ${error.message}`, "scheduler");
  }
}

/**
 * Deletes an event
 */
export function deleteEvent(eventId) {
  try {
    const stmt = db.prepare("DELETE FROM events WHERE id = ?");
    stmt.run(eventId);
    logger.info(`Event deleted (ID: ${eventId})`, "scheduler");
  } catch (error) {
    logger.error(`Error deleting event: ${error.message}`, "scheduler");
  }
}

/**
 * Returns all due events (next_run <= now)
 */
export function getDueEvents(untilTime = new Date().toISOString()) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE enabled = 1 AND next_run <= ?
      ORDER BY next_run ASC
    `);
    return stmt.all(untilTime);
  } catch (error) {
    logger.error(`Error fetching due events: ${error.message}`, "scheduler");
    return [];
  }
}

/**
 * Calculates the next execution time based on the repeat type.
 * Uses the scheduled event time (eventTime), not "now", to avoid drift.
 */
function calculateNextRun(eventTime, repeatType, repeatValue) {
  const next = new Date(eventTime);

  switch (repeatType) {
    case "once":
      return null;

    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;

    case "every2days":
      next.setUTCDate(next.getUTCDate() + 2);
      break;

    case "weekly": {
      const targetDay = Number(repeatValue);
      const currentDay = next.getUTCDay();
      let addDays = (targetDay - currentDay + 7) % 7;
      if (addDays === 0) addDays = 7;
      next.setUTCDate(next.getUTCDate() + addDays);
      break;
    }

    case "monthly": {
      next.setUTCMonth(next.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      const dayToSet = Math.min(Number(repeatValue), lastDay);
      next.setUTCDate(dayToSet);
      break;
    }

    default:
      next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.toISOString();
}

/**
 * Starts the scheduler loop (checks every minute)
 */
export function startScheduler(client) {
  logger.info("Scheduler started (UTC)", "scheduler");

  setInterval(async () => {
    const now = new Date();
    const dueEvents = getDueEvents(now.toISOString());
    if (!dueEvents.length) return;

    for (const event of dueEvents) {
      const sentOk = await sendEventMessage(client, event, now);
      if (!sentOk) {
        continue;
      }

      const eventTime = new Date(event.next_run);

      if (event.repeat_type !== "once") {
        const nextRun = calculateNextRun(eventTime, event.repeat_type, event.repeat_value);

        db.prepare(`
          UPDATE events SET next_run = ?, updated_at = datetime('now') WHERE id = ?
        `).run(nextRun, event.id);

        logger.info(`${event.name} rescheduled to: ${nextRun}`, "scheduler");
      } else {
        db.prepare(`
          UPDATE events SET enabled = 0, updated_at = datetime('now') WHERE id = ?
        `).run(event.id);
      }
    }
  }, CONFIG.CHECK_INTERVAL_MS);
}

/**
 * Sends the event message to Discord
 * Returns true if sent, false if failed.
 */
async function sendEventMessage(client, event, now) {
  try {
    const channel = await client.channels.fetch(event.channel_id);
    if (!channel) {
      logger.error(`Channel ${event.channel_id} not found for event: ${event.name}`, "scheduler");
      db.prepare(`
        UPDATE events
        SET last_attempt_at = ?, last_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(now.toISOString(), "Channel not found", event.id);
      return false;
    }

    await channel.send(event.message);
    db.prepare(`
      UPDATE events
      SET last_attempt_at = ?, last_error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(now.toISOString(), event.id);
    logger.info(`Event sent: ${event.name}`, "scheduler");
    return true;
  } catch (error) {
    logger.error(`Failed to send event ${event.name}: ${error.message}`, "scheduler");
    db.prepare(`
      UPDATE events
      SET last_attempt_at = ?, last_error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(now.toISOString(), error.message, event.id);
    return false;
  }
}

/**
 * Returns the next scheduled event (future)
 */
export function getNextEvent() {
  try {
    const stmt = db.prepare(`
      SELECT * FROM events
      WHERE enabled = 1
      ORDER BY next_run ASC
      LIMIT 1
    `);
    return stmt.get();
  } catch (error) {
    logger.error(`Error fetching next event: ${error.message}`, "scheduler");
    return null;
  }
}

/**
 * Formats an event for display
 */
export function formatEvent(event) {
  return `📅 **${event.name}** | 🔗 <#${event.channel_id}> | ⏰ ${event.next_run} | 🔄 ${event.repeat_type}${event.repeat_value != null ? ` (${repeat_value})` : ""}`;
}
