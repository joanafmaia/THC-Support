import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeFirstRun,
  computeFollowingRun,
  isValidRepeat,
  validateRepeatValue,
} from "../lib/schedule.js";

const at = (iso) => new Date(iso);

describe("computeFirstRun", () => {
  it("uses today when the time has not passed yet", () => {
    const run = computeFirstRun({
      hour: 20,
      minute: 30,
      repeatType: "daily",
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-20T20:30:00.000Z");
  });

  it("rolls to tomorrow when the time already passed", () => {
    const run = computeFirstRun({
      hour: 9,
      minute: 0,
      repeatType: "daily",
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-21T09:00:00.000Z");
  });

  it("picks the next occurrence of the weekday, not a week later", () => {
    // 2026-08-20 is a Thursday; Saturday is 2 days away.
    const run = computeFirstRun({
      hour: 18,
      minute: 0,
      repeatType: "weekly",
      repeatValue: 6,
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-22T18:00:00.000Z");
  });

  it("keeps a weekly event on the same day when the time is still ahead", () => {
    const run = computeFirstRun({
      hour: 23,
      minute: 0,
      repeatType: "weekly",
      repeatValue: 4,
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-20T23:00:00.000Z");
  });

  it("moves a weekly event a full week when today's time has passed", () => {
    const run = computeFirstRun({
      hour: 8,
      minute: 0,
      repeatType: "weekly",
      repeatValue: 4,
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-27T08:00:00.000Z");
  });

  it("clamps a monthly day to the length of the month", () => {
    const run = computeFirstRun({
      hour: 12,
      minute: 0,
      repeatType: "monthly",
      repeatValue: 31,
      now: at("2026-09-15T10:00:00Z"),
    });
    assert.equal(run, "2026-09-30T12:00:00.000Z");
  });

  it("jumps to next month when the monthly day already passed", () => {
    const run = computeFirstRun({
      hour: 12,
      minute: 0,
      repeatType: "monthly",
      repeatValue: 1,
      now: at("2026-09-15T10:00:00Z"),
    });
    assert.equal(run, "2026-10-01T12:00:00.000Z");
  });

  it("converts local wall time to UTC using the offset", () => {
    // 21:00 in UTC-3 is 00:00 UTC the next day.
    const run = computeFirstRun({
      hour: 21,
      minute: 0,
      repeatType: "daily",
      timezoneOffset: -3,
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-21T00:00:00.000Z");
  });

  it("aligns the weekday in the user's timezone, not in UTC", () => {
    // Sunday 23:00 in UTC-3 is Monday 02:00 UTC.
    const run = computeFirstRun({
      hour: 23,
      minute: 0,
      repeatType: "weekly",
      repeatValue: 0,
      timezoneOffset: -3,
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-24T02:00:00.000Z");
    assert.equal(new Date(run).getUTCDay(), 1);
  });
});

describe("computeFollowingRun", () => {
  it("returns null for one-off events", () => {
    const run = computeFollowingRun({
      nextRun: "2026-08-20T20:00:00.000Z",
      repeatType: "once",
    });
    assert.equal(run, null);
  });

  it("adds one day for daily events", () => {
    const run = computeFollowingRun({
      nextRun: "2026-08-20T20:00:00.000Z",
      repeatType: "daily",
    });
    assert.equal(run, "2026-08-21T20:00:00.000Z");
  });

  it("adds two days for every2days events", () => {
    const run = computeFollowingRun({
      nextRun: "2026-08-20T20:00:00.000Z",
      repeatType: "every2days",
    });
    assert.equal(run, "2026-08-22T20:00:00.000Z");
  });

  it("keeps the weekday for weekly events", () => {
    const run = computeFollowingRun({
      nextRun: "2026-08-22T18:00:00.000Z",
      repeatType: "weekly",
      repeatValue: 6,
    });
    assert.equal(run, "2026-08-29T18:00:00.000Z");
    assert.equal(new Date(run).getUTCDay(), 6);
  });

  it("clamps monthly events to shorter months", () => {
    const run = computeFollowingRun({
      nextRun: "2026-01-31T12:00:00.000Z",
      repeatType: "monthly",
      repeatValue: 31,
    });
    assert.equal(run, "2026-02-28T12:00:00.000Z");
  });

  it("skips missed occurrences instead of replaying them", () => {
    const run = computeFollowingRun({
      nextRun: "2026-08-01T20:00:00.000Z",
      repeatType: "daily",
      now: at("2026-08-20T10:00:00Z"),
    });
    assert.equal(run, "2026-08-20T20:00:00.000Z");
  });

  it("preserves the local hour across the offset", () => {
    const run = computeFollowingRun({
      nextRun: "2026-08-21T00:00:00.000Z",
      repeatType: "daily",
      timezoneOffset: -3,
    });
    assert.equal(run, "2026-08-22T00:00:00.000Z");
  });
});

describe("validation", () => {
  it("accepts the documented repeat types", () => {
    for (const type of ["once", "daily", "every2days", "weekly", "monthly"]) {
      assert.equal(isValidRepeat(type), true);
    }
    assert.equal(isValidRepeat("hourly"), false);
  });

  it("requires a repeat_value for weekly and monthly", () => {
    assert.match(validateRepeatValue("weekly", null), /required/);
    assert.match(validateRepeatValue("monthly", null), /required/);
    assert.equal(validateRepeatValue("daily", null), null);
  });

  it("rejects out-of-range repeat values", () => {
    assert.match(validateRepeatValue("weekly", 7), /0-6/);
    assert.match(validateRepeatValue("monthly", 0), /1-31/);
    assert.equal(validateRepeatValue("weekly", 6), null);
    assert.equal(validateRepeatValue("monthly", 31), null);
  });
});
