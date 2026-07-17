import { EmbedBuilder } from "discord.js";
import { CONFIG } from "./config.js";

export function formatUtc(dateString) {
  return `${new Date(dateString).toLocaleString("en-GB", { timeZone: "UTC" })} (UTC)`;
}

function formatRepeat(event) {
  return `${event.repeat_type}${event.repeat_value != null ? ` (${event.repeat_value})` : ""}`;
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function createSuccessEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(0x57F287)
    .setTimestamp();
}

export function createErrorEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xED4245)
    .setTimestamp();
}

export function createInfoEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setColor(CONFIG.EMBED_COLOR)
    .setTimestamp();
}

export function createEventEmbed(event) {
  return new EmbedBuilder()
    .setTitle(`📅 ${event.name}`)
    .addFields(
      {
        name: "🆔 ID",
        value: `\`${event.id}\``,
        inline: true,
      },
      {
        name: "📊 Status",
        value: event.enabled ? "✅ Enabled" : "⛔ Disabled",
        inline: true,
      },
      {
        name: "📍 Channel",
        value: `<#${event.channel_id}>`,
        inline: true,
      },
      {
        name: "⏰ Next run",
        value: formatUtc(event.next_run),
        inline: true,
      },
      {
        name: "🔁 Repeat",
        value: formatRepeat(event),
        inline: true,
      },
      {
        name: "🧾 Message",
        value: truncate(event.message, 1024),
        inline: false,
      }
    )
    .setColor(event.enabled ? 0x57F287 : CONFIG.EMBED_COLOR)
    .setFooter({ text: `Created at: ${formatUtc(event.created_at)}` });
}

export function createEventListEmbed(events) {
  const embed = new EmbedBuilder()
    .setTitle("📅 Scheduled events")
    .setColor(CONFIG.EMBED_COLOR)
    .setTimestamp();

  const lines = events.map((event) => {
    const status = event.enabled ? "✅" : "⛔";
    return `${status} **#${event.id} ${event.name}**\n📍 <#${event.channel_id}>\n⏰ ${formatUtc(event.next_run)}\n🔁 ${formatRepeat(event)}`;
  });

  const description = lines.join("\n\n");
  embed.setDescription(truncate(description, 4000));

  return embed;
}

export function createEventPreviewEmbed(event) {
  const embed = new EmbedBuilder()
    .setTitle(`🧾 Preview: #${event.id} ${event.name}`)
    .setColor(event.enabled ? 0x57F287 : 0xED4245)
    .addFields(
      {
        name: "📊 Status",
        value: event.enabled ? "✅ Enabled" : "⛔ Disabled",
        inline: true,
      },
      {
        name: "⏰ Next run",
        value: formatUtc(event.next_run),
        inline: true,
      }
    )
    .setDescription(truncate(event.message, 4000))
    .setTimestamp();

  return embed;
}

export function createEventPreviewListEmbed(events) {
  const embed = new EmbedBuilder()
    .setTitle("🧾 Event previews")
    .setColor(CONFIG.EMBED_COLOR)
    .setTimestamp();

  const lines = events.map((event) => {
    const status = event.enabled ? "✅" : "⛔";
    const header = `${status} **#${event.id} ${event.name}** — ${formatUtc(event.next_run)}`;
    const body = truncate(event.message.replace(/\s+/g, " ").trim(), 180);
    return `${header}\n${body}`;
  });

  embed.setDescription(truncate(lines.join("\n\n"), 4000));
  return embed;
}

export default {
  formatUtc,
  createSuccessEmbed,
  createErrorEmbed,
  createEventEmbed,
  createEventListEmbed,
  createEventPreviewEmbed,
  createEventPreviewListEmbed,
  createInfoEmbed,
};
