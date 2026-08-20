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
  rest: { timeout: 8_000, retries: 1, invalidRequestWarningInterval: 1 },
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
  logger.warn(
    `Invalid requests: ${info.count} in the current window, ${info.remainingTime}ms left. ` +
      "Too many of these get the IP temporarily blocked by Discord.",
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

function normalizePayload(payload) {
  if (payload == null || typeof payload === "string") {
    return { content: String(payload ?? "") };
  }
  const { flags: _flags, ...rest } = payload;
  return rest;
}

/**
 * Commands answer with editReply after the defer. When Discord rejects the edit
 * (an expired or already-consumed token), retry as a follow-up so the user is
 * never left staring at "thinking…".
 */
function installEditReplyFallback(interaction, label) {
  const editReply = interaction.editReply.bind(interaction);

  interaction.editReply = async (payload) => {
    const body = normalizePayload(payload);
    // Marks the boundary between "still gathering data" and "talking to
    // Discord", so a stall can be attributed to the right side.
    logger.info(`Sending response for ${label}`, "interactionCreate");
    try {
      return await withTimeout(editReply(body), 6000, `editReply for ${label}`);
    } catch (error) {
      logger.warn(
        `editReply failed (${error?.code ?? "?"}): ${error?.message || error}. Trying followUp…`,
        "interactionCreate"
      );
      return withTimeout(
        interaction.followUp({ ...body, flags: MessageFlags.Ephemeral }),
        6000,
        `followUp for ${label}`
      );
    }
  };
}

/** Answers the interaction whether or not it was already acknowledged. */
async function respondToInteraction(interaction, payload) {
  const body = normalizePayload(payload);

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
      return;
    }

    // editReply already falls back to followUp for deferred interactions.
    await interaction.editReply(body);
  } catch (error) {
    if (isUnrecoverableInteractionError(error)) {
      logger.warn(
        `Interaction response skipped (${error.code}): ${error.message}`,
        "interactionCreate"
      );
      return;
    }
    logger.warn(
      `Interaction response failed: ${error?.message || error} (code=${error?.code ?? "?"})`,
      "interactionCreate"
    );
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

  // Acknowledge quickly for commands that will use editReply.
  // /ping replies once itself — skip defer for that.
  if (interaction.commandName !== "ping") {
    try {
      await withTimeout(
        interaction.deferReply({ flags: MessageFlags.Ephemeral }),
        2500,
        "deferReply"
      );
      logger.debug(`Acknowledged ${label} after ${Date.now() - interaction.createdTimestamp}ms`, "interactionCreate");
    } catch (error) {
      if (isUnrecoverableInteractionError(error)) {
        logger.warn(
          `Could not acknowledge ${label} (${error.code}): ${error.message}. ` +
            `Interaction was ${Date.now() - interaction.createdTimestamp}ms old at failure ` +
            `(instance=${INSTANCE_ID}).`,
          "interactionCreate"
        );
        return;
      }
      logger.error(
        `Failed to defer ${label}: ${error?.message || error} (code=${error?.code ?? "?"})`,
        "interactionCreate"
      );
      return;
    }

    installEditReplyFallback(interaction, label);
  }

  const startedAt = Date.now();
  try {
    await withTimeout(cmd.execute(interaction, { instanceId: INSTANCE_ID }), 20_000, label);
    logger.info(`Finished ${label} in ${Date.now() - startedAt}ms`, "interactionCreate");
  } catch (err) {
    if (isUnrecoverableInteractionError(err)) {
      logger.warn(
        `Command ${label} aborted (${err.code}): ${err.message}`,
        "interactionCreate"
      );
      await respondToInteraction(interaction, {
        content: `❌ Command failed: ${err.message}`,
      });
      return;
    }
    logger.error(
      `Command ${label} error after ${Date.now() - startedAt}ms: ${err?.message || err}`,
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
    ["Discord client", async () => client.destroy()],
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
