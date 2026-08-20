import { getDb } from "./database.js";

function eventsCollection() {
  return getDb().collection("events");
}

async function getNextId() {
  const counters = getDb().collection("counters");
  const result = await counters.findOneAndUpdate(
    { _id: "events" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return result.seq;
}

function nowIso() {
  return new Date().toISOString();
}

export async function createEvent({
  name,
  channelId,
  message,
  nextRun,
  repeatType,
  repeatValue = null,
  timezoneOffset = 0,
}) {
  const id = await getNextId();
  const now = nowIso();

  const doc = {
    id,
    name,
    channel_id: channelId,
    message,
    next_run: nextRun,
    repeat_type: repeatType,
    repeat_value: repeatValue,
    timezone_offset: timezoneOffset,
    enabled: true,
    created_at: now,
    updated_at: now,
    last_error: null,
    last_attempt_at: null,
    failed_attempts: 0,
  };

  await eventsCollection().insertOne(doc);
  return doc;
}

export async function getEventById(id) {
  return eventsCollection().findOne({ id });
}

export async function updateEventById(id, fields) {
  const result = await eventsCollection().updateOne(
    { id },
    { $set: { ...fields, updated_at: nowIso() } }
  );
  return result.modifiedCount > 0;
}

export async function deleteEventById(id) {
  const result = await eventsCollection().deleteOne({ id });
  return result.deletedCount > 0;
}

export async function getDueEvents(untilTime = new Date().toISOString()) {
  return eventsCollection()
    .find({ enabled: true, next_run: { $lte: untilTime } })
    .sort({ next_run: 1 })
    .toArray();
}

export async function getNextEvent() {
  return eventsCollection().findOne({ enabled: true }, { sort: { next_run: 1 } });
}

export async function listEvents() {
  return eventsCollection()
    .find({}, { projection: { id: 1, name: 1, channel_id: 1, next_run: 1, repeat_type: 1, repeat_value: 1, enabled: 1 } })
    .sort({ enabled: -1, next_run: 1 })
    .toArray();
}

export async function listEventsForPreview() {
  return eventsCollection()
    .find({}, { projection: { id: 1, name: 1, message: 1, enabled: 1, next_run: 1 } })
    .sort({ enabled: -1, next_run: 1 })
    .toArray();
}

export async function getEventForPreview(id) {
  return eventsCollection().findOne(
    { id },
    { projection: { id: 1, name: 1, message: 1, enabled: 1, next_run: 1 } }
  );
}

export async function setEventEnabled(id, enabled) {
  const result = await eventsCollection().updateOne(
    { id },
    { $set: { enabled, updated_at: nowIso() } }
  );
  return result.matchedCount > 0;
}

export async function rescheduleEvent(id, nextRun) {
  await eventsCollection().updateOne(
    { id },
    { $set: { next_run: nextRun, updated_at: nowIso() }, $unset: { failed_attempts: "" } }
  );
}

export async function disableEventAfterRun(id) {
  await eventsCollection().updateOne(
    { id },
    { $set: { enabled: false, updated_at: nowIso() } }
  );
}

export async function recordSendAttempt(id, { success, error = null, attemptedAt }) {
  const update = {
    $set: {
      last_attempt_at: attemptedAt,
      last_error: success ? null : error,
      updated_at: nowIso(),
    },
  };

  if (success) {
    update.$set.failed_attempts = 0;
  } else {
    update.$inc = { failed_attempts: 1 };
  }

  await eventsCollection().updateOne({ id }, update);
}

export async function countEvents() {
  const total = await eventsCollection().countDocuments();
  const active = await eventsCollection().countDocuments({ enabled: true });
  return { total, active };
}

export async function exportAllEvents() {
  return eventsCollection().find({}).sort({ id: 1 }).toArray();
}

function backupsCollection() {
  return getDb().collection("backups");
}

/**
 * Backups live in the database because the Render filesystem is wiped on
 * every deploy, which silently threw away the old JSON files.
 */
export async function saveBackup({ events, createdAt = nowIso() }) {
  await backupsCollection().insertOne({
    created_at: createdAt,
    event_count: events.length,
    events,
  });
}

export async function pruneBackups(keep) {
  const stale = await backupsCollection()
    .find({}, { projection: { _id: 1 } })
    .sort({ created_at: -1 })
    .skip(keep)
    .toArray();

  if (!stale.length) return 0;

  const result = await backupsCollection().deleteMany({
    _id: { $in: stale.map((doc) => doc._id) },
  });
  return result.deletedCount;
}

export async function getLatestBackup() {
  return backupsCollection().findOne(
    {},
    { projection: { events: 0 }, sort: { created_at: -1 } }
  );
}

export async function countBackups() {
  return backupsCollection().countDocuments();
}
