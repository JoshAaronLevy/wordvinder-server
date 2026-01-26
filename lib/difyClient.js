const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://api.dify.ai';

function getEnvConfig() {
  return {
    baseUrl: process.env.DIFY_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.DIFY_API_KEY,
    appId: process.env.DIFY_APP_ID || null,
    userId: process.env.DIFY_USER_ID || null,
  };
}

function resolveUserId(requestContext) {
  const config = getEnvConfig();
  if (config.userId) {
    return config.userId;
  }

  const fingerprint = `${requestContext.ip || 'unknown'}|${requestContext.userAgent || 'unknown'}`;
  const hash = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 24);
  return `anon-${hash}`;
}

function ensureConfig() {
  const config = getEnvConfig();
  if (!config.apiKey) {
    const error = new Error('Missing DIFY_API_KEY');
    error.code = 'DIFY_ERROR';
    throw error;
  }
  return config;
}

function extractUploadId(responseJson) {
  if (responseJson && typeof responseJson.id === 'string') {
    return responseJson.id;
  }
  if (responseJson && responseJson.data && typeof responseJson.data.id === 'string') {
    return responseJson.data.id;
  }
  return null;
}

function extractModelText(responseJson) {
  if (!responseJson || typeof responseJson !== 'object') {
    return null;
  }

  if (typeof responseJson.answer === 'string') {
    return responseJson.answer;
  }

  if (typeof responseJson.output_text === 'string') {
    return responseJson.output_text;
  }

  const data = responseJson.data;
  if (!data || typeof data !== 'object') {
    return null;
  }

  if (typeof data.answer === 'string') {
    return data.answer;
  }

  if (typeof data.text === 'string') {
    return data.text;
  }

  if (data.outputs && typeof data.outputs === 'object') {
    if (typeof data.outputs.text === 'string') {
      return data.outputs.text;
    }

    if (typeof data.outputs.answer === 'string') {
      return data.outputs.answer;
    }

    for (const value of Object.values(data.outputs)) {
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
  }

  return null;
}

async function uploadFile({ baseUrl, apiKey, userId, fileBuffer, fileName, mimeType }) {
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append('file', blob, fileName);
  formData.append('user', userId);

  const response = await fetch(`${baseUrl}/v1/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const responseJson = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Dify file upload failed.');
    error.code = 'DIFY_ERROR';
    error.details = { status: response.status, body: responseJson };
    throw error;
  }

  const uploadId = extractUploadId(responseJson);
  if (!uploadId) {
    const error = new Error('Dify file upload response missing file id.');
    error.code = 'DIFY_ERROR';
    error.details = responseJson;
    throw error;
  }

  return uploadId;
}

async function runChatMessage({ baseUrl, apiKey, payload }) {
  const response = await fetch(`${baseUrl}/v1/chat-messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseJson = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Dify chat message failed.');
    error.code = 'DIFY_ERROR';
    error.details = { status: response.status, body: responseJson };
    throw error;
  }

  return responseJson;
}

function buildExtractionQuery(rawQuery) {
  if (typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return 'WORDSCAPES EXTRACT_BOARD_STATE_V4';
  }

  const trimmed = rawQuery.trim();
  const hasToken = /\b(WORDSCAPES|SCRABBLE)\b/i.test(trimmed);
  if (hasToken) {
    return trimmed.replace(/\s+/g, ' ');
  }

  return `WORDSCAPES ${trimmed.replace(/\s+/g, ' ')}`;
}

async function runBoardExtraction({ fileBuffer, fileName, mimeType, requestContext, query }) {
  const { baseUrl, apiKey, appId } = ensureConfig();
  const userId = resolveUserId(requestContext);

  const uploadId = await uploadFile({
    baseUrl,
    apiKey,
    userId,
    fileBuffer,
    fileName,
    mimeType,
  });

  const payload = {
    inputs: {},
    query: buildExtractionQuery(query),
    response_mode: 'blocking',
    user: userId,
    files: [
      {
        type: 'image',
        transfer_method: 'local_file',
        upload_file_id: uploadId,
      },
    ],
  };

  if (appId) {
    payload.app_id = appId;
  }

  const responseJson = await runChatMessage({
    baseUrl,
    apiKey,
    payload,
  });

  const modelText = extractModelText(responseJson);

  if (!modelText) {
    const error = new Error('Dify response missing model text.');
    error.code = 'DIFY_ERROR';
    error.details = responseJson;
    throw error;
  }

  return { modelText, rawResponse: responseJson };
}

async function runMarcoPing({ requestContext }) {
  const { baseUrl, apiKey, appId } = ensureConfig();
  const userId = resolveUserId(requestContext);
  const payload = {
    inputs: {},
    query: 'Marco',
    response_mode: 'blocking',
    user: userId,
  };

  if (appId) {
    payload.app_id = appId;
  }

  const responseJson = await runChatMessage({
    baseUrl,
    apiKey,
    payload,
  });

  const modelText = extractModelText(responseJson);
  if (!modelText) {
    const error = new Error('Dify response missing model text.');
    error.code = 'DIFY_ERROR';
    error.details = responseJson;
    throw error;
  }

  return { modelText, rawResponse: responseJson };
}

module.exports = {
  runBoardExtraction,
  runMarcoPing,
  resolveUserId,
};
