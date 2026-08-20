import { MessageFlags } from "discord.js";
import { logger } from "../logger.js";

/**
 * Prefer a single interaction callback (reply) over webhook edit.
 * Ping works; deferred editReply has been getting Discord 4xx on this host.
 */
export async function answer(interaction, payload, { ephemeral = true } = {}) {
  const body =
    payload == null || typeof payload === "string"
      ? { content: String(payload ?? "") }
      : (() => {
          const { flags: _flags, ...rest } = payload;
          return rest;
        })();

  const via = interaction.deferred || interaction.replied ? "editReply" : "reply";
  logger.info(`Sending response via ${via}`, "interaction");

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(body);
  }

  return interaction.reply({
    ...body,
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

/** Call before slow work that may exceed Discord's 3s acknowledgement window. */
export async function deferIfNeeded(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  logger.debug("Deferred slow command", "interaction");
}
