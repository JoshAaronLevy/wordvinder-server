const {
  dedupePreserveOrder,
  mergeMissingByLength,
  isPlainObject,
  normalizeNotes,
  isSuspiciousWord,
} = require('./utils');

const ALLOWED_TOP_LEVEL_KEYS_WORDSCAPES = [
  'schema',
  'game',
  'letters',
  'missingByLength',
  'wordLists',
  'solvedWordsByLength',
  'notes',
];

function normalizeLetters(lettersRaw) {
  if (!Array.isArray(lettersRaw)) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'letters must be an array.',
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

  return { ok: true, letters: dedupedLetters };
}

function normalizeMissingByLength(missingRaw) {
  if (!Array.isArray(missingRaw)) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'missingByLength must be an array.',
      },
    };
  }

  const normalizedEntries = [];
  for (const entry of missingRaw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'missingByLength entries must be objects.',
        },
      };
    }

    const rawLength = Number(entry.length);
    if (!Number.isInteger(rawLength) || rawLength < 3 || rawLength > 12) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'missingByLength length must be an integer between 3 and 12.',
        },
      };
    }

    let count = null;
    if (entry.count !== null) {
      const rawCount = Number(entry.count);
      if (!Number.isInteger(rawCount) || rawCount < 0 || rawCount > 20) {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'missingByLength count must be null or an integer between 0 and 20.',
          },
        };
      }
      count = rawCount;
    }

    normalizedEntries.push({ length: rawLength, count });
  }

  return { ok: true, missingByLength: mergeMissingByLength(normalizedEntries) };
}

function normalizeWordLists(wordListsRaw, notes) {
  if (typeof wordListsRaw === 'undefined') {
    return undefined;
  }

  if (!Array.isArray(wordListsRaw)) {
    if (Array.isArray(notes)) {
      notes.push('Ignored invalid wordLists (not an array)');
    }
    return undefined;
  }

  const entries = [];
  for (const [index, entry] of wordListsRaw.entries()) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const rawLength = Number(entry.length);
    if (!Number.isInteger(rawLength) || rawLength < 3 || rawLength > 12) {
      continue;
    }

    if (!Array.isArray(entry.slots)) {
      continue;
    }

    const slots = entry.slots.map((slot) => {
      if (typeof slot !== 'string') {
        return null;
      }
      const normalized = slot.trim().toUpperCase();
      if (
        !/^[A-Z]+$/.test(normalized) ||
        normalized.length !== rawLength ||
        isSuspiciousWord(normalized)
      ) {
        // Preserve slot positions while dropping invalid word strings.
        return null;
      }
      return normalized;
    });

    entries.push({ length: rawLength, slots, index });
  }

  return entries
    .sort((a, b) => a.length - b.length || a.index - b.index)
    .map(({ length, slots }) => ({ length, slots }));
}

function deriveSolvedWordsFromWordLists(wordLists) {
  if (!Array.isArray(wordLists)) {
    return null;
  }

  const grouped = new Map();
  for (const entry of wordLists) {
    for (const word of entry.slots) {
      if (!word) {
        continue;
      }
      if (!grouped.has(entry.length)) {
        grouped.set(entry.length, []);
      }
      grouped.get(entry.length).push(word);
    }
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([length, words]) => ({
      length,
      words: dedupePreserveOrder(words),
    }));
}

function normalizeSolvedWordsByLength(solvedRaw, notes) {
  if (typeof solvedRaw === 'undefined') {
    return undefined;
  }

  if (!Array.isArray(solvedRaw)) {
    if (Array.isArray(notes)) {
      notes.push('Ignored invalid solvedWordsByLength (not an array)');
    }
    return undefined;
  }

  const entries = [];
  for (const entry of solvedRaw) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const rawLength = Number(entry.length);
    if (!Number.isInteger(rawLength) || rawLength < 3 || rawLength > 12) {
      continue;
    }

    if (!Array.isArray(entry.words)) {
      continue;
    }

    const words = [];
    for (const word of entry.words) {
      if (typeof word !== 'string') {
        continue;
      }
      const normalized = word.trim().toUpperCase();
      if (
        !/^[A-Z]+$/.test(normalized) ||
        normalized.length !== rawLength ||
        isSuspiciousWord(normalized)
      ) {
        continue;
      }
      words.push(normalized);
    }

    entries.push({ length: rawLength, words: dedupePreserveOrder(words) });
  }

  return entries.sort((a, b) => a.length - b.length);
}

function parseWordscapes(parsed) {
  const keys = Object.keys(parsed);
  const invalidKeys = keys.filter((key) => !ALLOWED_TOP_LEVEL_KEYS_WORDSCAPES.includes(key));
  if (invalidKeys.length > 0) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON contains unexpected keys.',
        details: invalidKeys,
      },
    };
  }

  if (typeof parsed.letters === 'undefined' || typeof parsed.missingByLength === 'undefined') {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON is missing required fields.',
      },
    };
  }

  const lettersResult = normalizeLetters(parsed.letters);
  if (!lettersResult.ok) {
    return lettersResult;
  }

  const missingResult = normalizeMissingByLength(parsed.missingByLength);
  if (!missingResult.ok) {
    return missingResult;
  }

  const notes = normalizeNotes(parsed.notes);

  const wordLists = normalizeWordLists(parsed.wordLists, notes);
  let solvedWordsByLength;
  if (Array.isArray(wordLists) && wordLists.length > 0) {
    solvedWordsByLength = deriveSolvedWordsFromWordLists(wordLists);
  } else {
    solvedWordsByLength = normalizeSolvedWordsByLength(parsed.solvedWordsByLength, notes);
  }

  return {
    ok: true,
    board: {
      schema: 'WORDVINDER_BOARD_EXTRACT_V4',
      game: 'WORDSCAPES',
      letters: lettersResult.letters,
      missingByLength: missingResult.missingByLength,
      notes,
      ...(Array.isArray(wordLists) && wordLists.length > 0 ? { wordLists } : {}),
      ...(Array.isArray(solvedWordsByLength) && solvedWordsByLength.length > 0
        ? { solvedWordsByLength }
        : {}),
    },
  };
}

function buildWordscapesSummary(board) {
  let totalRemaining = 0;
  for (const slot of board.missingByLength) {
    if (slot.count === null) {
      totalRemaining = null;
      break;
    }
    totalRemaining += slot.count;
  }
  return {
    letters: board.letters.join(' '),
    remainingByLength: board.missingByLength,
    totalRemaining,
  };
}

module.exports = {
  parseWordscapes,
  buildWordscapesSummary,
};
