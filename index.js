import express from "express";
import { Client, GatewayIntentBits, Collection, MessageFlags } from "discord.js";

import { logger } from "./logger.js";
import { CONFIG } from "./config.js";
import eventCommand from "./commands/event.js";
import backupCommand from "./commands/backup.js";
import { startScheduler, getDueEvents } from "./scheduler.js";
import { startBackupSchedule } from "./backup.js";
import { isOnCooldown, addCooldown, getRemainingCooldown } from "./rateLimit.js";
import db from "./data/database.js";

const TOKEN = CONFIG.DISCORD_TOKEN;
const PORT = CONFIG.PORT;

if (!TOKEN) {
  logger.error("Error: DISCORD_TOKEN is missing in .env");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

async function respondToInteraction(interaction, payload) {
  try {
    if (interaction.deferred) {
      await interaction.editReply(payload);
      return;
    }
    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  } catch (error) {
    logger.warn(`Interaction response failed: ${error?.message || error}`, "interactionCreate");
  }
}

// Command registry
client.commands = new Collection();
client.commands.set(eventCommand.data.name, eventCommand);
client.commands.set(backupCommand.data.name, backupCommand);

// Health server
const app = express();
app.get("/", (req, res) => res.send("✅ EOS Support Bot is running!"));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// Stats endpoint
app.get("/stats", (req, res) => {
  if (CONFIG.STATS_TOKEN) {
    const provided = req.headers["x-stats-token"];
    if (provided !== CONFIG.STATS_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  try {
    const totalCount = db.prepare("SELECT COUNT(*) as count FROM events").get();
    const activeCount = db.prepare("SELECT COUNT(*) as count FROM events WHERE enabled = 1").get();
    const dueCount = getDueEvents(new Date().toISOString()).length;

    res.json({
      status: "ok",
      uptime: process.uptime(),
      total_events: totalCount.count,
      active_events: activeCount.count,
      due_events: dueCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Stats endpoint error: ${error.message}`, "http");
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, "0.0.0.0", () => logger.info(`Web server online on port ${PORT}`));

// Ready
client.once("ready", async () => {
  logger.info(`Bot ready! (${new Date().toISOString()})`);

  // Register commands globally
  await client.application.commands.set(
    [...client.commands.values()].map((c) => c.data)
  );

  logger.info("Slash commands registered!");

  // Start DB-driven scheduler
  startScheduler(client);

  // Start backup schedule
  startBackupSchedule(CONFIG.BACKUP_INTERVAL_HOURS);

  // Check for overdue events
  const overdue = getDueEvents(new Date().toISOString());
  if (overdue.length > 0) {
    logger.warn(`Found ${overdue.length} overdue events on startup`, "startup");
    logger.info("Overdue events will be processed by the scheduler", "startup");
  }
});

// Interaction router
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Rate limit check
  if (isOnCooldown(interaction.user.id)) {
    const remaining = getRemainingCooldown(interaction.user.id);
    return respondToInteraction(interaction, {
      content: `⏳ Please wait ${remaining}s before using another command.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  addCooldown(interaction.user.id);

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction);
  } catch (err) {
    logger.error(`Command execution error: ${err?.message || err}`, "interactionCreate");
    await respondToInteraction(interaction, { content: "❌ Command failed.", flags: MessageFlags.Ephemeral });
  }
});

// Errors
client.on("error", (error) => logger.error(`Discord client error: ${error.message}`, "discord"));
process.on("unhandledRejection", (reason) => logger.error(`Unhandled rejection: ${reason}`, "process"));

// Login
client.login(TOKEN).catch((error) => {
  logger.error(`Login failed: ${error.message}`, "login");
  process.exit(1);
});
