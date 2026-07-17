import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import {
  getEventById,
  updateEventById,
  listEvents,
  listEventsForPreview,
  getEventForPreview,
  setEventEnabled,
} from "../data/events.js";
import { logger } from "../logger.js";
import {
  createErrorEmbed,
  createEventEmbed,
  createEventListEmbed,
  createEventPreviewEmbed,
  createEventPreviewListEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatUtc,
} from "../embeds.js";
import {
  addEvent,
  deleteEvent,
  getNextEvent,
  getDueEvents,
} from "../scheduler.js";

function isValidRepeat(type) {
  return ["once", "daily", "every2days", "weekly", "monthly"].includes(type);
}

function computeInitialNextRunUTC({ hour, minute, repeatType, repeatValue }) {
  const now = new Date();

  let next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour,
      minute,
      0,
      0
    )
  );

  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  if (repeatType === "weekly") {
    const targetDow = Number(repeatValue);
    const currentDow = next.getUTCDay();
    let addDays = (targetDow - currentDow + 7) % 7;
    if (addDays === 0) addDays = 7;
    next.setUTCDate(next.getUTCDate() + addDays);
  }

  if (repeatType === "monthly") {
    const targetDom = Number(repeatValue);
    const y = next.getUTCFullYear();
    const m = next.getUTCMonth();
    const lastDayThisMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let candidate = new Date(
      Date.UTC(y, m, Math.min(targetDom, lastDayThisMonth), hour, minute, 0, 0)
    );

    if (candidate <= now) {
      const nextMonth = new Date(Date.UTC(y, m + 1, 1));
      const lastDayNextMonth = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
      candidate = new Date(
        Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), Math.min(targetDom, lastDayNextMonth), hour, minute, 0, 0)
      );
    }
    next = candidate;
  }

  return next.toISOString();
}

function applyTimezoneOffset(hour, minute, offsetHours) {
  const totalMinutes = hour * 60 + minute - offsetHours * 60;
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return {
    hour: Math.floor(normalized / 60),
    minute: normalized % 60,
  };
}

async function sendToChannel(client, channelId, content) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found`);
  await channel.send(content);
}

export default {
  data: new SlashCommandBuilder()
    .setName("event")
    .setDescription("Create and manage scheduled events (UTC)")

    .addSubcommand((sc) =>
      sc
        .setName("create")
        .setDescription("Create a new scheduled event")
        .addStringOption((o) =>
          o.setName("name").setDescription("Event name").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("message").setDescription("Message to send").setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("hour")
            .setDescription("Game UTC hour (0-23)")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((o) =>
          o
            .setName("minute")
            .setDescription("Game UTC minute (0-59)")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(59)
        )
        .addStringOption((o) =>
          o
            .setName("repeat")
            .setDescription("Repeat type")
            .setRequired(true)
            .addChoices(
              { name: "Once", value: "once" },
              { name: "Daily", value: "daily" },
              { name: "Every 2 days", value: "every2days" },
              { name: "Weekly", value: "weekly" },
              { name: "Monthly", value: "monthly" }
            )
        )
        .addIntegerOption((o) =>
          o
            .setName("repeat_value")
            .setDescription("Weekly: 0-6 (Sun-Sat). Monthly: 1-31.")
            .setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName("timezone_offset")
            .setDescription("Local offset from UTC (e.g., -3 for Brazil, 0 for Portugal).")
            .setRequired(false)
            .setMinValue(-12)
            .setMaxValue(14)
        )
        .addStringOption((o) =>
          o
            .setName("channel_id")
            .setDescription("Target channel ID (optional). Defaults to current channel.")
            .setRequired(false)
        )
    )

    .addSubcommand((sc) =>
      sc
        .setName("edit")
        .setDescription("Edit an existing event")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Event ID").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("name").setDescription("Event name").setRequired(false)
        )
        .addStringOption((o) =>
          o.setName("message").setDescription("Message to send").setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName("hour")
            .setDescription("UTC hour (0-23)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((o) =>
          o
            .setName("minute")
            .setDescription("UTC minute (0-59)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(59)
        )
        .addIntegerOption((o) =>
          o
            .setName("timezone_offset")
            .setDescription("Local offset from UTC (e.g., -3 for Brazil, 0 for Portugal).")
            .setRequired(false)
            .setMinValue(-12)
            .setMaxValue(14)
        )
        .addStringOption((o) =>
          o
            .setName("repeat")
            .setDescription("Repeat type")
            .setRequired(false)
            .addChoices(
              { name: "Once", value: "once" },
              { name: "Daily", value: "daily" },
              { name: "Every 2 days", value: "every2days" },
              { name: "Weekly", value: "weekly" },
              { name: "Monthly", value: "monthly" }
            )
        )
        .addIntegerOption((o) =>
          o
            .setName("repeat_value")
            .setDescription("Weekly: 0-6 (Sun-Sat). Monthly: 1-31.")
            .setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("channel_id")
            .setDescription("Target channel ID (optional).")
            .setRequired(false)
        )
    )

    .addSubcommand((sc) =>
      sc.setName("next").setDescription("Show the next scheduled event")
    )

    .addSubcommand((sc) =>
      sc.setName("list").setDescription("List all scheduled events")
    )

    .addSubcommand((sc) =>
      sc
        .setName("preview")
        .setDescription("Preview the message for scheduled events")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Event ID to preview").setRequired(false)
        )
        .addBooleanOption((o) =>
          o
            .setName("all")
            .setDescription("Preview all scheduled event messages")
            .setRequired(false)
        )
    )

    .addSubcommand((sc) =>
      sc.setName("help").setDescription("Show usage examples for event commands")
    )

    .addSubcommand((sc) =>
      sc.setName("due").setDescription("Debug: list events that are due now")
    )

    .addSubcommand((sc) =>
      sc
        .setName("enable")
        .setDescription("Enable an event")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Event ID").setRequired(true)
        )
    )

    .addSubcommand((sc) =>
      sc
        .setName("disable")
        .setDescription("Disable an event")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Event ID").setRequired(true)
        )
    )

    .addSubcommand((sc) =>
      sc
        .setName("run")
        .setDescription("Run an event now")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Event ID").setRequired(true)
        )
    )

    .addSubcommand((sc) =>
      sc
        .setName("delete")
        .setDescription("Delete an event")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("Event ID").setRequired(true)
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const client = interaction.client;

    if (sub === "create") {
      const name = interaction.options.getString("name", true);
      const message = interaction.options.getString("message", true);
      const hour = interaction.options.getInteger("hour", true);
      const minute = interaction.options.getInteger("minute", true);
      const timezoneOffset = interaction.options.getInteger("timezone_offset", false) ?? 0;
      const repeat = interaction.options.getString("repeat", true);
      const repeatValue = interaction.options.getInteger("repeat_value", false);
      const channelId = interaction.options.getString("channel_id", false) || interaction.channelId;

      // Validate message length
      if (message.length > 2000) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Message too long", "Maximum length is 2000 characters.")],
        });
      }

      // Validate channel exists
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          logger.warn(`Invalid channel ID: ${channelId}`, "event-command");
          return interaction.editReply({
            embeds: [createErrorEmbed("Channel not found", "Please provide a valid text channel ID.")],
          });
        }
        const botPermissions = channel.permissionsFor(interaction.guild?.members.me);
        if (botPermissions) {
          if (!botPermissions.has(PermissionFlagsBits.ViewChannel)) {
            return interaction.editReply({
              embeds: [createErrorEmbed("Missing permission", "I can't view that channel.")],
            });
          }
          if (!botPermissions.has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({
              embeds: [createErrorEmbed("Missing permission", "I can't send messages in that channel.")],
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch channel ${channelId}: ${error.message}`, "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Invalid channel", "Channel lookup failed. Check the channel ID.")],
        });
      }

      if (!isValidRepeat(repeat)) {
        logger.warn(`Invalid repeat type: ${repeat}`, "event-command");
        return interaction.editReply({
          embeds: [
            createErrorEmbed(
              "Invalid repeat type",
              "Use one of: once, daily, every2days, weekly, monthly."
            ),
          ],
        });
      }

      if ((repeat === "weekly" || repeat === "monthly") && repeatValue == null) {
        return interaction.editReply({
          embeds: [
            createErrorEmbed(
              "Missing repeat value",
              "repeat_value is required for weekly (0-6) and monthly (1-31)."
            ),
          ],
        });
      }

      if (repeat === "weekly" && (repeatValue < 0 || repeatValue > 6)) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Invalid weekly value", "repeat_value must be 0-6 (Sun-Sat).")],
        });
      }
      if (repeat === "monthly" && (repeatValue < 1 || repeatValue > 31)) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Invalid monthly value", "repeat_value must be 1-31.")],
        });
      }

      const utcTime = applyTimezoneOffset(hour, minute, timezoneOffset);
      const nextRun = computeInitialNextRunUTC({
        hour: utcTime.hour,
        minute: utcTime.minute,
        repeatType: repeat,
        repeatValue: repeatValue ?? null,
      });

      const id = await addEvent(
        name,
        channelId,
        message,
        nextRun,
        repeat,
        repeatValue ?? null
      );

      if (!id) {
        logger.error("Failed to create event", "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Create failed", "Failed to create the scheduled event.")],
        });
      }

      logger.info(`Event created: ${name} (ID: ${id})`, "event-command");
      return interaction.editReply({
        embeds: [
          createSuccessEmbed(
            "Event created",
            `**ID:** #${id}\n**Name:** ${name}\n**Channel:** <#${channelId}>\n**Next run:** ${formatUtc(
              nextRun
            )}\n**Repeat:** ${repeat}${repeatValue != null ? ` (${repeatValue})` : ""}`
          ),
        ],
      });
    }

    if (sub === "edit") {
      const id = interaction.options.getInteger("id", true);
      const existing = await getEventById(id);
      if (!existing) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }

      const name = interaction.options.getString("name", false) ?? existing.name;
      const message = interaction.options.getString("message", false) ?? existing.message;
      const hourOption = interaction.options.getInteger("hour", false);
      const minuteOption = interaction.options.getInteger("minute", false);
      const timezoneOffset = interaction.options.getInteger("timezone_offset", false);
      const repeatOption = interaction.options.getString("repeat", false);
      const repeat = repeatOption ?? existing.repeat_type;
      const repeatValueOption = interaction.options.getInteger("repeat_value", false);
      const repeatValue = repeatValueOption ?? existing.repeat_value;
      const channelId = interaction.options.getString("channel_id", false) ?? existing.channel_id;

      if ((hourOption != null || minuteOption != null) && (hourOption == null || minuteOption == null)) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Invalid time update", "Provide both hour and minute.")],
        });
      }

      if (timezoneOffset != null && hourOption == null && minuteOption == null) {
        return interaction.editReply({
          embeds: [
            createErrorEmbed(
              "Invalid timezone offset",
              "timezone_offset only applies when updating hour/minute."
            ),
          ],
        });
      }

      if (message.length > 2000) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Message too long", "Maximum length is 2000 characters.")],
        });
      }

      if (!isValidRepeat(repeat)) {
        return interaction.editReply({
          embeds: [
            createErrorEmbed(
              "Invalid repeat type",
              "Use one of: once, daily, every2days, weekly, monthly."
            ),
          ],
        });
      }

      const shouldRecalculate =
        hourOption != null ||
        minuteOption != null ||
        repeatOption != null ||
        repeatValueOption != null;

      if (shouldRecalculate) {
        if ((repeat === "weekly" || repeat === "monthly") && repeatValue == null) {
          return interaction.editReply({
            embeds: [
              createErrorEmbed(
                "Missing repeat value",
                "repeat_value is required for weekly (0-6) and monthly (1-31)."
              ),
            ],
          });
        }

        if (repeat === "weekly" && (repeatValue < 0 || repeatValue > 6)) {
          return interaction.editReply({
            embeds: [createErrorEmbed("Invalid weekly value", "repeat_value must be 0-6 (Sun-Sat).")],
          });
        }
        if (repeat === "monthly" && (repeatValue < 1 || repeatValue > 31)) {
          return interaction.editReply({
            embeds: [createErrorEmbed("Invalid monthly value", "repeat_value must be 1-31.")],
          });
        }
      }

      // Validate channel exists
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          logger.warn(`Invalid channel ID: ${channelId}`, "event-command");
          return interaction.editReply({
            embeds: [createErrorEmbed("Channel not found", "Please provide a valid text channel ID.")],
          });
        }
        const botPermissions = channel.permissionsFor(interaction.guild?.members.me);
        if (botPermissions) {
          if (!botPermissions.has(PermissionFlagsBits.ViewChannel)) {
            return interaction.editReply({
              embeds: [createErrorEmbed("Missing permission", "I can't view that channel.")],
            });
          }
          if (!botPermissions.has(PermissionFlagsBits.SendMessages)) {
            return interaction.editReply({
              embeds: [createErrorEmbed("Missing permission", "I can't send messages in that channel.")],
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch channel ${channelId}: ${error.message}`, "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Invalid channel", "Channel lookup failed. Check the channel ID.")],
        });
      }

      const nextRun = (() => {
        if (!shouldRecalculate) {
          return existing.next_run;
        }
        const baseTime = new Date(existing.next_run);
        const baseHour = baseTime.getUTCHours();
        const baseMinute = baseTime.getUTCMinutes();
        const hour = hourOption ?? baseHour;
        const minute = minuteOption ?? baseMinute;
        const offset = timezoneOffset ?? 0;
        const utcTime = applyTimezoneOffset(hour, minute, offset);

        return computeInitialNextRunUTC({
          hour: utcTime.hour,
          minute: utcTime.minute,
          repeatType: repeat,
          repeatValue: repeatValue ?? null,
        });
      })();

      await updateEventById(id, {
        name,
        channel_id: channelId,
        message,
        next_run: nextRun,
        repeat_type: repeat,
        repeat_value: repeatValue ?? null,
      });

      logger.info(`Event updated: ${name} (ID: ${id})`, "event-command");
      const refreshed = await getEventById(id);
      return interaction.editReply({
        embeds: [
          createSuccessEmbed(
            "Event updated",
            `Event #${id} has been updated successfully.`
          ),
          createEventEmbed(refreshed),
        ],
      });
    }

    if (sub === "next") {
      const next = await getNextEvent();
      if (!next) {
        return interaction.editReply({
          embeds: [createInfoEmbed("No scheduled events", "There are no upcoming events.")],
        });
      }
      return interaction.editReply({ embeds: [createEventEmbed(next)] });
    }

    if (sub === "list") {
      const rows = await listEvents();

      if (!rows.length) {
        return interaction.editReply({
          embeds: [createInfoEmbed("No events found", "No scheduled events exist yet.")],
        });
      }

      return interaction.editReply({ embeds: [createEventListEmbed(rows)] });
    }

    if (sub === "preview") {
      const id = interaction.options.getInteger("id", false);
      const all = interaction.options.getBoolean("all", false) ?? false;

      if (all && id != null) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Invalid usage", "Use either all:true or id:<eventId>, not both.")],
        });
      }

      if (!all && id == null) {
        return interaction.editReply({
          embeds: [
            createErrorEmbed(
              "Missing option",
              "Use /event preview all:true or provide an event id."
            ),
          ],
        });
      }

      if (all) {
        const rows = await listEventsForPreview();

        if (!rows.length) {
          return interaction.editReply({
            embeds: [createInfoEmbed("No events found", "No scheduled events exist yet.")],
          });
        }

        return interaction.editReply({ embeds: [createEventPreviewListEmbed(rows)] });
      }

      const event = await getEventForPreview(id);

      if (!event) {
        return interaction.editReply({
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }

      return interaction.editReply({ embeds: [createEventPreviewEmbed(event)] });
    }

    if (sub === "help") {
      const helpText = [
        "**Create**",
        "`/event create name:<name> message:<text> hour:<0-23> minute:<0-59> repeat:<once|daily|every2days|weekly|monthly> [repeat_value] [timezone_offset] [channel_id]`",
        "",
        "**Examples**",
        "`/event create name:Reset message:\"Daily reset\" hour:0 minute:0 repeat:daily`",
        "`/event create name:Boss message:\"World boss\" hour:20 minute:30 repeat:weekly repeat_value:6 timezone_offset:-3`",
        "`/event create name:Payroll message:\"Monthly payroll\" hour:12 minute:0 repeat:monthly repeat_value:1`",
        "",
        "**Manage**",
        "`/event edit id:<id> [name] [message] [hour] [minute] [repeat] [repeat_value] [timezone_offset] [channel_id]`",
        "`/event enable id:<id>` / `/event disable id:<id>` / `/event delete id:<id>`",
        "",
        "**Inspect**",
        "`/event list` / `/event next` / `/event due`",
        "`/event preview id:<id>` / `/event preview all:true`",
        "",
        "**Repeat values**",
        "`weekly repeat_value`: 0-6 (Sun-Sat)",
        "`monthly repeat_value`: 1-31",
      ].join("\n");

      return interaction.editReply({
        embeds: [createInfoEmbed("Event command help", helpText)],
      });
    }

    if (sub === "due") {
      const due = await getDueEvents(new Date().toISOString());
      if (!due.length) {
        return interaction.editReply({
          embeds: [createInfoEmbed("Nothing due", "No events are due right now.")],
        });
      }
      const lines = due.map((e) => `#${e.id} ${e.name} — ${formatUtc(e.next_run)}`).join("\n");
      return interaction.editReply({
        embeds: [createInfoEmbed("⏱ Due events", lines)],
      });
    }

    if (sub === "enable") {
      const id = interaction.options.getInteger("id", true);
      const enabled = await setEventEnabled(id, true);
      if (!enabled) {
        logger.warn(`Event not found: ${id}`, "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }
      logger.info(`Event enabled: ${id}`, "event-command");
      return interaction.editReply({
        embeds: [createSuccessEmbed("Event enabled", `Event #${id} is now enabled.`)],
      });
    }

    if (sub === "disable") {
      const id = interaction.options.getInteger("id", true);
      const disabled = await setEventEnabled(id, false);
      if (!disabled) {
        logger.warn(`Event not found: ${id}`, "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }
      logger.info(`Event disabled: ${id}`, "event-command");
      return interaction.editReply({
        embeds: [createSuccessEmbed("Event disabled", `Event #${id} is now disabled.`)],
      });
    }

    if (sub === "run") {
      const id = interaction.options.getInteger("id", true);
      const ev = await getEventById(id);
      if (!ev) {
        logger.warn(`Event not found for run: ${id}`, "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }

      try {
        await sendToChannel(client, ev.channel_id, ev.message);
        logger.info(`Event executed manually: ${id}`, "event-command");
        return interaction.editReply({
          embeds: [createSuccessEmbed("Event executed", `Event #${id} was sent successfully.`)],
        });
      } catch (err) {
        logger.error(`Failed to execute event: ${err?.message}`, "event-command");
        return interaction.editReply({
          embeds: [
            createErrorEmbed(
              "Execution failed",
              `Failed to send event #${id}: ${err?.message || err}`
            ),
          ],
        });
      }
    }

    if (sub === "delete") {
      const id = interaction.options.getInteger("id", true);
      const exists = await getEventById(id);
      if (!exists) {
        logger.warn(`Event not found for delete: ${id}`, "event-command");
        return interaction.editReply({
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }
      await deleteEvent(id);
      logger.info(`Event deleted: ${id}`, "event-command");
      return interaction.editReply({
        embeds: [createSuccessEmbed("Event deleted", `Event #${id} has been deleted.`)],
      });
    }

    return interaction.editReply({
      embeds: [createErrorEmbed("Unknown subcommand", "That subcommand is not recognized.")],
    });
  },
};
