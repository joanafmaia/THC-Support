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
    let nextLine = "Nenhum evento ativo";

    try {
      ({ active, total } = await countEvents());
      const next = await getNextEvent();
      if (next) {
        nextLine = `**#${next.id} ${next.name}** · ${relativeTime(next.next_run)}`;
      }
    } catch (error) {
      nextLine = `⚠️ Base de dados: ${error.message}`;
    }

    const roundTrip = Date.now() - started;
    const embed = new EmbedBuilder()
      .setTitle("🐻 THC Support")
      .setColor(CONFIG.EMBED_COLOR)
      .setDescription("Bot online e a responder.")
      .addFields(
        {
          name: "📡 Latência",
          value: `WS **${interaction.client.ws.ping}ms** · round-trip **${roundTrip}ms** · age **${age}ms**`,
          inline: false,
        },
        {
          name: "📅 Agenda",
          value: `**${active}** ativos · **${total}** no total`,
          inline: true,
        },
        {
          name: "⏭️ Próximo",
          value: nextLine,
          inline: false,
        }
      )
      .setFooter({ text: `instance ${instanceId ?? "?"} · uptime ${formatUptime(process.uptime())}` })
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
