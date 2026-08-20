import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot can respond (no database)"),

  async execute(interaction) {
    const started = Date.now();
    return interaction.editReply(
      `🏓 Pong! Latency: **${Date.now() - started}ms** | WS: **${interaction.client.ws.ping}ms**`
    );
  },
};
