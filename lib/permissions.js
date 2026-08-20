import { PermissionFlagsBits } from "discord.js";
import { CONFIG } from "../config.js";

/**
 * True when the member has an allowed staff role (default: R4 / R5).
 * Role names are matched case-insensitively; optional role IDs override/add.
 * Administrators always pass so the server is never locked out.
 */
export function memberCanUseBot(interaction) {
  if (!interaction.guildId || !interaction.member) return false;

  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const allowedNames = new Set(
    CONFIG.ALLOWED_ROLE_NAMES.map((name) => String(name).trim().toLowerCase()).filter(Boolean)
  );
  const allowedIds = new Set(
    CONFIG.ALLOWED_ROLE_IDS.map((id) => String(id).trim()).filter(Boolean)
  );

  const roleIds = resolveMemberRoleIds(interaction.member);
  for (const roleId of roleIds) {
    if (allowedIds.has(roleId)) return true;
    const role = interaction.guild?.roles.cache.get(roleId);
    if (role && allowedNames.has(role.name.toLowerCase())) return true;
  }

  return false;
}

export function deniedBotAccessEmbed() {
  const names = CONFIG.ALLOWED_ROLE_NAMES.join(" / ");
  return {
    title: "Missing role",
    description: `Only members with the **${names}** role can use this bot.`,
  };
}

function resolveMemberRoleIds(member) {
  if (member.roles?.cache && typeof member.roles.cache.keys === "function") {
    return [...member.roles.cache.keys()];
  }
  if (Array.isArray(member.roles)) {
    return member.roles.map(String);
  }
  return [];
}
