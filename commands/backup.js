import { SlashCommandBuilder } from "discord.js";
import { backupDatabase, getBackupStatus } from "../backup.js";
import { createErrorEmbed, formatUtc } from "../embeds.js";
import { answer } from "../lib/respond.js";
import { memberCanUseBot, deniedBotAccessEmbed } from "../lib/permissions.js";

export default {
  data: new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Manage database backups")
    .setDefaultMemberPermissions(null)
    .setDMPermission(false)
    .addSubcommand((sc) =>
      sc.setName("now").setDescription("Create a database backup now")
    )
    .addSubcommand((sc) =>
      sc.setName("status").setDescription("Show the latest backup status")
    ),

  async execute(interaction) {
    if (!memberCanUseBot(interaction)) {
      const denied = deniedBotAccessEmbed();
      return answer(interaction, {
        embeds: [createErrorEmbed(denied.title, denied.description)],
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "now") {
      const { eventCount } = await backupDatabase();
      return answer(
        interaction,
        `✅ Backup created with **${eventCount}** event(s), stored in MongoDB.`
      );
    }

    if (sub === "status") {
      const status = await getBackupStatus();

      if (!status.latestStoredAt) {
        return answer(interaction, "ℹ️ No backup has been created yet.");
      }

      const lines = [
        `🗄️ Last backup: **${formatUtc(status.latestStoredAt)}**`,
        `📦 Events in it: **${status.latestEventCount}**`,
        `📚 Snapshots kept: **${status.storedBackups}**`,
        status.lastError
          ? `❌ Last error: ${status.lastError}`
          : "✅ Last backup completed successfully.",
      ];

      return answer(interaction, lines.join("\n"));
    }

    return answer(interaction, "❌ Unknown subcommand.");
  },
};
