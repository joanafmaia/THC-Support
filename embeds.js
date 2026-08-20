import { EmbedBuilder } from "discord.js";
import { CONFIG } from "./config.js";

export function formatUtc(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.toLocaleString("en-GB", { timeZone: "UTC" })} (UTC)`;
}

function formatRepeat(event) {
  return `${event.repeat_type}${event.repeat_value != null ? ` (${event.repeat_value})` : ""}`;
}

function truncate(text, maxLength) {
  const value = text == null ? "" : String(text);
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
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
        value: relativeTime(event.next_run),
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

export function createEventListEmbed(events, { title = "📅 Eventos ativos" } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(CONFIG.EMBED_COLOR)
    .setTimestamp();

  if (!events.length) {
    embed.setDescription("Nenhum evento neste filtro.");
    return embed;
  }

  const lines = events.map((event) => {
    const status = event.enabled ? "✅" : "⛔";
    const when = relativeTime(event.next_run);
    return `${status} **#${event.id} ${event.name}**\n📍 <#${event.channel_id}> · ⏰ ${when}\n🔁 ${formatRepeat(event)}`;
  });

  embed.setDescription(truncate(lines.join("\n\n"), 4000));
  embed.setFooter({ text: `${events.length} evento(s) · usa o menu abaixo para gerir` });
  return embed;
}

export function createHistoryEmbed(entries, { title = "📜 Histórico recente" } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(CONFIG.EMBED_COLOR)
    .setTimestamp();

  if (!entries.length) {
    embed.setDescription("Ainda não há registos.");
    return embed;
  }

  const actionLabel = {
    sent: "✅ Enviado",
    failed: "❌ Falhou",
    created: "🆕 Criado",
    deleted: "🗑️ Apagado",
    enabled: "▶️ Ativado",
    disabled: "⏸️ Desativado",
    run: "⚡ Corrido à mão",
  };

  const lines = entries.map((entry) => {
    const label = actionLabel[entry.action] ?? entry.action;
    const name = entry.event_name ? `#${entry.event_id} ${entry.event_name}` : `#${entry.event_id ?? "?"}`;
    const detail = entry.detail ? ` — ${truncate(entry.detail, 80)}` : "";
    return `**${label}** · ${name}\n${formatUtc(entry.at)}${detail}`;
  });

  embed.setDescription(truncate(lines.join("\n\n"), 4000));
  return embed;
}

/** Discord relative timestamp, e.g. "in 2 hours". */
export function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:R> (<t:${unix}:f>)`;
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
  relativeTime,
  createSuccessEmbed,
  createErrorEmbed,
  createEventEmbed,
  createEventListEmbed,
  createEventPreviewEmbed,
  createEventPreviewListEmbed,
  createHistoryEmbed,
  createInfoEmbed,
};
