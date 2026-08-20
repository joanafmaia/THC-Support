import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import {
  getEventById,
  updateEventById,
  listEvents,
} from "../data/events.js";
import { logger } from "../logger.js";
import { CONFIG } from "../config.js";
import {
  createErrorEmbed,
  createEventEmbed,
  createEventListEmbed,
  createInfoEmbed,
  createSuccessEmbed,
} from "../embeds.js";
import {
  computeFirstRun,
  isValidRepeat,
  validateRepeatValue,
} from "../lib/schedule.js";
import { answer } from "../lib/respond.js";
import { buildEventSelectMenu, buildCreateSetupModal } from "../lib/components.js";
import { autocompleteEventId, handleEventComponent } from "./eventUi.js";

function idOption(option, { required = true, description = "Event ID" } = {}) {
  return option
    .setName("id")
    .setDescription(description)
    .setRequired(required)
    .setAutocomplete(true);
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
        .setDescription("Create an event — guided form, then confirm")
    )

    .addSubcommand((sc) =>
      sc
        .setName("edit")
        .setDescription("Edit an existing event")
        .addIntegerOption((o) => idOption(o))
        .addStringOption((o) =>
          o
            .setName("label")
            .setDescription("Internal name for the list only — not posted in the channel")
            .setRequired(false)
        )
        .addStringOption((o) =>
          o
            .setName("message")
            .setDescription("Exact text the bot will post in the channel")
            .setRequired(false)
        )
        .addIntegerOption((o) =>
          o
            .setName("hour")
            .setDescription("Game UTC hour (0-23)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(23)
        )
        .addIntegerOption((o) =>
          o
            .setName("minute")
            .setDescription("Game UTC minute (0-59)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(59)
        )
        .addStringOption((o) =>
          o
            .setName("repeat")
            .setDescription("Repeat type")
            .setRequired(false)
            .addChoices(
              { name: "Daily", value: "daily" },
              { name: "Every 2 days", value: "every2days" },
              { name: "Once", value: "once" },
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
      sc
        .setName("list")
        .setDescription("List events and manage them with buttons")
        .addBooleanOption((o) =>
          o
            .setName("all")
            .setDescription("Include disabled / finished events")
            .setRequired(false)
        )
    ),

  autocomplete: autocompleteEventId,
  handleComponent: handleEventComponent,
  async execute(interaction, { instanceId } = {}) {
    const sub = interaction.options.getSubcommand();
    const client = interaction.client;
    const buildTag = `build ${CONFIG.BUILD} · ${instanceId ?? "?"}`;

    if (sub === "create") {
      return interaction.showModal(buildCreateSetupModal());
    }

    if (sub === "edit") {
      const id = interaction.options.getInteger("id", true);
      const existing = await getEventById(id);
      if (!existing) {
        return answer(interaction, {
          embeds: [createErrorEmbed("Event not found", `No event exists with ID #${id}.`)],
        });
      }

      const name = interaction.options.getString("label", false) ?? existing.name;
      const message = interaction.options.getString("message", false) ?? existing.message;
      const hourOption = interaction.options.getInteger("hour", false);
      const minuteOption = interaction.options.getInteger("minute", false);
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

      // Game schedule is always UTC.
      const offset = 0;

      const nextRun = (() => {
        if (!shouldRecalculate) {
          return existing.next_run;
        }
        const utcBase = new Date(existing.next_run);

        return computeFirstRun({
          hour: hourOption ?? utcBase.getUTCHours(),
          minute: minuteOption ?? utcBase.getUTCMinutes(),
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
            footerExtra: buildTag,
          }),
        ],
        components: select ? [select] : [],
      });
    }

    return answer(interaction, {
      embeds: [createErrorEmbed("Unknown subcommand", "That subcommand is not recognized.")],
    });
  },
};
