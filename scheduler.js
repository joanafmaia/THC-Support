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
import { computeFollowingRun } from "./lib/schedule.js";

let intervalHandle = null;
let cycleRunning = false;

/**
 * Adds a new event to the database.
 * Errors propagate so the command can tell the user what went wrong.
 */
export async function addEvent({
  name,
  channelId,
  message,
  nextRun,
  repeatType,
  repeatValue = null,
  timezoneOffset = 0,
}) {
  const doc = await createEvent({
    name,
    channelId,
    message,
    nextRun,
    repeatType,
    repeatValue,
    timezoneOffset,
  });
  logger.info(`Event added: ${name} (ID: ${doc.id})`, "scheduler");
  return doc.id;
}

export async function deleteEvent(eventId) {
  await deleteEventById(eventId);
  logger.info(`Event deleted (ID: ${eventId})`, "scheduler");
}

export async function getDueEvents(untilTime = new Date().toISOString()) {
  return fetchDueEvents(untilTime);
}

export async function getNextEvent() {
  return fetchNextEvent();
}

/**
 * Starts the scheduler loop. Overlapping cycles are skipped, so a slow
 * database can never cause the same event to be sent twice.
 */
export function startScheduler(client) {
  if (intervalHandle) return;

  logger.info("Scheduler started (UTC)", "scheduler");

  intervalHandle = setInterval(async () => {
    if (cycleRunning) {
      logger.warn("Previous scheduler cycle still running, skipping this tick", "scheduler");
      return;
    }

    cycleRunning = true;
    try {
      await runCycle(client);
    } catch (error) {
      logger.error(`Scheduler cycle failed: ${error?.message || error}`, "scheduler");
    } finally {
      cycleRunning = false;
    }
  }, CONFIG.CHECK_INTERVAL_MS);
}

export function stopScheduler() {
  if (!intervalHandle) return;
  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info("Scheduler stopped", "scheduler");
}

async function runCycle(client) {
  const now = new Date();
  const dueEvents = await fetchDueEvents(now.toISOString());
  if (!dueEvents.length) return;

  for (const event of dueEvents) {
    const sent = await sendEventMessage(client, event, now);

    if (!sent) {
      await handleFailedSend(event);
      continue;
    }

    if (event.repeat_type === "once") {
      await disableEventAfterRun(event.id);
      continue;
    }

    const nextRun = computeFollowingRun({
      nextRun: event.next_run,
      repeatType: event.repeat_type,
      repeatValue: event.repeat_value,
      timezoneOffset: event.timezone_offset ?? 0,
      now,
    });

    await rescheduleEvent(event.id, nextRun);
    logger.info(`${event.name} rescheduled to: ${nextRun}`, "scheduler");
  }
}

/**
 * A due event that keeps failing would be retried every cycle forever,
 * so it gets disabled once the attempt limit is reached.
 */
async function handleFailedSend(event) {
  const attempts = (event.failed_attempts ?? 0) + 1;

  if (attempts < CONFIG.MAX_SEND_ATTEMPTS) {
    logger.warn(
      `Event ${event.id} (${event.name}) failed ${attempts}/${CONFIG.MAX_SEND_ATTEMPTS} times, will retry`,
      "scheduler"
    );
    return;
  }

  await disableEventAfterRun(event.id);
  logger.error(
    `Event ${event.id} (${event.name}) disabled after ${attempts} failed attempts`,
    "scheduler"
  );
}

async function sendEventMessage(client, event, now) {
  try {
    const channel = await client.channels.fetch(event.channel_id);
    if (!channel?.isTextBased()) {
      throw new Error(`Channel ${event.channel_id} is not a text channel`);
    }

    await channel.send(event.message);
    await recordSendAttempt(event.id, { success: true, attemptedAt: now.toISOString() });
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

export function formatEvent(event) {
  return `📅 **${event.name}** | 🔗 <#${event.channel_id}> | ⏰ ${event.next_run} | 🔄 ${event.repeat_type}${event.repeat_value != null ? ` (${event.repeat_value})` : ""}`;
}
