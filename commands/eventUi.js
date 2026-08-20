import {
  getEventById,
  setEventEnabled,
  getRecentHistory,
  appendHistory,
  searchEventsForAutocomplete,
} from "../data/events.js";
import { deleteEvent } from "../scheduler.js";
import { logger } from "../logger.js";
import {
  createErrorEmbed,
  createEventEmbed,
  createHistoryEmbed,
  createSuccessEmbed,
} from "../embeds.js";
import { EVENT_SELECT_ID, buildEventActionRows } from "../lib/components.js";
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
      content: "❌ Precisas de **Gerir servidor** para usar estes controlos.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === EVENT_SELECT_ID) {
    const id = Number(interaction.values[0]);
    const event = await getEventById(id);
    if (!event) {
      return interaction.update({
        content: `❌ Evento #${id} já não existe.`,
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
  if (prefix !== "event") return false;

  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    return interaction.reply({ content: "❌ ID inválido.", flags: MessageFlags.Ephemeral });
  }

  if (action === "toggle") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.reply({ content: `❌ Evento #${id} não encontrado.`, flags: MessageFlags.Ephemeral });
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
          next ? "Evento ativado" : "Evento desativado",
          `Evento #${id} · **${event.name}**`
        ),
        createEventEmbed(refreshed),
      ],
      components: buildEventActionRows(id, { enabled: next }),
    });
  }

  if (action === "run") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.reply({ content: `❌ Evento #${id} não encontrado.`, flags: MessageFlags.Ephemeral });
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
        embeds: [createSuccessEmbed("Evento enviado", `Evento #${id} foi enviado agora.`)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      return interaction.reply({
        embeds: [createErrorEmbed("Falha ao enviar", error.message)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (action === "delete") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.reply({ content: `❌ Evento #${id} não encontrado.`, flags: MessageFlags.Ephemeral });
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
      embeds: [createSuccessEmbed("Evento apagado", `Evento #${id} · **${event.name}** foi removido.`)],
      components: [],
    });
  }

  if (action === "history") {
    const event = await getEventById(id);
    const entries = await getRecentHistory({ eventId: id, limit: 12 });
    return interaction.reply({
      embeds: [
        createHistoryEmbed(entries, {
          title: `📜 Histórico · #${id} ${event?.name ?? ""}`.trim(),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === "refresh") {
    const event = await getEventById(id);
    if (!event) {
      return interaction.update({
        content: `❌ Evento #${id} já não existe.`,
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

function splitCustomId(customId) {
  // event:toggle:12 → ["event", "toggle", "12"]
  const parts = String(customId).split(":");
  return [parts[0], parts[1], parts[2]];
}

function truncate(text, max) {
  const value = String(text ?? "");
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
