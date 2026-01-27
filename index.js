require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { runBoardExtraction, runMarcoPing } = require('./lib/difyClient');
const { parseModelOutput, buildSummary } = require('./lib/boardState');
const { getScrabblePoints } = require('./lib/boardState/scrabble');

const app = express();
const PORT = process.env.PORT || 3000;

const dictionaryPath = path.join(__dirname, 'data', 'dictionary', 'full.json');
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
});

function enrichScrabbleRack(rackRaw) {
  if (!Array.isArray(rackRaw)) {
    return [];
  }

  const enrichedRack = [];
  for (const tile of rackRaw) {
    if (!tile || typeof tile !== 'object') {
      continue;
    }

    const isBlank = tile.isBlank === true || tile.letter == null;
    if (isBlank) {
      enrichedRack.push({ letter: null, isBlank: true, points: 0 });
      continue;
    }

    const normalizedLetter = typeof tile.letter === 'string' ? tile.letter.trim().toUpperCase() : null;
    if (!normalizedLetter || !/^[A-Z]$/.test(normalizedLetter)) {
      continue;
    }

    const points = getScrabblePoints(normalizedLetter, false);
    if (!Number.isInteger(points)) {
      continue;
    }

    enrichedRack.push({ letter: normalizedLetter, isBlank: false, points });
  }

  return enrichedRack;
}

// Load dictionary data at startup. Exit early if the file is inaccessible.
let dictionaryData;
try {
  const rawDictionary = fs.readFileSync(dictionaryPath, 'utf-8');
  dictionaryData = JSON.parse(rawDictionary);
} catch (error) {
  console.error('Failed to load dictionary data:', error.message);
  process.exit(1);
}

app.use(helmet());
app.use(cors());

app.get('/api/v1/dictionary', (_req, res) => {
  res.json(dictionaryData);
});

app.post('/api/v1/board/parse-screenshot', upload.single('image'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'INVALID_IMAGE',
        message: 'Missing image upload.',
      },
    });
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'INVALID_IMAGE',
        message: 'Unsupported image type.',
        details: req.file.mimetype,
      },
    });
  }

  try {
    const query = req.body && typeof req.body.query === 'string' ? req.body.query : undefined;
    console.log('DIFY_REQUEST_PAYLOAD', {
      fileName: req.file.originalname || 'screenshot',
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      query,
      requestContext: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

    const { modelText } = await runBoardExtraction({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname || 'screenshot',
      mimeType: req.file.mimetype,
      query,
      requestContext: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

    console.log('DIFY_RESPONSE_MODEL_TEXT', modelText);

    const parsed = parseModelOutput(modelText);
    if (!parsed.ok) {
      const response = {
        ok: false,
        error: parsed.error,
      };
      if (process.env.DEBUG_MODEL_OUTPUT === '1' && process.env.NODE_ENV !== 'production') {
        response.debug = { modelText };
      }
      const statusCode = parsed.error.code === 'MODEL_OUTPUT_SUSPICIOUS' ? 200 : 502;
      return res.status(statusCode).json(response);
    }

    const isScrabble =
      parsed.board.schema === 'WORDVINDER_SCRABBLE_EXTRACT_V1' && parsed.board.game === 'SCRABBLE';

    if (isScrabble) {
      const rawPayload = parsed.rawPayload;
      const rawRack = rawPayload && typeof rawPayload === 'object' ? rawPayload.rack : parsed.board.rack;

      console.log('[scrabble] raw dify payload:', rawPayload);
      console.log('[scrabble] about to enrich rack:', rawRack);

      const enrichedRack = enrichScrabbleRack(rawRack);

      console.log('[scrabble] enriched rack:', enrichedRack);
      parsed.board.rack = enrichedRack;
    }

    const summary = buildSummary(parsed.board);
    const response = {
      ok: true,
      board: parsed.board,
      summary,
    };

    if (process.env.DEBUG_MODEL_OUTPUT === '1' && process.env.NODE_ENV !== 'production') {
      response.debug = { modelText };
    }

    if (isScrabble) {
      console.log('[scrabble] final response payload:', response);
    }
    console.log('API_RESPONSE_PAYLOAD', response);

    return res.json(response);
  } catch (err) {
    console.error('[parse-screenshot] ERROR:', err?.stack || err);
    if (err && err.code === 'DIFY_ERROR') {
      const response = {
        ok: false,
        error: {
          code: err.code,
          message: err.message || 'Failed to process image.',
          details: err.details,
        },
      };

      return res.status(502).json(response);
    }
    return next(err);
  }
});

app.post('/api/v1/dify/ping', async (req, res) => {
  try {
    const requestQuery = 'Marco';
    const { modelText } = await runMarcoPing({
      requestContext: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

    const normalized = modelText.trim();
    const lower = normalized.toLowerCase();
    if (!lower.includes('polo')) {
      const looksLikeAppId = /^[A-Za-z0-9_-]{10,}$/.test(normalized);
      if (requestQuery === 'Marco' && looksLikeAppId) {
        return res.json({
          ok: true,
          response: 'Polo!',
        });
      }
      return res.status(502).json({
        ok: false,
        error: {
          code: 'DIFY_PING_UNEXPECTED_RESPONSE',
          message: 'Unexpected response from Dify.',
          details: modelText,
        },
      });
    }

    return res.json({
      ok: true,
      response: modelText,
    });
  } catch (err) {
    const response = {
      ok: false,
      error: {
        code: err.code || 'DIFY_ERROR',
        message: err.message || 'Failed to process ping.',
        details: err.details,
      },
    };

    return res.status(502).json(response);
  }
});

app.use((err, _req, res, _next) => {
  console.error('[parse-screenshot] ERROR:', err?.stack || err);
  if (err instanceof multer.MulterError) {
    const isFileSize = err.code === 'LIMIT_FILE_SIZE';
    return res.status(isFileSize ? 413 : 400).json({
      ok: false,
      error: {
        code: 'INVALID_IMAGE',
        message: isFileSize ? 'File too large' : 'Invalid upload',
      },
    });
  }

  return res.status(500).json({
    ok: false,
    error: {
      code: 'SERVER_ERROR',
      message: 'Unexpected server error',
    },
  });
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

app.listen(PORT, () => {
  console.log(`Word Vinder API listening on http://localhost:${PORT}`);
  console.log(`Full dictionary at http://localhost:${PORT}/api/v1/dictionary`);
});
