import {
  createEvent,
  deleteEventById,
  getDueEvents as fetchDueEvents,
  getNextEvent as fetchNextEvent,
  rescheduleEvent,
  disableEventAfterRun,
  recordSendAttempt,
} from "./data/events.js";
import { logger } from "./logger.js";
import { CONFIG } from "./config.js";

/**
 * Adds a new event to the database
 */
export async function addEvent(name, channelId, message, nextRun, repeatType, repeatValue = null) {
  try {
    const doc = await createEvent({
      name,
      channelId,
      message,
      nextRun,
      repeatType,
      repeatValue,
    });
    logger.info(`Event added: ${name} (ID: ${doc.id})`, "scheduler");
    return doc.id;
  } catch (error) {
    logger.error(`Error adding event: ${error.message}`, "scheduler");
    return null;
  }
}

/**
 * Deletes an event
 */
export async function deleteEvent(eventId) {
  try {
    await deleteEventById(eventId);
    logger.info(`Event deleted (ID: ${eventId})`, "scheduler");
  } catch (error) {
    logger.error(`Error deleting event: ${error.message}`, "scheduler");
  }
}

/**
 * Returns all due events (next_run <= now)
 */
export async function getDueEvents(untilTime = new Date().toISOString()) {
  try {
    return await fetchDueEvents(untilTime);
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
    const dueEvents = await getDueEvents(now.toISOString());
    if (!dueEvents.length) return;

    for (const event of dueEvents) {
      const sentOk = await sendEventMessage(client, event, now);
      if (!sentOk) {
        continue;
      }

      const eventTime = new Date(event.next_run);

      if (event.repeat_type !== "once") {
        const nextRun = calculateNextRun(eventTime, event.repeat_type, event.repeat_value);
        await rescheduleEvent(event.id, nextRun);
        logger.info(`${event.name} rescheduled to: ${nextRun}`, "scheduler");
      } else {
        await disableEventAfterRun(event.id);
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
      await recordSendAttempt(event.id, {
        success: false,
        error: "Channel not found",
        attemptedAt: now.toISOString(),
      });
      return false;
    }

    await channel.send(event.message);
    await recordSendAttempt(event.id, {
      success: true,
      attemptedAt: now.toISOString(),
    });
    logger.info(`Event sent: ${event.name}`, "scheduler");
    return true;
  } catch (error) {
    logger.error(`Failed to send event ${event.name}: ${error.message}`, "scheduler");
    await recordSendAttempt(event.id, {
      success: false,
      error: error.message,
      attemptedAt: now.toISOString(),
    });
    return false;
  }
}

/**
 * Returns the next scheduled event (future)
 */
export async function getNextEvent() {
  try {
    return await fetchNextEvent();
  } catch (error) {
    logger.error(`Error fetching next event: ${error.message}`, "scheduler");
    return null;
  }
}

/**
 * Formats an event for display
 */
export function formatEvent(event) {
  return `📅 **${event.name}** | 🔗 <#${event.channel_id}> | ⏰ ${event.next_run} | 🔄 ${event.repeat_type}${event.repeat_value != null ? ` (${event.repeat_value})` : ""}`;
}
