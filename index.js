import express from "express";
import { Client, GatewayIntentBits, Collection, MessageFlags } from "discord.js";

import { logger } from "./logger.js";
import { CONFIG } from "./config.js";
import eventCommand from "./commands/event.js";
import backupCommand from "./commands/backup.js";
import pingCommand from "./commands/ping.js";
import { startScheduler, getDueEvents } from "./scheduler.js";
import { startBackupSchedule } from "./backup.js";
import { isOnCooldown, addCooldown, getRemainingCooldown } from "./rateLimit.js";
import { connectDatabase } from "./data/database.js";
import { countEvents } from "./data/events.js";

const TOKEN = CONFIG.DISCORD_TOKEN;
const PORT = CONFIG.PORT;

if (!TOKEN) {
  logger.error("Error: DISCORD_TOKEN is missing in .env");
  process.exit(1);
}

if (!CONFIG.MONGODB_URI) {
  logger.error("Error: MONGODB_URI is missing in .env");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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

function normalizePayload(payload) {
  if (payload == null || typeof payload === "string") {
    return { content: String(payload ?? "") };
  }
  const { flags: _flags, ...rest } = payload;
  return rest;
}

/**
 * Send or update the interaction response.
 * If editReply fails (common with Invalid Webhook Token), fall back to followUp.
 */
async function respondToInteraction(interaction, payload, { ephemeral = true } = {}) {
  const body = normalizePayload(payload);
  const ephemeralFlag = ephemeral ? MessageFlags.Ephemeral : undefined;

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply({
        ...body,
        ...(ephemeralFlag != null ? { flags: ephemeralFlag } : {}),
      });
      return;
    }

    try {
      await interaction.editReply(body);
      return;
    } catch (editError) {
      logger.warn(
        `editReply failed (${editError?.code ?? "?"}): ${editError?.message || editError}. Trying followUp…`,
        "interactionCreate"
      );
      await interaction.followUp({
        ...body,
        ...(ephemeralFlag != null ? { flags: ephemeralFlag } : {}),
      });
    }
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

const app = express();
app.get("/", (req, res) => res.send("✅ EOS Support Bot is running!"));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.get("/stats", async (req, res) => {
  if (CONFIG.STATS_TOKEN) {
    const provided = req.headers["x-stats-token"];
    if (provided !== CONFIG.STATS_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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

client.once("ready", async () => {
  logger.info(`Bot ready! (${new Date().toISOString()})`);
  logger.info(`Application ID: ${client.application?.id}`, "startup");

  await client.application.commands.set(
    [...client.commands.values()].map((c) => c.data)
  );

  logger.info("Slash commands registered!");

  startScheduler(client);
  startBackupSchedule(CONFIG.BACKUP_INTERVAL_HOURS);

  const overdue = await getDueEvents(new Date().toISOString());
  if (overdue.length > 0) {
    logger.warn(`Found ${overdue.length} overdue events on startup`, "startup");
    logger.info("Overdue events will be processed by the scheduler", "startup");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  logger.info(
    `Received /${interaction.commandName} from ${interaction.user.tag} ` +
      `(interactionApp=${interaction.applicationId}, clientApp=${interaction.client.application?.id}, guild=${interaction.guildId ?? "DM"})`,
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      if (isUnrecoverableInteractionError(error)) {
        logger.warn(
          `Could not acknowledge /${interaction.commandName} (${error.code}): ${error.message}. ` +
            "Usually means another bot instance already responded, or the interaction expired.",
          "interactionCreate"
        );
        return;
      }
      logger.error(
        `Failed to defer /${interaction.commandName}: ${error?.message || error} (code=${error?.code ?? "?"})`,
        "interactionCreate"
      );
      return;
    }

    // If editReply is broken (Invalid Webhook Token), fall back to followUp automatically.
    const originalEditReply = interaction.editReply.bind(interaction);
    interaction.editReply = async (payload) => {
      try {
        return await originalEditReply(normalizePayload(payload));
      } catch (editError) {
        logger.warn(
          `editReply failed (${editError?.code ?? "?"}): ${editError?.message || editError}. Trying followUp…`,
          "interactionCreate"
        );
        return interaction.followUp({
          ...normalizePayload(payload),
          flags: MessageFlags.Ephemeral,
        });
      }
    };
  }

  try {
    await cmd.execute(interaction);
    logger.info(`Finished /${interaction.commandName}`, "interactionCreate");
  } catch (err) {
    if (isUnrecoverableInteractionError(err)) {
      logger.warn(
        `Command /${interaction.commandName} aborted (${err.code}): ${err.message}`,
        "interactionCreate"
      );
      await respondToInteraction(interaction, {
        content: `❌ Command failed: ${err.message}`,
      });
      return;
    }
    logger.error(
      `Command /${interaction.commandName} error: ${err?.message || err}`,
      "interactionCreate"
    );
    await respondToInteraction(interaction, {
      content: `❌ Command failed: ${err?.message || "unknown error"}`,
    });
  }
});

client.on("error", (error) => logger.error(`Discord client error: ${error.message}`, "discord"));
process.on("unhandledRejection", (reason) => logger.error(`Unhandled rejection: ${reason}`, "process"));

async function main() {
  try {
    await connectDatabase();
    app.listen(PORT, "0.0.0.0", () => logger.info(`Web server online on port ${PORT}`));
    await client.login(TOKEN);
  } catch (error) {
    logger.error(`Startup failed: ${error.message}`, "startup");
    process.exit(1);
  }
}

main();
