const { stripCodeFences, isPlainObject } = require('./utils');
const { parseWordscapes, buildWordscapesSummary } = require('./wordscapes');
const { parseScrabble, buildScrabbleSummary } = require('./scrabble');

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

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON is not an object.',
      },
    };
  }

  if (typeof parsed.schema !== 'string' || typeof parsed.game !== 'string') {
    return {
      ok: false,
      error: {
        code: 'MODEL_OUTPUT_SCHEMA_INVALID',
        message: 'Model output JSON is missing required fields.',
      },
    };
  }

  if (parsed.schema === 'WORDVINDER_BOARD_EXTRACT_V4' && parsed.game === 'WORDSCAPES') {
    const result = parseWordscapes(parsed);
    if (result.ok) {
      return { ...result, rawPayload: parsed };
    }
    return result;
  }

  if (parsed.schema === 'WORDVINDER_SCRABBLE_EXTRACT_V1' && parsed.game === 'SCRABBLE') {
    const result = parseScrabble(parsed);
    if (result.ok) {
      return { ...result, rawPayload: parsed };
    }
    return result;
  }

  return {
    ok: false,
    error: {
      code: 'MODEL_OUTPUT_SCHEMA_INVALID',
      message: 'Model output JSON has an unsupported schema.',
    },
  };
}

function buildSummary(board) {
  if (board.game === 'SCRABBLE') {
    return buildScrabbleSummary(board);
  }
  return buildWordscapesSummary(board);
}

module.exports = {
  parseModelOutput,
  buildSummary,
};
