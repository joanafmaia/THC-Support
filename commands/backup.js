import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { backupDatabase, getLastBackupStatus } from "../backup.js";

export default {
  data: new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Manage database backups")
    .addSubcommand((sc) =>
      sc.setName("now").setDescription("Create a database backup now")
    )
    .addSubcommand((sc) =>
      sc.setName("status").setDescription("Show the latest backup status")
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === "now") {
      await backupDatabase();
      return interaction.editReply("✅ Backup triggered.");
    }

    if (sub === "status") {
      const status = getLastBackupStatus();
      if (!status.lastBackupAt) {
        return interaction.editReply("ℹ️ No backup has been created yet.");
      }
      const errorText = status.lastError ? `❌ Last error: ${status.lastError}` : "✅ Last backup completed successfully.";
      return interaction.editReply(
        `🗄️ Last backup: **${status.lastBackupAt}**\nPath: **${status.lastBackupPath ?? "unknown"}**\n${errorText}`
      );
    }

    return interaction.editReply("❌ Unknown subcommand.");
  },
};
