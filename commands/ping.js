import { SlashCommandBuilder, MessageFlags } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot can respond (no database)"),

  async execute(interaction, { instanceId } = {}) {
    const age = Date.now() - interaction.createdTimestamp;
    // Single reply — no editReply (edit path was leaving messages stuck on "A processar…").
    await interaction.reply({
      content:
        `🏓 Pong! WS: **${interaction.client.ws.ping}ms** | ` +
        `interaction age: **${age}ms** | instance: \`${instanceId ?? "?"}\``,
      flags: MessageFlags.Ephemeral,
    });
  },
};
