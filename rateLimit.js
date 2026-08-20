import { Collection } from "discord.js";
import { CONFIG } from "./config.js";

const cooldowns = new Collection();
const COOLDOWN_DURATION = CONFIG.RATE_LIMIT_COOLDOWN_MS;
const PRUNE_EVERY = 100;

let writesSincePrune = 0;

/**
 * Drops entries that already expired, so the map does not grow with one
 * permanent entry per user who ever ran a command.
 */
function prune(now) {
  for (const [userId, startedAt] of cooldowns) {
    if (now - startedAt >= COOLDOWN_DURATION) {
      cooldowns.delete(userId);
    }
  }
}

export function isOnCooldown(userId) {
  const startedAt = cooldowns.get(userId);
  if (startedAt == null) return false;
  return Date.now() - startedAt < COOLDOWN_DURATION;
}

export function addCooldown(userId) {
  const now = Date.now();
  cooldowns.set(userId, now);

  writesSincePrune += 1;
  if (writesSincePrune >= PRUNE_EVERY) {
    writesSincePrune = 0;
    prune(now);
  }
}

export function getRemainingCooldown(userId) {
  const startedAt = cooldowns.get(userId);
  if (startedAt == null) return 0;
  return Math.max(0, Math.ceil((startedAt + COOLDOWN_DURATION - Date.now()) / 1000));
}

export default {
  isOnCooldown,
  addCooldown,
  getRemainingCooldown,
};
