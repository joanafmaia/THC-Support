const drafts = new Map();
const TTL_MS = 15 * 60 * 1000;

function key(userId, guildId) {
  return `${guildId ?? "dm"}:${userId}`;
}

export function saveCreateDraft(userId, guildId, draft) {
  drafts.set(key(userId, guildId), { ...draft, savedAt: Date.now() });
}

export function getCreateDraft(userId, guildId) {
  const entry = drafts.get(key(userId, guildId));
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TTL_MS) {
    drafts.delete(key(userId, guildId));
    return null;
  }
  return entry;
}

export function clearCreateDraft(userId, guildId) {
  drafts.delete(key(userId, guildId));
}

export function touchCreateDraft(userId, guildId, patch) {
  const current = getCreateDraft(userId, guildId);
  if (!current) return null;
  const next = { ...current, ...patch, savedAt: Date.now() };
  drafts.set(key(userId, guildId), next);
  return next;
}
