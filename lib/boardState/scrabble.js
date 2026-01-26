const { isPlainObject, normalizeNotes } = require('./utils');

const ALLOWED_TOP_LEVEL_KEYS_SCRABBLE = ['schema', 'game', 'rack', 'board', 'notes'];

function normalizeScrabbleRack(rackRaw) {
  if (!Array.isArray(rackRaw)) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'rack must be an array.',
      },
    };
  }

  if (rackRaw.length > 7) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'rack must contain 0 to 7 tiles.',
      },
    };
  }

  const rack = [];
  for (const tile of rackRaw) {
    if (!isPlainObject(tile)) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'rack tiles must be objects.',
        },
      };
    }

    const isBlank = tile.isBlank === true;
    const rawPoints = Number(tile.points);
    if (!Number.isInteger(rawPoints) || rawPoints < 0 || rawPoints > 10) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'rack tile points must be an integer between 0 and 10.',
        },
      };
    }

    let letter = null;
    if (tile.letter !== null && typeof tile.letter !== 'undefined') {
      if (typeof tile.letter !== 'string') {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'rack tile letter must be a string or null.',
          },
        };
      }
      const normalized = tile.letter.trim().toUpperCase();
      if (!/^[A-Z]$/.test(normalized)) {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'rack tile letter must be a single A-Z character.',
          },
        };
      }
      letter = normalized;
    }

    if (isBlank) {
      if (letter !== null || rawPoints !== 0) {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'blank tiles must have null letter and 0 points.',
          },
        };
      }
    } else {
      if (letter === null) {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'non-blank tiles must have a letter.',
          },
        };
      }
    }

    rack.push({
      letter,
      points: rawPoints,
      isBlank,
    });
  }

  return { ok: true, rack };
}

function normalizeScrabbleBoard(boardRaw) {
  if (!isPlainObject(boardRaw)) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'board must be an object.',
      },
    };
  }

  const size = Number(boardRaw.size);
  if (!Number.isInteger(size) || size !== 15) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'board size must be 15.',
      },
    };
  }

  if (!Array.isArray(boardRaw.tiles) || boardRaw.tiles.length !== 15) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'board tiles must be a 15x15 array.',
      },
    };
  }

  const tiles = [];
  for (const row of boardRaw.tiles) {
    if (!Array.isArray(row) || row.length !== 15) {
      return {
        ok: false,
        error: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'board tiles must be a 15x15 array.',
        },
      };
    }

    const normalizedRow = [];
    for (const cell of row) {
      if (cell === null) {
        normalizedRow.push(null);
        continue;
      }
      if (typeof cell !== 'string') {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'board tiles must be null or A-Z strings.',
          },
        };
      }
      const normalized = cell.trim().toUpperCase();
      if (!/^[A-Z]$/.test(normalized)) {
        return {
          ok: false,
          error: {
            code: 'MODEL_OUTPUT_SCHEMA_INVALID',
            message: 'board tiles must be null or A-Z strings.',
          },
        };
      }
      normalizedRow.push(normalized);
    }
    tiles.push(normalizedRow);
  }

  return { ok: true, board: { size: 15, tiles } };
}

function parseScrabble(parsed) {
  const keys = Object.keys(parsed);
  const invalidKeys = keys.filter((key) => !ALLOWED_TOP_LEVEL_KEYS_SCRABBLE.includes(key));
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

  if (typeof parsed.rack === 'undefined' || typeof parsed.board === 'undefined') {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON is missing required fields.',
      },
    };
  }

  const rackResult = normalizeScrabbleRack(parsed.rack);
  if (!rackResult.ok) {
    return rackResult;
  }

  const boardResult = normalizeScrabbleBoard(parsed.board);
  if (!boardResult.ok) {
    return boardResult;
  }

  const notes = normalizeNotes(parsed.notes);

  return {
    ok: true,
    board: {
      schema: 'WORDVINDER_SCRABBLE_EXTRACT_V1',
      game: 'SCRABBLE',
      rack: rackResult.rack,
      board: boardResult.board,
      notes,
    },
  };
}

function buildScrabbleSummary(board) {
  const letters = [];
  let blankCount = 0;
  for (const tile of board.rack || []) {
    if (tile && tile.isBlank) {
      letters.push('_');
      blankCount += 1;
    } else if (tile && typeof tile.letter === 'string') {
      letters.push(tile.letter);
    }
  }
  return {
    rack: letters.join(''),
    rackCount: letters.length,
    blankCount,
  };
}

module.exports = {
  parseScrabble,
  buildScrabbleSummary,
};
