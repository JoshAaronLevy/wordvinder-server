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

function mergeUnsolvedSlots(slots) {
  const merged = new Map();
  for (const slot of slots) {
    const current = merged.get(slot.length) || 0;
    merged.set(slot.length, current + slot.count);
  }
  return Array.from(merged.entries())
    .map(([length, count]) => ({ length, count }))
    .sort((a, b) => a.length - b.length);
}

function parseModelOutput(modelText) {
  if (typeof modelText !== 'string') {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_NOT_JSON',
        message: 'Model output is not text.',
      },
    };
  }

  const normalizedText = stripCodeFences(modelText);
  if (!normalizedText.startsWith('{') || !normalizedText.endsWith('}')) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_NOT_JSON',
        message: 'Model output does not look like JSON.',
      },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(normalizedText);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_NOT_JSON',
        message: 'Model output could not be parsed as JSON.',
        details: error.message,
      },
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON is not an object.',
      },
    };
  }

  const keys = Object.keys(parsed);
  const allowedKeys = ['letters', 'solvedWords', 'unsolvedSlots'];
  if (keys.length !== allowedKeys.length || !allowedKeys.every((key) => keys.includes(key))) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON must contain only letters, solvedWords, unsolvedSlots.',
        details: keys,
      },
    };
  }

  const lettersRaw = Array.isArray(parsed.letters) ? parsed.letters : null;
  const solvedRaw = Array.isArray(parsed.solvedWords) ? parsed.solvedWords : null;
  const unsolvedRaw = Array.isArray(parsed.unsolvedSlots) ? parsed.unsolvedSlots : null;

  if (!lettersRaw || !solvedRaw || !unsolvedRaw) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON fields must be arrays.',
      },
    };
  }

  if (lettersRaw.length < 5 || lettersRaw.length > 8) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'letters must contain 5 to 8 items.',
      },
    };
  }

  const letters = [];
  for (const letter of lettersRaw) {
    if (typeof letter !== 'string') {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'letters must contain single A-Z characters.',
        },
      };
    }
    const normalized = letter.trim().toUpperCase();
    if (!/^[A-Z]$/.test(normalized)) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'letters must contain single A-Z characters.',
        },
      };
    }
    letters.push(normalized);
  }

  const solvedWords = [];
  for (const word of solvedRaw) {
    if (typeof word !== 'string') {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'solvedWords must be uppercase alphabetic words (length >= 2).',
        },
      };
    }
    const normalized = word.trim().toUpperCase();
    if (!/^[A-Z]+$/.test(normalized) || normalized.length < 2) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'solvedWords must be uppercase alphabetic words (length >= 2).',
        },
      };
    }
    solvedWords.push(normalized);
  }

  const unsolvedSlots = [];
  for (const slot of unsolvedRaw) {
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'unsolvedSlots entries must be objects.',
        },
      };
    }

    const rawLength = Number(slot.length);
    const rawCount = Number(slot.count);

    if (!Number.isFinite(rawLength) || !Number.isFinite(rawCount)) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'unsolvedSlots length and count must be numbers.',
        },
      };
    }

    const length = Math.trunc(rawLength);
    const count = Math.trunc(rawCount);

    if (!Number.isInteger(length) || length < 3 || length > 12) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'unsolvedSlots length must be an integer between 3 and 12.',
        },
      };
    }

    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'unsolvedSlots count must be an integer between 1 and 20.',
        },
      };
    }

    unsolvedSlots.push({ length, count });
  }

  const dedupedLetters = dedupePreserveOrder(letters);
  if (dedupedLetters.length < 5) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'letters must contain at least 5 unique characters.',
      },
    };
  }

  const dedupedSolved = dedupePreserveOrder(solvedWords);
  for (const word of dedupedSolved) {
    if (SUSPICIOUS_TOKENS.some((token) => word.includes(token))) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SUSPICIOUS',
          message: `Suspicious word detected: ${word}`,
        },
      };
    }
  }

  return {
    ok: true,
    board: {
      letters: dedupedLetters,
      solvedWords: dedupedSolved,
      unsolvedSlots: mergeUnsolvedSlots(unsolvedSlots),
    },
  };
}

function buildSummary(board) {
  const totalRemaining = board.unsolvedSlots.reduce((sum, slot) => sum + slot.count, 0);
  return {
    letters: board.letters.join(' '),
    remainingByLength: board.unsolvedSlots,
    totalRemaining,
  };
}

module.exports = {
  parseModelOutput,
  buildSummary,
};
