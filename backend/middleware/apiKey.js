const { sendError } = require('../utils/http');

const createApiKeyMiddleware = ({
  apiKey,
  requireApiKey,
  healthPath = '/api/health',
} = {}) => {
  return (req, res, next) => {
    const logAuthFailure = (reason) => {
      console.warn('[auth] API key rejected', {
        reason,
        method: req.method,
        path: req.originalUrl || req.url,
        origin: req.headers.origin || null,
        ip: req.ip || req.socket?.remoteAddress || null,
      });
    };

    if (req.method === 'OPTIONS') return next();
    if (req.method === 'GET' && req.path === healthPath) return next();
    if (!requireApiKey) return next();
    if (!apiKey) {
      return sendError(res, 503, 'API key is not configured', {
        code: 'api_key_not_configured',
      });
    }

    const headerKey = req.headers['x-api-key'];
    if (!headerKey) {
      logAuthFailure('missing');
      return sendError(res, 401, 'API key is required', {
        code: 'api_key_missing',
      });
    }

    if (headerKey === apiKey) {
      return next();
    }

    logAuthFailure('invalid');
    return sendError(res, 401, 'API key is invalid', {
      code: 'api_key_invalid',
    });
  };
};

module.exports = { createApiKeyMiddleware };
