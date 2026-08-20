import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { countEvents, getNextEvent } from "../data/events.js";
import { CONFIG } from "../config.js";
import { relativeTime } from "../embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Bot status, latency and next scheduled event"),

  async execute(interaction, { instanceId } = {}) {
    const started = Date.now();
    const age = Date.now() - interaction.createdTimestamp;

    let active = 0;
    let total = 0;
    let nextLine = "_No active events_";

    try {
      ({ active, total } = await countEvents());
      const next = await getNextEvent();
      if (next) {
        nextLine = `**#${next.id} ${next.name}**\n${relativeTime(next.next_run)}`;
      }
    } catch (error) {
      nextLine = `⚠️ Database: ${error.message}`;
    }

    const roundTrip = Date.now() - started;
    const avatar = interaction.client.user?.displayAvatarURL({ size: 128 });

    const embed = new EmbedBuilder()
      .setAuthor({
        name: "THC Support",
        iconURL: avatar,
      })
      .setTitle("Online")
      .setColor(CONFIG.EMBED_COLOR)
      .setThumbnail(avatar ?? null)
      .setDescription("Bot is online and responding.")
      .addFields(
        {
          name: "Latency",
          value: [
            `WebSocket **${interaction.client.ws.ping}ms**`,
            `Round-trip **${roundTrip}ms**`,
            `Interaction age **${age}ms**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Schedule",
          value: `**${active}** active\n**${total}** total`,
          inline: true,
        },
        {
          name: "Next up",
          value: nextLine,
          inline: false,
        }
      )
      .setFooter({
        text: `instance ${instanceId ?? "?"} · uptime ${formatUptime(process.uptime())}`,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
