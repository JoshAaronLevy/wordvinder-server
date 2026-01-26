const SUSPICIOUS_TOKENS = ['FREE', 'HINT', 'COIN', 'COINS', 'LEVEL', 'DAILY'];

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function dedupePreserveOrder(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function mergeMissingByLength(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const current = merged.get(entry.length);
    if (!current) {
      merged.set(entry.length, { length: entry.length, count: entry.count });
      continue;
    }
    if (current.count === null || entry.count === null) {
      current.count = null;
      continue;
    }
    current.count += entry.count;
  }
  return Array.from(merged.values()).sort((a, b) => a.length - b.length);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeNotes(notesRaw) {
  if (Array.isArray(notesRaw)) {
    return notesRaw.filter((x) => typeof x === 'string');
  }
  return [];
}

function isSuspiciousWord(word) {
  return SUSPICIOUS_TOKENS.some((token) => word.includes(token));
}

module.exports = {
  stripCodeFences,
  dedupePreserveOrder,
  mergeMissingByLength,
  isPlainObject,
  normalizeNotes,
  isSuspiciousWord,
};
