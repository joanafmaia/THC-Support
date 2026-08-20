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
  editDetails: "event:create:details",
  channel: "event:create:channel",
  repeat: "event:create:repeat",
  weekday: "event:create:weekday",
  /** Full setup / edit modal (label, message, time, timezone). */
  modal: "event:create:modal",
  monthBtn: "event:create:monthbtn",
  /** Month-day modal when repeat is monthly. */
  monthModal: "event:create:monthmodal",
};

const WEEKDAYS = [
  { label: "Sunday", value: "0" },
  { label: "Monday", value: "1" },
  { label: "Tuesday", value: "2" },
  { label: "Wednesday", value: "3" },
  { label: "Thursday", value: "4" },
  { label: "Friday", value: "5" },
  { label: "Saturday", value: "6" },
];

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
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CREATE_UI.confirm)
        .setLabel("Confirm")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(CREATE_UI.editDetails)
        .setLabel("Edit details")
        .setEmoji("✏️")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(CREATE_UI.cancel)
        .setLabel("Cancel")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(CREATE_UI.channel)
        .setPlaceholder("Channel to post in…")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(CREATE_UI.repeat)
        .setPlaceholder(`Repeat: ${formatRepeat(draft.repeat, draft.repeatValue)}`)
        .addOptions(
          {
            label: "Daily",
            value: "daily",
            description: "Every day at this UTC time",
            default: draft.repeat === "daily",
          },
          {
            label: "Every 2 days",
            value: "every2days",
            description: "Every other day at this UTC time",
            default: draft.repeat === "every2days",
          },
          {
            label: "Once",
            value: "once",
            description: "Run one time only",
            default: draft.repeat === "once",
          },
          {
            label: "Weekly",
            value: "weekly",
            description: "Same weekday each week",
            default: draft.repeat === "weekly",
          },
          {
            label: "Monthly",
            value: "monthly",
            description: "Same day each month",
            default: draft.repeat === "monthly",
          }
        )
    ),
  ];

  if (draft.repeat === "weekly") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(CREATE_UI.weekday)
          .setPlaceholder(`Weekday: ${formatRepeat("weekly", draft.repeatValue)}`)
          .addOptions(
            WEEKDAYS.map((day) => ({
              ...day,
              default: String(draft.repeatValue) === day.value,
            }))
          )
      )
    );
  }

  if (draft.repeat === "monthly") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(CREATE_UI.monthBtn)
          .setLabel(`Month day: ${draft.repeatValue ?? "?"}`)
          .setEmoji("📅")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return rows;
}

/**
 * Modal for creating / editing draft details.
 * Time is always game time (UTC).
 */
export function buildCreateSetupModal(draft = {}) {
  const time =
    draft.hour != null && draft.minute != null
      ? `${String(draft.hour).padStart(2, "0")}:${String(draft.minute).padStart(2, "0")}`
      : "20:00";

  const label = new TextInputBuilder()
    .setCustomId("label")
    .setLabel("Label (list only — not posted)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setPlaceholder("e.g. Daily reset reminder");
  if (draft.name) label.setValue(truncate(draft.name, 100));

  const message = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("Message posted in the channel")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000)
    .setPlaceholder("Exact text the bot will send…");
  if (draft.message) message.setValue(truncate(draft.message, 2000));

  const timeInput = new TextInputBuilder()
    .setCustomId("time")
    .setLabel("Game time UTC (HH:MM)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(5)
    .setPlaceholder("20:30")
    .setValue(time);

  const startInput = new TextInputBuilder()
    .setCustomId("start_date")
    .setLabel("First date UTC (YYYY-MM-DD, or blank)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(10)
    .setPlaceholder("blank = next · e.g. 2026-08-25");
  if (draft.startDateInput) startInput.setValue(truncate(draft.startDateInput, 10));

  return new ModalBuilder()
    .setCustomId(CREATE_UI.modal)
    .setTitle(draft.name ? "Edit event details" : "Create event")
    .addComponents(
      new ActionRowBuilder().addComponents(label),
      new ActionRowBuilder().addComponents(message),
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(startInput)
    );
}

export function buildMonthDayModal(currentDay = 1) {
  const input = new TextInputBuilder()
    .setCustomId("monthday")
    .setLabel("Day of month (1-31)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2)
    .setPlaceholder("1")
    .setValue(String(currentDay));

  return new ModalBuilder()
    .setCustomId(CREATE_UI.monthModal)
    .setTitle("Monthly day")
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
