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

const DEFAULT_LEVEL = "info";

/** An unknown LOG_LEVEL used to silence every log; fall back instead. */
function currentThreshold() {
  const configured = String(CONFIG.LOG_LEVEL || "").trim().toLowerCase();
  return LEVEL_PRIORITY[configured] ?? LEVEL_PRIORITY[DEFAULT_LEVEL];
}

function enabled(level) {
  return currentThreshold() >= LEVEL_PRIORITY[level];
}

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
    if (enabled("error")) {
      console.error(formatMessage("error", message, context));
    }
  },

  warn(message, context) {
    if (enabled("warn")) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  info(message, context) {
    if (enabled("info")) {
      console.log(formatMessage("info", message, context));
    }
  },

  debug(message, context) {
    if (enabled("debug")) {
      console.log(formatMessage("debug", message, context));
    }
  },
};

export default logger;
