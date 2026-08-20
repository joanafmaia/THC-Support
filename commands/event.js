import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import {
  getEventById,
  updateEventById,
  listEvents,
  listEventsForPreview,
  getEventForPreview,
  setEventEnabled,
  appendHistory,
  getRecentHistory,
} from "../data/events.js";
import { logger } from "../logger.js";
import {
  createErrorEmbed,
  createEventEmbed,
  createEventListEmbed,
  createEventPreviewEmbed,
  createEventPreviewListEmbed,
  createHistoryEmbed,
  createCreatePreviewEmbed,
  createInfoEmbed,
  createSuccessEmbed,
  formatUtc,
} from "../embeds.js";
import {
  deleteEvent,
  getNextEvent,
  getDueEvents,
} from "../scheduler.js";
import {
  computeFirstRun,
  isValidRepeat,
  validateRepeatValue,
} from "../lib/schedule.js";
import { answer } from "../lib/respond.js";
import { buildEventSelectMenu, buildCreatePreviewComponents } from "../lib/components.js";
import { saveCreateDraft } from "../lib/drafts.js";
import { autocompleteEventId, handleEventComponent } from "./eventUi.js";

function idOption(option, { required = true, description = "Event ID" } = {}) {
  return option
    .setName("id")
    .setDescription(description)
    .setRequired(required)
    .setAutocomplete(true);
}

async function sendToChannel(client, channelId, content) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found`);
  await channel.send(content);
}

function mentionsEveryone(message) {
  return /@everyone|@here/.test(message);
}

/**
 * Scheduled messages are sent by the bot later, so the author's own
 * "Mention Everyone" permission has to be checked at scheduling time.
 */
function missingMentionPermission(interaction, message) {
  return (
    mentionsEveryone(message) &&
    !interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)
  );
}

const MENTION_PERMISSION_ERROR = createErrorEmbed(
  "Missing permission",
  "You need the **Mention Everyone** permission to schedule a message containing `@everyone` or `@here`."
);

export default {
  data: new SlashCommandBuilder()
    .setName("event")
    .setDescription("Create and manage scheduled events (UTC)")
    // Events make the bot post to any channel, so keep this to server managers.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommand((sc) =>
      sc
        .setName("create")
        .setDescription("Create an event — opens a live preview to confirm")
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
        .addIntegerOption((o) => idOption(o))
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
      sc
        .setName("list")
        .setDescription("List active events (use all:true to include disabled)")
        .addBooleanOption((o) =>
          o
            .setName("all")
            .setDescription("Include disabled / finished events")
            .setRequired(false)
        )
    )

    .addSubcommand((sc) =>
      sc
        .setName("preview")
        .setDescription("Preview the message for scheduled events")
        .addIntegerOption((o) =>
          idOption(o, { required: false, description: "Event ID to preview" })
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
        .setName("history")
        .setDescription("Show recent send / manage history")
        .addIntegerOption((o) =>
          idOption(o, { required: false, description: "Filter history to one event" })
        )
    )

    .addSubcommand((sc) =>
      sc
        .setName("enable")
        .setDescription("Enable an event")
        .addIntegerOption((o) => idOption(o))
    )

    .addSubcommand((sc) =>
      sc
        .setName("disable")
        .setDescription("Disable an event")
        .addIntegerOption((o) => idOption(o))
    )

    .addSubcommand((sc) =>
      sc
        .setName("run")
        .setDescription("Run an event now")
        .addIntegerOption((o) => idOption(o))
    )

    .addSubcommand((sc) =>
      sc
        .setName("delete")
        .setDescription("Delete an event")
        .addIntegerOption((o) => idOption(o))
    ),

  autocomplete: autocompleteEventId,
  handleComponent: handleEventComponent,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
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
        return answer(interaction, {
          embeds: [createErrorEmbed("Message too long", "Maximum length is 2000 characters.")],
        });
      }

      if (missingMentionPermission(interaction, message)) {
        return answer(interaction, { embeds: [MENTION_PERMISSION_ERROR] });
      }

      // Validate channel exists
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          logger.warn(`Invalid channel ID: ${channelId}`, "event-command");
          return answer(interaction, {
            embeds: [createErrorEmbed("Channel not found", "Please provide a valid text channel ID.")],
          });
        }
        const botPermissions = channel.permissionsFor(interaction.guild?.members.me);
        if (botPermissions) {
          if (!botPermissions.has(PermissionFlagsBits.ViewChannel)) {
            return answer(interaction, {
              embeds: [createErrorEmbed("Missing permission", "I can't view that channel.")],
            });
          }
          if (!botPermissions.has(PermissionFlagsBits.SendMessages)) {
            return answer(interaction, {
              embeds: [createErrorEmbed("Missing permission", "I can't send messages in that channel.")],
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch channel ${channelId}: ${error.message}`, "event-command");
        return answer(interaction, {
          embeds: [createErrorEmbed("Invalid channel", "Channel lookup failed. Check the channel ID.")],
        });
      }

      if (!isValidRepeat(repeat)) {
        logger.warn(`Invalid repeat type: ${repeat}`, "event-command");
        return answer(interaction, {
          embeds: [
            createErrorEmbed(
              "Invalid repeat type",
              "Use one of: once, daily, every2days, weekly, monthly."
            ),
          ],
        });
      }

      const repeatValueError = validateRepeatValue(repeat, repeatValue);
      if (repeatValueError) {
        return answer(interaction, {
          embeds: [createErrorEmbed("Invalid repeat value", repeatValueError)],
        });
      }

      const nextRun = computeFirstRun({
        hour,
        minute,
        repeatType: repeat,
        repeatValue: repeatValue ?? null,
        timezoneOffset,
      });

      const draft = {
        name,
        message,
        hour,
        minute,
        timezoneOffset,
        repeat,
        repeatValue: repeatValue ?? null,
        channelId,
        nextRun,
      };

      saveCreateDraft(interaction.user.id, interaction.guildId, draft);

      return answer(interaction, {
        embeds: [createCreatePreviewEmbed(draft)],
        components: buildCreatePreviewComponents(draft),
      });
    }

    if (sub === "edit") {
      const id = interaction.options.getInteger("id", true);
      const existing = await getEventById(id);
      if (!existing) {
        return answer(interaction, {
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
        return answer(interaction, {
          embeds: [createErrorEmbed("Invalid time update", "Provide both hour and minute.")],
        });
      }

      if (timezoneOffset != null && hourOption == null && minuteOption == null) {
        return answer(interaction, {
          embeds: [
            createErrorEmbed(
              "Invalid timezone offset",
              "timezone_offset only applies when updating hour/minute."
            ),
          ],
        });
      }

      if (message.length > 2000) {
        return answer(interaction, {
          embeds: [createErrorEmbed("Message too long", "Maximum length is 2000 characters.")],
        });
      }

      if (missingMentionPermission(interaction, message)) {
        return answer(interaction, { embeds: [MENTION_PERMISSION_ERROR] });
      }

      if (!isValidRepeat(repeat)) {
        return answer(interaction, {
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
        const repeatValueError = validateRepeatValue(repeat, repeatValue);
        if (repeatValueError) {
          return answer(interaction, {
            embeds: [createErrorEmbed("Invalid repeat value", repeatValueError)],
          });
        }
      }

      // Validate channel exists
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          logger.warn(`Invalid channel ID: ${channelId}`, "event-command");
          return answer(interaction, {
            embeds: [createErrorEmbed("Channel not found", "Please provide a valid text channel ID.")],
          });
        }
        const botPermissions = channel.permissionsFor(interaction.guild?.members.me);
        if (botPermissions) {
          if (!botPermissions.has(PermissionFlagsBits.ViewChannel)) {
            return answer(interaction, {
              embeds: [createErrorEmbed("Missing permission", "I can't view that channel.")],
            });
          }
          if (!botPermissions.has(PermissionFlagsBits.SendMessages)) {
            return answer(interaction, {
              embeds: [createErrorEmbed("Missing permission", "I can't send messages in that channel.")],
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch channel ${channelId}: ${error.message}`, "event-command");
        return answer(interaction, {
          embeds: [createErrorEmbed("Invalid channel", "Channel lookup failed. Check the channel ID.")],
        });
      }

      const offset = timezoneOffset ?? existing.timezone_offset ?? 0;

      const nextRun = (() => {
        if (!shouldRecalculate) {
          return existing.next_run;
        }
        // Existing runs are stored in UTC, so read the current time back in the
        // event's own timezone before applying the requested hour/minute.
        const localBase = new Date(new Date(existing.next_run).getTime() + offset * 3_600_000);

        return computeFirstRun({
          hour: hourOption ?? localBase.getUTCHours(),
          minute: minuteOption ?? localBase.getUTCMinutes(),
          repeatType: repeat,
          repeatValue: repeatValue ?? null,
          timezoneOffset: offset,
        });
      })();

      await updateEventById(id, {
        name,
        channel_id: channelId,
        message,
        next_run: nextRun,
        repeat_type: repeat,
        repeat_value: repeatValue ?? null,
        timezone_offset: offset,
      });

      logger.info(`Event updated: ${name} (ID: ${id})`, "event-command");
      const refreshed = await getEventById(id);
      return answer(interaction, {
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
        return answer(interaction, {
          embeds: [createInfoEmbed("No scheduled events", "There are no upcoming events.")],
        });
      }
      return answer(interaction, { embeds: [createEventEmbed(next)] });
    }

    if (sub === "list") {
      const showAll = interaction.options.getBoolean("all", false) ?? false;
      const rows = await listEvents({ enabledOnly: !showAll });

      if (!rows.length) {
        return answer(interaction, {
          embeds: [
            createInfoEmbed(
              showAll ? "No events" : "No active events",
              showAll
                ? "No events exist yet."
                : "No active events. Use `/event list all:True` to include disabled ones."
            ),
          ],
        });
      }

      const select = buildEventSelectMenu(rows);
      return answer(interaction, {
        embeds: [
          createEventListEmbed(rows, {
            title: showAll ? "All events" : "Active events",
          }),
        ],
        components: select ? [select] : [],
      });
    }

    if (sub === "history") {
      const id = interaction.options.getInteger("id", false);
      if (id != null) {
        const event = await getEventById(id);
        if (!event) {
          return answer(interaction, {
            embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
          });
        }
        const entries = await getRecentHistory({ eventId: id, limit: 15 });
        return answer(interaction, {
          embeds: [
            createHistoryEmbed(entries, {
              title: `History · #${id} ${event.name}`,
            }),
          ],
        });
      }

      const entries = await getRecentHistory({ limit: 15 });
      return answer(interaction, {
        embeds: [createHistoryEmbed(entries)],
      });
    }

    if (sub === "preview") {
      const id = interaction.options.getInteger("id", false);
      const all = interaction.options.getBoolean("all", false) ?? false;

      if (all && id != null) {
        return answer(interaction, {
          embeds: [createErrorEmbed("Invalid usage", "Use either all:true or id:<eventId>, not both.")],
        });
      }

      if (!all && id == null) {
        return answer(interaction, {
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
          return answer(interaction, {
            embeds: [createInfoEmbed("No events found", "No scheduled events exist yet.")],
          });
        }

        return answer(interaction, { embeds: [createEventPreviewListEmbed(rows)] });
      }

      const event = await getEventForPreview(id);

      if (!event) {
        return answer(interaction, {
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }

      return answer(interaction, { embeds: [createEventPreviewEmbed(event)] });
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
        "`/event list` — active only (use `all:True` to see all)",
        "`/event next` / `/event due` / `/event history [id]`",
        "`/event preview id:<id>` / `/event preview all:true`",
        "",
        "**Tip**",
        "In `/event list`, pick an event from the menu to Enable, Run, Delete, or view History.",
        "",
        "**Repeat values**",
        "`weekly repeat_value`: 0-6 (Sun-Sat)",
        "`monthly repeat_value`: 1-31",
      ].join("\n");

      return answer(interaction, {
        embeds: [createInfoEmbed("Event command help", helpText)],
      });
    }

    if (sub === "due") {
      const due = await getDueEvents(new Date().toISOString());
      if (!due.length) {
        return answer(interaction, {
          embeds: [createInfoEmbed("Nothing due", "No events are due right now.")],
        });
      }
      const lines = due.map((e) => `#${e.id} ${e.name} — ${formatUtc(e.next_run)}`).join("\n");
      return answer(interaction, {
        embeds: [createInfoEmbed("⏱ Due events", lines)],
      });
    }

    if (sub === "enable") {
      const id = interaction.options.getInteger("id", true);
      const enabled = await setEventEnabled(id, true);
      if (!enabled) {
        logger.warn(`Event not found: ${id}`, "event-command");
        return answer(interaction, {
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }
      logger.info(`Event enabled: ${id}`, "event-command");
      const enabledEvent = await getEventById(id);
      await appendHistory({
        eventId: id,
        eventName: enabledEvent?.name,
        action: "enabled",
        userId: interaction.user.id,
      });
      return answer(interaction, {
        embeds: [createSuccessEmbed("Event enabled", `Event #${id} is now enabled.`)],
      });
    }

    if (sub === "disable") {
      const id = interaction.options.getInteger("id", true);
      const disabled = await setEventEnabled(id, false);
      if (!disabled) {
        logger.warn(`Event not found: ${id}`, "event-command");
        return answer(interaction, {
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }
      logger.info(`Event disabled: ${id}`, "event-command");
      const disabledEvent = await getEventById(id);
      await appendHistory({
        eventId: id,
        eventName: disabledEvent?.name,
        action: "disabled",
        userId: interaction.user.id,
      });
      return answer(interaction, {
        embeds: [createSuccessEmbed("Event disabled", `Event #${id} is now disabled.`)],
      });
    }

    if (sub === "run") {
      const id = interaction.options.getInteger("id", true);
      const ev = await getEventById(id);
      if (!ev) {
        logger.warn(`Event not found for run: ${id}`, "event-command");
        return answer(interaction, {
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }

      try {
        await sendToChannel(client, ev.channel_id, ev.message);
        logger.info(`Event executed manually: ${id}`, "event-command");
        await appendHistory({
          eventId: id,
          eventName: ev.name,
          action: "run",
          userId: interaction.user.id,
        });
        return answer(interaction, {
          embeds: [createSuccessEmbed("Event executed", `Event #${id} was sent successfully.`)],
        });
      } catch (err) {
        logger.error(`Failed to execute event: ${err?.message}`, "event-command");
        return answer(interaction, {
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
        return answer(interaction, {
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }
      await deleteEvent(id);
      logger.info(`Event deleted: ${id}`, "event-command");
      await appendHistory({
        eventId: id,
        eventName: exists.name,
        action: "deleted",
        userId: interaction.user.id,
      });
      return answer(interaction, {
        embeds: [createSuccessEmbed("Event deleted", `Event #${id} has been deleted.`)],
      });
    }

    return answer(interaction, {
      embeds: [createErrorEmbed("Unknown subcommand", "That subcommand is not recognized.")],
    });
  },
};
