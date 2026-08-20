import { MessageFlags } from "discord.js";
import { logger } from "../logger.js";

/**
 * Prefer a single interaction callback (reply) over webhook edit.
 * Deferred editReply has been getting Discord 4xx on this host and restarts
 * the invalid-request cool-down, so callers should avoid deferring.
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
