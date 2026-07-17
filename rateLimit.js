import { Collection } from "discord.js";
import { CONFIG } from "./config.js";

const cooldowns = new Collection();
const COOLDOWN_DURATION = CONFIG.RATE_LIMIT_COOLDOWN_MS;

/**
 * Check if user is on cooldown
 */
export function isOnCooldown(userId) {
  if (cooldowns.has(userId)) {
    const expirationTime = cooldowns.get(userId) + COOLDOWN_DURATION;
    if (Date.now() < expirationTime) {
      return true;
    }
  }
  return false;
}

/**
 * Add user to cooldown
 */
export function addCooldown(userId) {
  cooldowns.set(userId, Date.now());
}

/**
 * Get remaining cooldown time in seconds
 */
export function getRemainingCooldown(userId) {
  const expirationTime = cooldowns.get(userId) + COOLDOWN_DURATION;
  return Math.ceil((expirationTime - Date.now()) / 1000);
}

export default {
  isOnCooldown,
  addCooldown,
  getRemainingCooldown,
};
