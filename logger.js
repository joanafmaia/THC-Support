/**
 * Sistema de logging profissional
 */
import { CONFIG } from "./config.js";

const LEVELS = {
  error: "❌",
  warn: "⚠️",
  info: "ℹ️",
  debug: "🔍",
};

const LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function formatMessage(level, message, context = null) {
  const icon = LEVELS[level] || "📝";
  const timestamp = formatTimestamp();
  const contextStr = context ? ` [${context}]` : "";
  return `${icon} [${timestamp}]${contextStr} ${message}`;
}

export const logger = {
  error(message, context) {
    if (LEVEL_PRIORITY[CONFIG.LOG_LEVEL] >= LEVEL_PRIORITY.error) {
      console.error(formatMessage("error", message, context));
    }
  },

  warn(message, context) {
    if (LEVEL_PRIORITY[CONFIG.LOG_LEVEL] >= LEVEL_PRIORITY.warn) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  info(message, context) {
    if (LEVEL_PRIORITY[CONFIG.LOG_LEVEL] >= LEVEL_PRIORITY.info) {
      console.log(formatMessage("info", message, context));
    }
  },

  debug(message, context) {
    if (LEVEL_PRIORITY[CONFIG.LOG_LEVEL] >= LEVEL_PRIORITY.debug) {
      console.log(formatMessage("debug", message, context));
    }
  },
};

export default logger;
