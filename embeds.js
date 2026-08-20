import { EmbedBuilder } from "discord.js";
import { CONFIG } from "./config.js";

const BRAND = "THC Support";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const COLORS = {
  brand: CONFIG.EMBED_COLOR,
  success: 0x00A651,
  danger: 0xED4245,
  warn: 0xFEE75C,
  muted: 0x95A5A6,
  info: CONFIG.EMBED_COLOR,
};

function brandEmbed(color = COLORS.brand) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: BRAND })
    .setTimestamp();
}

export function formatUtc(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.toLocaleString("en-GB", { timeZone: "UTC" })} (UTC)`;
}

export function formatRepeat(eventOrType, maybeValue) {
  const type =
    typeof eventOrType === "object" && eventOrType != null
      ? eventOrType.repeat_type ?? eventOrType.repeat
      : eventOrType;
  const value =
    typeof eventOrType === "object" && eventOrType != null
      ? eventOrType.repeat_value ?? eventOrType.repeatValue
      : maybeValue;

  switch (type) {
    case "once":
      return "Once";
    case "daily":
      return "Daily";
    case "every2days":
      return "Every 2 days";
    case "weekly":
      return value != null && WEEKDAYS[value]
        ? `Weekly · ${WEEKDAYS[value]}`
        : "Weekly";
    case "monthly":
      return value != null ? `Monthly · day ${value}` : "Monthly";
    default:
      return value != null ? `${type} (${value})` : String(type ?? "—");
  }
}

function truncate(text, maxLength) {
  const value = text == null ? "" : String(text);
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function createSuccessEmbed(title, description) {
  return brandEmbed(COLORS.success)
    .setTitle(title)
    .setDescription(description);
}

export function createErrorEmbed(title, description) {
  return brandEmbed(COLORS.danger)
    .setTitle(title)
    .setDescription(description);
}

export function createInfoEmbed(title, description) {
  return brandEmbed(COLORS.info)
    .setTitle(title)
    .setDescription(description);
}

export function createEventEmbed(event) {
  const enabled = Boolean(event.enabled);
  return brandEmbed(enabled ? COLORS.success : COLORS.muted)
    .setTitle(event.name)
    .setDescription(enabled ? "● Active" : "○ Disabled")
    .addFields(
      { name: "ID", value: `\`${event.id}\``, inline: true },
      { name: "Channel", value: `<#${event.channel_id}>`, inline: true },
      { name: "Repeat", value: formatRepeat(event), inline: true },
      { name: "Next run", value: relativeTime(event.next_run), inline: false },
      { name: "Message", value: truncate(event.message, 1024), inline: false }
    )
    .setFooter({ text: `Created ${formatUtc(event.created_at)}` });
}

export function createEventListEmbed(events, { title = "Active events" } = {}) {
  const embed = brandEmbed(COLORS.brand).setTitle(title);

  if (!events.length) {
    embed.setDescription("No events in this filter.");
    return embed;
  }

  const lines = events.map((event) => {
    const status = event.enabled ? "●" : "○";
    return (
      `${status} **#${event.id} ${event.name}**\n` +
      `<#${event.channel_id}> · ${relativeTime(event.next_run)}\n` +
      `\`${formatRepeat(event)}\``
    );
  });

  embed.setDescription(truncate(lines.join("\n\n"), 4000));
  embed.setFooter({
    text: `${events.length} event(s) · pick one below to manage`,
  });
  return embed;
}

export function createCreatePreviewEmbed(draft) {
  const offset =
    draft.timezoneOffset === 0
      ? "UTC"
      : `UTC${draft.timezoneOffset > 0 ? "+" : ""}${draft.timezoneOffset}`;

  const time = `${String(draft.hour).padStart(2, "0")}:${String(draft.minute).padStart(2, "0")}`;

  return brandEmbed(COLORS.warn)
    .setTitle(`Draft · ${draft.name}`)
    .setDescription(
      [
        "Confirm the details before saving this event.",
        "",
        "```",
        truncate(draft.message, 1800),
        "```",
      ].join("\n")
    )
    .addFields(
      { name: "Channel", value: `<#${draft.channelId}>`, inline: true },
      { name: "Repeat", value: formatRepeat(draft.repeat, draft.repeatValue), inline: true },
      { name: "Timezone", value: offset, inline: true },
      { name: "Requested time", value: `${time} (${offset})`, inline: true },
      { name: "First run", value: relativeTime(draft.nextRun), inline: false }
    )
    .setFooter({ text: "Change channel, repeat, or message below" });
}

export function createHistoryEmbed(entries, { title = "Recent history" } = {}) {
  const embed = brandEmbed(COLORS.brand).setTitle(title);

  if (!entries.length) {
    embed.setDescription("No history yet.");
    return embed;
  }

  const actionLabel = {
    sent: "Sent",
    failed: "Failed",
    created: "Created",
    deleted: "Deleted",
    enabled: "Enabled",
    disabled: "Disabled",
    run: "Ran manually",
  };

  const lines = entries.map((entry) => {
    const label = actionLabel[entry.action] ?? entry.action;
    const name = entry.event_name
      ? `#${entry.event_id} ${entry.event_name}`
      : `#${entry.event_id ?? "?"}`;
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
  return `<t:${unix}:R> · <t:${unix}:f>`;
}

export default {
  formatUtc,
  formatRepeat,
  relativeTime,
  createSuccessEmbed,
  createErrorEmbed,
  createEventEmbed,
  createEventListEmbed,
  createHistoryEmbed,
  createCreatePreviewEmbed,
  createInfoEmbed,
  COLORS,
};
