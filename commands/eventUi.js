import {
  getEventById,
  setEventEnabled,
  getRecentHistory,
  appendHistory,
  searchEventsForAutocomplete,
} from "../data/events.js";
import { addEvent, deleteEvent } from "../scheduler.js";
import { logger } from "../logger.js";
import {
  createErrorEmbed,
  createEventEmbed,
  createHistoryEmbed,
  createSuccessEmbed,
  createCreatePreviewEmbed,
  formatUtc,
} from "../embeds.js";
import {
  EVENT_SELECT_ID,
  CREATE_UI,
  buildEventActionRows,
  buildCreatePreviewComponents,
  buildCreateMessageModal,
} from "../lib/components.js";
import {
  getCreateDraft,
  clearCreateDraft,
  touchCreateDraft,
} from "../lib/drafts.js";
import { computeFirstRun, validateRepeatValue } from "../lib/schedule.js";
import { PermissionFlagsBits, MessageFlags } from "discord.js";

async function sendToChannel(client, channelId, content) {
  const channel = await client.channels.fetch(channelId);
  if (!channel) throw new Error(`Channel ${channelId} not found`);
  await channel.send(content);
}

function canManage(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export async function autocompleteEventId(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "id") {
    return interaction.respond([]);
  }

  const rows = await searchEventsForAutocomplete(focused.value);
  return interaction.respond(
    rows.map((event) => ({
      name: truncate(
        `${event.enabled ? "✅" : "⛔"} #${event.id} ${event.name}`,
        100
      ),
      value: event.id,
    }))
  );
}

export async function handleEventComponent(interaction) {
  if (!canManage(interaction)) {
    return interaction.reply({
      content: "❌ You need **Manage Server** to use these controls.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (await handleCreateFlow(interaction)) return true;

  if (interaction.isStringSelectMenu() && interaction.customId === EVENT_SELECT_ID) {
    const id = Number(interaction.values[0]);
    const event = await getEventById(id);
    if (!event) {
      return interaction.update({
        content: `❌ Event #${id} no longer exists.`,
        embeds: [],
        components: [],
      });
    }

    return interaction.update({
      content: null,
      embeds: [createEventEmbed(event)],
      components: buildEventActionRows(event.id, { enabled: event.enabled }),
    });
  }

  if (!interaction.isButton()) return false;

  const [prefix, action, rawId] = splitCustomId(interaction.customId);
  if (prefix !== "event" || action === "create") return false;

  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    return interaction.reply({ content: "❌ Invalid ID.", flags: MessageFlags.Ephemeral });
  }

  if (action === "toggle") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.reply({
        content: `❌ Event #${id} not found.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const next = !event.enabled;
    await setEventEnabled(id, next);
    await appendHistory({
      eventId: id,
      eventName: event.name,
      action: next ? "enabled" : "disabled",
      userId: interaction.user.id,
    });
    const refreshed = await getEventById(id);
    logger.info(`Event ${next ? "enabled" : "disabled"} via button: ${id}`, "event-ui");
    return interaction.update({
      embeds: [
        createSuccessEmbed(
          next ? "Event enabled" : "Event disabled",
          `Event #${id} · **${event.name}**`
        ),
        createEventEmbed(refreshed),
      ],
      components: buildEventActionRows(id, { enabled: next }),
    });
  }

  if (action === "run") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.reply({
        content: `❌ Event #${id} not found.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    try {
      await sendToChannel(interaction.client, event.channel_id, event.message);
      await appendHistory({
        eventId: id,
        eventName: event.name,
        action: "run",
        userId: interaction.user.id,
      });
      logger.info(`Event run via button: ${id}`, "event-ui");
      return interaction.reply({
        embeds: [createSuccessEmbed("Event sent", `Event #${id} was sent just now.`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      return interaction.reply({
        embeds: [createErrorEmbed("Failed to send", error.message)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (action === "delete") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.reply({
        content: `❌ Event #${id} not found.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    await deleteEvent(id);
    await appendHistory({
      eventId: id,
      eventName: event.name,
      action: "deleted",
      userId: interaction.user.id,
    });
    logger.info(`Event deleted via button: ${id}`, "event-ui");
    return interaction.update({
      content: null,
      embeds: [
        createSuccessEmbed("Event deleted", `Event #${id} · **${event.name}** was removed.`),
      ],
      components: [],
    });
  }

  if (action === "history") {
    const event = await getEventById(id);
    const entries = await getRecentHistory({ eventId: id, limit: 12 });
    return interaction.reply({
      embeds: [
        createHistoryEmbed(entries, {
          title: `History · #${id} ${event?.name ?? ""}`.trim(),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === "refresh") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.update({
        content: `❌ Event #${id} no longer exists.`,
        embeds: [],
        components: [],
      });
    }
    return interaction.update({
      embeds: [createEventEmbed(event)],
      components: buildEventActionRows(id, { enabled: event.enabled }),
    });
  }

  return false;
}

async function handleCreateFlow(interaction) {
  const customId = interaction.customId;

  if (interaction.isModalSubmit() && customId === CREATE_UI.modal) {
    const draft = getCreateDraft(interaction.user.id, interaction.guildId);
    if (!draft) {
      return interaction.reply({
        content: "⏳ Preview expired. Run `/event create` again.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const message = interaction.fields.getTextInputValue("message");
    if (
      mentionsEveryone(message) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)
    ) {
      return interaction.reply({
        embeds: [
          createErrorEmbed(
            "Missing permission",
            "You need **Mention Everyone** to use `@everyone` / `@here`."
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const updated = touchCreateDraft(interaction.user.id, interaction.guildId, { message });
    if (interaction.message) {
      await interaction.message.edit({
        embeds: [createCreatePreviewEmbed(updated)],
        components: buildCreatePreviewComponents(updated),
      });
      return interaction.reply({
        content: "✅ Message updated in the preview.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({
      embeds: [createCreatePreviewEmbed(updated)],
      components: buildCreatePreviewComponents(updated),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.isChannelSelectMenu() && customId === CREATE_UI.channel) {
    const draft = getCreateDraft(interaction.user.id, interaction.guildId);
    if (!draft) {
      return interaction.update({
        content: "⏳ Preview expired. Run `/event create` again.",
        embeds: [],
        components: [],
      });
    }

    const channel = interaction.channels.first();
    if (!channel?.isTextBased()) {
      return interaction.reply({
        content: "❌ Pick a text channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const botPermissions = channel.permissionsFor(interaction.guild?.members.me);
    if (
      botPermissions &&
      (!botPermissions.has(PermissionFlagsBits.ViewChannel) ||
        !botPermissions.has(PermissionFlagsBits.SendMessages))
    ) {
      return interaction.reply({
        content: "❌ I can't view/send messages in that channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const updated = touchCreateDraft(interaction.user.id, interaction.guildId, {
      channelId: channel.id,
    });
    return interaction.update({
      embeds: [createCreatePreviewEmbed(updated)],
      components: buildCreatePreviewComponents(updated),
    });
  }

  if (interaction.isStringSelectMenu() && customId === CREATE_UI.repeat) {
    const draft = getCreateDraft(interaction.user.id, interaction.guildId);
    if (!draft) {
      return interaction.update({
        content: "⏳ Preview expired. Run `/event create` again.",
        embeds: [],
        components: [],
      });
    }

    const repeat = interaction.values[0];
    const error = validateRepeatValue(repeat, draft.repeatValue);
    if (error) {
      return interaction.reply({
        embeds: [
          createErrorEmbed(
            "Missing repeat_value",
            `${error} Cancel and create again with the right value, or pick Daily / Once.`
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }

    const nextRun = computeFirstRun({
      hour: draft.hour,
      minute: draft.minute,
      repeatType: repeat,
      repeatValue: draft.repeatValue,
      timezoneOffset: draft.timezoneOffset,
    });
    const updated = touchCreateDraft(interaction.user.id, interaction.guildId, {
      repeat,
      nextRun,
    });
    return interaction.update({
      embeds: [createCreatePreviewEmbed(updated)],
      components: buildCreatePreviewComponents(updated),
    });
  }

  if (interaction.isButton() && customId === CREATE_UI.editMessage) {
    const draft = getCreateDraft(interaction.user.id, interaction.guildId);
    if (!draft) {
      return interaction.reply({
        content: "⏳ Preview expired. Run `/event create` again.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.showModal(buildCreateMessageModal(draft.message));
  }

  if (interaction.isButton() && customId === CREATE_UI.cancel) {
    clearCreateDraft(interaction.user.id, interaction.guildId);
    return interaction.update({
      content: null,
      embeds: [
        createSuccessEmbed("Creation cancelled", "The draft was discarded. Nothing was saved."),
      ],
      components: [],
    });
  }

  if (interaction.isButton() && customId === CREATE_UI.confirm) {
    const draft = getCreateDraft(interaction.user.id, interaction.guildId);
    if (!draft) {
      return interaction.update({
        content: "⏳ Preview expired. Run `/event create` again.",
        embeds: [],
        components: [],
      });
    }

    try {
      const channel = await interaction.client.channels.fetch(draft.channelId);
      if (!channel?.isTextBased()) {
        throw new Error("Invalid channel");
      }
    } catch {
      return interaction.reply({
        content: "❌ Invalid channel. Pick another from the menu.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const id = await addEvent({
      name: draft.name,
      channelId: draft.channelId,
      message: draft.message,
      nextRun: draft.nextRun,
      repeatType: draft.repeat,
      repeatValue: draft.repeatValue,
      timezoneOffset: draft.timezoneOffset,
    });

    clearCreateDraft(interaction.user.id, interaction.guildId);
    await appendHistory({
      eventId: id,
      eventName: draft.name,
      action: "created",
      userId: interaction.user.id,
    });
    logger.info(`Event created via preview: ${draft.name} (ID: ${id})`, "event-ui");

    return interaction.update({
      content: null,
      embeds: [
        createSuccessEmbed(
          "Event created",
          `**ID:** #${id}\n**Name:** ${draft.name}\n**Channel:** <#${draft.channelId}>\n**Next run:** ${formatUtc(draft.nextRun)}\n**Repeat:** ${draft.repeat}${draft.repeatValue != null ? ` (${draft.repeatValue})` : ""}`
        ),
      ],
      components: [],
    });
  }

  return false;
}

function mentionsEveryone(message) {
  return /@everyone|@here/.test(message);
}

function splitCustomId(customId) {
  const parts = String(customId).split(":");
  return [parts[0], parts[1], parts[2]];
}

function truncate(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
