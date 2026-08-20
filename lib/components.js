import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { formatRepeat } from "../embeds.js";

export const EVENT_SELECT_ID = "event:pick";
export const EVENT_BTN = {
  toggle: "event:toggle",
  run: "event:run",
  delete: "event:delete",
  history: "event:history",
  refresh: "event:refresh",
};

export const CREATE_UI = {
  confirm: "event:create:confirm",
  cancel: "event:create:cancel",
  editMessage: "event:create:editmsg",
  channel: "event:create:channel",
  repeat: "event:create:repeat",
  modal: "event:create:modal",
};

/** Discord allows at most 25 select options. */
export function buildEventSelectMenu(events, { placeholder = "Pick an event…" } = {}) {
  const options = events.slice(0, 25).map((event) => ({
    label: truncate(`#${event.id} ${event.name}`, 100),
    description: truncate(
      `${event.enabled ? "Active" : "Disabled"} · ${formatShort(event.next_run)}`,
      100
    ),
    value: String(event.id),
  }));

  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(EVENT_SELECT_ID)
      .setPlaceholder(placeholder)
      .addOptions(options)
  );
}

export function buildEventActionRows(eventId, { enabled = true } = {}) {
  const id = String(eventId);

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.toggle}:${id}`)
      .setLabel(enabled ? "Disable" : "Enable")
      .setEmoji(enabled ? "⏸️" : "▶️")
      .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.run}:${id}`)
      .setLabel("Run now")
      .setEmoji("⚡")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.history}:${id}`)
      .setLabel("History")
      .setEmoji("📜")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.delete}:${id}`)
      .setLabel("Delete")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger)
  );

  const extras = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.refresh}:${id}`)
      .setLabel("Refresh")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary)
  );

  return [actions, extras];
}

export function buildCreatePreviewComponents(draft) {
  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CREATE_UI.confirm)
      .setLabel("Confirm")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CREATE_UI.editMessage)
      .setLabel("Edit message")
      .setEmoji("✏️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CREATE_UI.cancel)
      .setLabel("Cancel")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );

  const channel = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CREATE_UI.channel)
      .setPlaceholder("Change destination channel…")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const repeat = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CREATE_UI.repeat)
      .setPlaceholder(`Repeat: ${formatRepeat(draft.repeat, draft.repeatValue)}`)
      .addOptions(
        { label: "Once", value: "once", default: draft.repeat === "once" },
        { label: "Daily", value: "daily", default: draft.repeat === "daily" },
        { label: "Every 2 days", value: "every2days", default: draft.repeat === "every2days" },
        {
          label: "Weekly",
          value: "weekly",
          description:
            draft.repeat === "weekly"
              ? formatRepeat("weekly", draft.repeatValue)
              : "Keeps the current repeat_value",
          default: draft.repeat === "weekly",
        },
        {
          label: "Monthly",
          value: "monthly",
          description:
            draft.repeat === "monthly"
              ? formatRepeat("monthly", draft.repeatValue)
              : "Keeps the current repeat_value",
          default: draft.repeat === "monthly",
        }
      )
  );

  return [actions, channel, repeat];
}

export function buildCreateMessageModal(currentMessage = "") {
  const input = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("Message to send in the channel")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setValue(truncate(currentMessage, 2000));

  return new ModalBuilder()
    .setCustomId(CREATE_UI.modal)
    .setTitle("Event message")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function truncate(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatShort(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "?";
  return date.toISOString().replace("T", " ").slice(0, 16);
}
