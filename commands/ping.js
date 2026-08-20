import { SlashCommandBuilder, MessageFlags } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot can respond (no database)"),

  async execute(interaction) {
    const started = Date.now();
    // Single reply — no editReply (edit path was leaving messages stuck on "A processar…").
    await interaction.reply({
      content: `🏓 Pong! Latency: **${Date.now() - started}ms** | WS: **${interaction.client.ws.ping}ms**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
