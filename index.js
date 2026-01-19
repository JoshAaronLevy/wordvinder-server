const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { runBoardExtraction, runMarcoPing } = require('./lib/difyClient');
const { parseModelOutput, buildSummary } = require('./lib/boardState');

const app = express();
const PORT = process.env.PORT || 3000;

const dictionaryPath = path.join(__dirname, 'data', 'dictionary', 'full.json');
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
});

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
    const { modelText } = await runBoardExtraction({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname || 'screenshot',
      mimeType: req.file.mimetype,
      requestContext: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

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

    const summary = buildSummary(parsed.board);
    const response = {
      ok: true,
      board: parsed.board,
      summary,
    };

    if (process.env.DEBUG_MODEL_OUTPUT === '1' && process.env.NODE_ENV !== 'production') {
      response.debug = { modelText };
    }

    return res.json(response);
  } catch (err) {
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
    const { modelText } = await runMarcoPing({
      requestContext: {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
    });

    const normalized = modelText.trim().toLowerCase();
    if (!normalized.includes('polo')) {
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
