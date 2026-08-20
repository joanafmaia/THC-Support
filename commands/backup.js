import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { backupDatabase, getBackupStatus } from "../backup.js";
import { formatUtc } from "../embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Manage database backups")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sc) =>
      sc.setName("now").setDescription("Create a database backup now")
    )
    .addSubcommand((sc) =>
      sc.setName("status").setDescription("Show the latest backup status")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    // Reply is deferred in index.js (must stay within Discord's 3s window).

    if (sub === "now") {
      const { eventCount } = await backupDatabase();
      return interaction.editReply(
        `✅ Backup created with **${eventCount}** event(s), stored in MongoDB.`
      );
    }

    if (sub === "status") {
      const status = await getBackupStatus();

      if (!status.latestStoredAt) {
        return interaction.editReply("ℹ️ No backup has been created yet.");
      }

      const lines = [
        `🗄️ Last backup: **${formatUtc(status.latestStoredAt)}**`,
        `📦 Events in it: **${status.latestEventCount}**`,
        `📚 Snapshots kept: **${status.storedBackups}**`,
        status.lastError
          ? `❌ Last error: ${status.lastError}`
          : "✅ Last backup completed successfully.",
      ];

      return interaction.editReply(lines.join("\n"));
    }

    return interaction.editReply("❌ Unknown subcommand.");
  },
};
