const MS_PER_HOUR = 3_600_000;

export const REPEAT_TYPES = ["once", "daily", "every2days", "weekly", "monthly"];

export function isValidRepeat(type) {
  return REPEAT_TYPES.includes(type);
}

/**
 * Returns an error message when repeat_value does not match the repeat type,
 * or null when the combination is valid.
 */
export function validateRepeatValue(repeatType, repeatValue) {
  if (repeatType === "weekly") {
    if (repeatValue == null) {
      return "repeat_value is required for weekly (0-6, Sun-Sat).";
    }
    if (repeatValue < 0 || repeatValue > 6) {
      return "repeat_value must be 0-6 (Sun-Sat) for weekly events.";
    }
  }

  if (repeatType === "monthly") {
    if (repeatValue == null) {
      return "repeat_value is required for monthly (1-31).";
    }
    if (repeatValue < 1 || repeatValue > 31) {
      return "repeat_value must be 1-31 for monthly events.";
    }
  }

  return null;
}

/** Parse "HH:MM" or "H:MM" into { hour, minute } or an error string. */
export function parseTimeInput(raw) {
  const match = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "Use time as HH:MM (e.g. 20:30).";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "Hour must be 0-23 and minute 0-59.";
  }
  return { hour, minute };
}

/** Parse timezone offset string like "0", "-3", "+1". */
export function parseTimezoneInput(raw) {
  const text = String(raw ?? "").trim();
  if (!/^[+-]?\d{1,2}$/.test(text)) {
    return "Timezone must be a number from -12 to 14 (e.g. 0 or -3).";
  }
  const value = Number(text);
  if (value < -12 || value > 14) {
    return "Timezone must be between -12 and 14.";
  }
  return value;
}

/**
 * Optional first-run date for create flow (UTC game calendar).
 * - blank → null (use next occurrence from now)
 * - YYYY-MM-DD → that UTC date at hour:minute
 * Returns ISO string, null, or an error message string.
 */
export function parseStartDateInput(raw, { hour, minute, now = new Date() } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!iso) {
    return "Use YYYY-MM-DD (e.g. 2026-08-25), or leave blank.";
  }

  const year = Number(iso[1]);
  const month = Number(iso[2]) - 1;
  const day = Number(iso[3]);
  const check = new Date(Date.UTC(year, month, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day
  ) {
    return "Invalid date.";
  }

  if (hour == null || minute == null) {
    return "Set the game time before choosing a start date.";
  }

  const candidate = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
  if (candidate <= now) {
    return "First run must be in the future. Pick a later date or time.";
  }
  return candidate.toISOString();
}

/**
 * First run ISO: pinned start date if provided, otherwise next occurrence from now.
 * Returns ISO string or an error message string when the start date is invalid.
 */
export function resolveFirstRun({
  hour,
  minute,
  startDateInput = "",
  repeatType,
  repeatValue = null,
  timezoneOffset = 0,
  now = new Date(),
}) {
  const pinned = parseStartDateInput(startDateInput, { hour, minute, now });
  if (typeof pinned === "string") return pinned;
  if (pinned) return pinned;
  return computeFirstRun({
    hour,
    minute,
    repeatType,
    repeatValue,
    timezoneOffset,
    now,
  });
}

/** Local weekday (0-6) and month day for a UTC offset. */
export function localCalendarParts(timezoneOffset = 0, now = new Date()) {
  const local = new Date(now.getTime() + timezoneOffset * MS_PER_HOUR);
  return {
    weekday: local.getUTCDay(),
    monthDay: local.getUTCDate(),
  };
}

// Shifting the instant by the offset lets us use the UTC getters to reason
// about the user's wall clock; every result is shifted back before returning.
function toLocal(date, offsetHours) {
  return new Date(date.getTime() + offsetHours * MS_PER_HOUR);
}

function toUtc(date, offsetHours) {
  return new Date(date.getTime() - offsetHours * MS_PER_HOUR);
}

function atTime(date, hour, minute) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute, 0, 0)
  );
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function nextDailyLike(localNow, hour, minute) {
  const candidate = atTime(localNow, hour, minute);
  return candidate > localNow ? candidate : addDays(candidate, 1);
}

function nextWeekly(localNow, hour, minute, targetDow) {
  const candidate = atTime(localNow, hour, minute);
  const daysAhead = (targetDow - candidate.getUTCDay() + 7) % 7;
  const aligned = addDays(candidate, daysAhead);
  return aligned > localNow ? aligned : addDays(aligned, 7);
}

function nextMonthly(localNow, hour, minute, targetDom) {
  for (let monthsAhead = 0; monthsAhead <= 2; monthsAhead += 1) {
    const year = localNow.getUTCFullYear();
    const month = localNow.getUTCMonth() + monthsAhead;
    const day = Math.min(targetDom, lastDayOfMonth(year, month));
    const candidate = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
    if (candidate > localNow) return candidate;
  }
  throw new Error(`Could not compute a monthly run for day ${targetDom}`);
}

/**
 * First run for a new event, expressed in UTC.
 * hour/minute are the user's local wall clock, interpreted with timezoneOffset.
 */
export function computeFirstRun({
  hour,
  minute,
  repeatType,
  repeatValue = null,
  timezoneOffset = 0,
  now = new Date(),
}) {
  const localNow = toLocal(now, timezoneOffset);

  let localNext;
  switch (repeatType) {
    case "weekly":
      localNext = nextWeekly(localNow, hour, minute, Number(repeatValue));
      break;
    case "monthly":
      localNext = nextMonthly(localNow, hour, minute, Number(repeatValue));
      break;
    default:
      localNext = nextDailyLike(localNow, hour, minute);
      break;
  }

  return toUtc(localNext, timezoneOffset).toISOString();
}

function advanceOnce(localCurrent, repeatType, repeatValue) {
  switch (repeatType) {
    case "daily":
      return addDays(localCurrent, 1);
    case "every2days":
      return addDays(localCurrent, 2);
    case "weekly":
      return addDays(localCurrent, 7);
    case "monthly": {
      const year = localCurrent.getUTCFullYear();
      const month = localCurrent.getUTCMonth() + 1;
      const targetDom = Number.isInteger(Number(repeatValue))
        ? Number(repeatValue)
        : localCurrent.getUTCDate();
      const day = Math.min(targetDom, lastDayOfMonth(year, month));
      return new Date(
        Date.UTC(year, month, day, localCurrent.getUTCHours(), localCurrent.getUTCMinutes(), 0, 0)
      );
    }
    default:
      return addDays(localCurrent, 1);
  }
}

/**
 * Run after the given one, in UTC, or null for one-off events.
 * When `now` is provided, skips occurrences already in the past so a bot that
 * was offline for days does not replay every missed run.
 */
export function computeFollowingRun({
  nextRun,
  repeatType,
  repeatValue = null,
  timezoneOffset = 0,
  now = null,
}) {
  if (repeatType === "once") return null;

  let localNext = advanceOnce(toLocal(new Date(nextRun), timezoneOffset), repeatType, repeatValue);

  if (now) {
    const localNow = toLocal(now, timezoneOffset);
    // Bounded so a corrupt date can never spin forever.
    for (let guard = 0; localNext <= localNow && guard < 1000; guard += 1) {
      localNext = advanceOnce(localNext, repeatType, repeatValue);
    }
  }

  return toUtc(localNext, timezoneOffset).toISOString();
}
