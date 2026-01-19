# Word Vinder API

Tiny Express server for Word Vinder. It serves the dictionary and can parse a screenshot via Dify Cloud (Gemini 2.5 Flash w/ Vision).

## Endpoints

### GET /api/v1/dictionary
Returns the dictionary JSON.

### POST /api/v1/board/parse-screenshot
Accepts a screenshot upload and returns parsed board state.

- Content-Type: `multipart/form-data`
- File field name: `image`
- Accepted types: `image/png`, `image/jpeg`, `image/webp`
- Max size: 5MB

Success response:
```json
{
  "ok": true,
  "board": {
    "letters": ["D","I","O","R","Y","H","T"],
    "solvedWords": ["DOT","ROT","TIDY"],
    "unsolvedSlots": [{"length": 4, "count": 1}]
  },
  "summary": {
    "letters": "D I O R Y H T",
    "remainingByLength": [{"length": 4, "count": 1}],
    "totalRemaining": 1
  }
}
```

Failure response:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_IMAGE",
    "message": "human readable",
    "details": "optional"
  }
}
```

## Environment variables

- `DIFY_BASE_URL` (default: `https://api.dify.ai`)
- `DIFY_API_KEY` (required)
- `DIFY_APP_ID` (optional; only needed if your Dify endpoint requires it)
- `DIFY_USER_ID` (optional; otherwise a stable anonymous id is generated)
- `DEBUG_MODEL_OUTPUT=1` (optional; includes raw model text in responses when `NODE_ENV` is not `production`)

## Curl example

```bash
curl -X POST http://localhost:3000/api/v1/board/parse-screenshot \
  -F "image=@/path/to/screenshot.png"
```
