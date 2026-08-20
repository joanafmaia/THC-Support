import { randomUUID, timingSafeEqual } from "node:crypto";

import express from "express";
import { Client, GatewayIntentBits, Collection, MessageFlags } from "discord.js";

import { logger } from "./logger.js";
import { CONFIG } from "./config.js";
import eventCommand from "./commands/event.js";
import backupCommand from "./commands/backup.js";
import pingCommand from "./commands/ping.js";
import { startScheduler, stopScheduler, getDueEvents } from "./scheduler.js";
import { startBackupSchedule, stopBackupSchedule } from "./backup.js";
import { isOnCooldown, addCooldown, getRemainingCooldown } from "./rateLimit.js";
import { connectDatabase, closeDatabase, startDatabaseHeartbeat } from "./data/database.js";
import { countEvents } from "./data/events.js";
import { answer } from "./lib/respond.js";

const TOKEN = CONFIG.DISCORD_TOKEN;
const PORT = CONFIG.PORT;

/** Identifies this process in logs and replies, so duplicate instances are detectable. */
const INSTANCE_ID = randomUUID().slice(0, 8);

if (!TOKEN) {
  logger.error("Error: DISCORD_TOKEN is missing in .env");
  process.exit(1);
}

if (!CONFIG.MONGODB_URI) {
  logger.error("Error: MONGODB_URI is missing in .env");
  process.exit(1);
}

// Guilds is enough: the bot only answers interactions and sends messages.
// The REST defaults (15s per attempt, several retries) outlive an interaction,
// so requests are kept short and retried at most once.
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  // Zero retries: a 4xx must fail immediately so we see the real Discord code
  // instead of hanging until our command timeout while counting as invalid.
  rest: { timeout: 8_000, retries: 0, invalidRequestWarningInterval: 1 },
});

// A request can also sit in the rate-limit queue, where the timeout above does
// not apply, so surface what the REST handler is waiting for.
client.rest.on("rateLimited", (info) => {
  logger.warn(
    `Rate limited on ${info.method} ${info.route} — waiting ${info.timeToReset}ms ` +
      `(global=${info.global}, limit=${info.limit})`,
    "rest"
  );
});

client.rest.on("invalidRequestWarning", (info) => {
  noteDiscordInvalidWindow(info.remainingTime);
  const waitSec = Math.ceil(info.remainingTime / 1000);
  logger.warn(
    `Invalid requests: ${info.count} in the current window, ~${waitSec}s left. ` +
      "Stop issuing slash commands until this clears — retries make the block last longer.",
    "rest"
  );
});

/** Discord codes where the interaction token is gone — do not retry replies. */
const UNRECOVERABLE_INTERACTION_CODES = new Set([
  10062, // Unknown interaction
  40060, // Interaction has already been acknowledged
  50027, // Invalid Webhook Token
]);

function isUnrecoverableInteractionError(error) {
  return UNRECOVERABLE_INTERACTION_CODES.has(error?.code);
}

/** Rejects instead of hanging forever when Discord or MongoDB never answers. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Discord flags the IP after too many 4xx responses; further calls just dig deeper. */
let discordInvalidWindowEndsAt = 0;

function discordApiIsCoolingDown() {
  return Date.now() < discordInvalidWindowEndsAt;
}

function noteDiscordInvalidWindow(remainingMs) {
  const endsAt = Date.now() + remainingMs;
  if (endsAt > discordInvalidWindowEndsAt) {
    discordInvalidWindowEndsAt = endsAt;
  }
}

function isTimeoutError(error) {
  return /timed out after \d+ms/i.test(String(error?.message || error));
}

function describeDiscordError(error) {
  const parts = [
    error?.message || String(error),
    error?.code != null ? `code=${error.code}` : null,
    error?.status != null ? `status=${error.status}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

/** Answers the interaction; prefers reply (works) over webhook edit (was failing). */
async function respondToInteraction(interaction, payload) {
  try {
    await withTimeout(answer(interaction, payload), 6000, "respond");
  } catch (error) {
    if (isUnrecoverableInteractionError(error) || isTimeoutError(error) || discordApiIsCoolingDown()) {
      logger.warn(`Interaction response skipped: ${describeDiscordError(error)}`, "interactionCreate");
      return;
    }
    logger.warn(`Interaction response failed: ${describeDiscordError(error)}`, "interactionCreate");
  }
}

client.commands = new Collection();
client.commands.set(pingCommand.data.name, pingCommand);
client.commands.set(eventCommand.data.name, eventCommand);
client.commands.set(backupCommand.data.name, backupCommand);

/** Constant-time compare so the token cannot be guessed byte by byte. */
function isValidStatsToken(provided) {
  if (typeof provided !== "string") return false;

  const expected = Buffer.from(CONFIG.STATS_TOKEN);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const app = express();
app.get("/", (req, res) => res.send("✅ THC Support Bot is running!"));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.get("/stats", async (req, res) => {
  if (CONFIG.STATS_TOKEN && !isValidStatsToken(req.headers["x-stats-token"])) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const { total, active } = await countEvents();
    const dueEvents = await getDueEvents(new Date().toISOString());

    res.json({
      status: "ok",
      uptime: process.uptime(),
      total_events: total,
      active_events: active,
      due_events: dueEvents.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Stats endpoint error: ${error.message}`, "http");
    res.status(500).json({ error: "Internal server error" });
  }
});

client.once("clientReady", async () => {
  logger.info(`Bot ready! (${new Date().toISOString()})`);
  logger.info(`Instance ${INSTANCE_ID} — application ${client.application?.id}`, "startup");

  await client.application.commands.set(
    [...client.commands.values()].map((c) => c.data)
  );

  logger.info("Slash commands registered!");

  startScheduler(client);
  startBackupSchedule(CONFIG.BACKUP_INTERVAL_HOURS);

  try {
    const overdue = await getDueEvents(new Date().toISOString());
    if (overdue.length > 0) {
      logger.warn(`Found ${overdue.length} overdue events on startup`, "startup");
      logger.info("Overdue events will be processed by the scheduler", "startup");
    }
  } catch (error) {
    logger.error(`Could not check overdue events: ${error.message}`, "startup");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd?.autocomplete) return;
    try {
      await cmd.autocomplete(interaction);
    } catch (error) {
      logger.warn(`Autocomplete failed: ${error?.message || error}`, "interactionCreate");
    }
    return;
  }

  if (
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isChannelSelectMenu() ||
    interaction.isModalSubmit()
  ) {
    if (discordApiIsCoolingDown()) {
      try {
        if (interaction.isModalSubmit()) {
          await interaction.reply({
            content: "⏳ Discord is still rate-limiting requests. Please wait a moment.",
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: "⏳ Discord is still rate-limiting requests. Please wait a moment.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // ignore
      }
      return;
    }

    const eventCmd = client.commands.get("event");
    if (eventCmd?.handleComponent) {
      try {
        await eventCmd.handleComponent(interaction);
      } catch (error) {
        logger.error(`Component handler failed: ${error?.message || error}`, "interactionCreate");
        if (!interaction.replied && !interaction.deferred) {
          try {
            await interaction.reply({
              content: `❌ ${error?.message || "Action failed"}`,
              flags: MessageFlags.Ephemeral,
            });
          } catch {
            // ignore
          }
        }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // Age = time between Discord creating the interaction and us handling it.
  // Above ~3000ms the token is already dead on arrival (gateway delay), which
  // is a different problem from another instance acknowledging it first.
  const age = Date.now() - interaction.createdTimestamp;

  const sub = interaction.options.getSubcommand(false);
  const label = `/${interaction.commandName}${sub ? ` ${sub}` : ""}`;

  logger.info(
    `Received ${label} from ${interaction.user.tag} ` +
      `(instance=${INSTANCE_ID}, age=${age}ms, guild=${interaction.guildId ?? "DM"})`,
    "interactionCreate"
  );

  if (interaction.applicationId && interaction.client.application?.id
    && interaction.applicationId !== interaction.client.application.id) {
    logger.error(
      `Application ID mismatch! interaction=${interaction.applicationId} client=${interaction.client.application.id}`,
      "interactionCreate"
    );
  }

  if (discordApiIsCoolingDown()) {
    const waitSec = Math.ceil((discordInvalidWindowEndsAt - Date.now()) / 1000);
    logger.warn(
      `Skipping ${label}: Discord invalid-request cooldown (~${waitSec}s left)`,
      "interactionCreate"
    );
    try {
      await withTimeout(
        interaction.reply({
          content:
            `⏳ Discord is temporarily limiting this bot (~${waitSec}s). ` +
            "Do not use more commands until it clears — each attempt delays recovery.",
          flags: MessageFlags.Ephemeral,
        }),
        3000,
        "cooldown reply"
      );
    } catch {
      // Already blocked; nothing useful to do.
    }
    return;
  }

  if (isOnCooldown(interaction.user.id)) {
    const remaining = getRemainingCooldown(interaction.user.id);
    return respondToInteraction(interaction, {
      content: `⏳ Please wait ${remaining}s before using another command.`,
    });
  }

  addCooldown(interaction.user.id);

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) {
    return respondToInteraction(interaction, { content: "❌ Unknown command." });
  }

  const startedAt = Date.now();
  try {
    logger.info(`Executing ${label}`, "interactionCreate");
    await withTimeout(cmd.execute(interaction, { instanceId: INSTANCE_ID }), 20_000, label);
    logger.info(`Finished ${label} in ${Date.now() - startedAt}ms`, "interactionCreate");
  } catch (err) {
    if (isUnrecoverableInteractionError(err) || isTimeoutError(err) || discordApiIsCoolingDown()) {
      logger.warn(
        `Command ${label} aborted without retry: ${describeDiscordError(err)}`,
        "interactionCreate"
      );
      return;
    }
    logger.error(
      `Command ${label} error after ${Date.now() - startedAt}ms: ${describeDiscordError(err)}`,
      "interactionCreate"
    );
    await respondToInteraction(interaction, {
      content: `❌ Command failed: ${err?.message || "unknown error"}`,
    });
  }
});

client.on("error", (error) => logger.error(`Discord client error: ${error.message}`, "discord"));
process.on("unhandledRejection", (reason) => logger.error(`Unhandled rejection: ${reason}`, "process"));
process.on("uncaughtException", (error) => {
  logger.error(`Uncaught exception: ${error?.stack || error}`, "process");
  shutdown("uncaughtException", 1);
});

let httpServer;
let shuttingDown = false;

/**
 * Release the gateway session and database before the process dies.
 * Without this, a redeploy leaves the old instance connected with the same
 * token, and both instances race to answer the same interactions.
 */
async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Shutting down (${reason})…`, "shutdown");

  stopScheduler();
  stopBackupSchedule();

  const steps = [
    // Drop the gateway first so this process stops racing for interactions
    // while Mongo/HTTP are still closing (critical on Render redeploys).
    ["Discord client", async () => {
      try {
        client.user?.setStatus("invisible");
      } catch {
        // ignore
      }
      await client.destroy();
    }],
    ["HTTP server", async () => httpServer && new Promise((resolve) => httpServer.close(resolve))],
    ["MongoDB", closeDatabase],
  ];

  for (const [name, close] of steps) {
    try {
      await withTimeout(Promise.resolve(close()), 5000, `closing ${name}`);
      logger.info(`${name} closed`, "shutdown");
    } catch (error) {
      logger.warn(`Failed to close ${name}: ${error?.message || error}`, "shutdown");
    }
  }

  process.exit(exitCode);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown(signal));
}

async function main() {
  try {
    await connectDatabase();
    startDatabaseHeartbeat();
    httpServer = app.listen(PORT, "0.0.0.0", () =>
      logger.info(`Web server online on port ${PORT}`)
    );
    await client.login(TOKEN);
  } catch (error) {
    logger.error(`Startup failed: ${error.message}`, "startup");
    process.exit(1);
  }
}

main();
