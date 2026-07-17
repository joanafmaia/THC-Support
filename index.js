import express from "express";
import { Client, GatewayIntentBits, Collection, MessageFlags } from "discord.js";

import { logger } from "./logger.js";
import { CONFIG } from "./config.js";
import eventCommand from "./commands/event.js";
import backupCommand from "./commands/backup.js";
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

client.commands = new Collection();
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
