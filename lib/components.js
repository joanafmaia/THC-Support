import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";

export const EVENT_SELECT_ID = "event:pick";
export const EVENT_BTN = {
  toggle: "event:toggle",
  run: "event:run",
  delete: "event:delete",
  history: "event:history",
  refresh: "event:refresh",
};

/** Discord allows at most 25 select options. */
export function buildEventSelectMenu(events, { placeholder = "Escolhe um evento…" } = {}) {
  const options = events.slice(0, 25).map((event) => ({
    label: truncate(`#${event.id} ${event.name}`, 100),
    description: truncate(
      `${event.enabled ? "Ativo" : "Inativo"} · ${formatShort(event.next_run)}`,
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
      .setLabel(enabled ? "Desativar" : "Ativar")
      .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.run}:${id}`)
      .setLabel("Correr agora")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.history}:${id}`)
      .setLabel("Histórico")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.delete}:${id}`)
      .setLabel("Apagar")
      .setStyle(ButtonStyle.Danger)
  );

  const extras = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EVENT_BTN.refresh}:${id}`)
      .setLabel("Atualizar")
      .setStyle(ButtonStyle.Secondary)
  );

  return [actions, extras];
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
