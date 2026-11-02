const path = require('path');
const { toInt } = require('../utils/number');

const normalizeOrigin = (value) =>
  value ? value.replace(/\/+$/, '') : value;

const allowVercelApps =
  String(process.env.CORS_ALLOW_VERCEL || '').toLowerCase() === 'true';
const defaultAllowedOrigins = [
  'https://switchgear-estimate-app.vercel.app',
  'https://switchgea-estimate-app.vercel.app',
].map(normalizeOrigin);
const envAllowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);
const allowedOrigins = Array.from(
  new Set([...defaultAllowedOrigins, ...envAllowedOrigins]),
);

const config = {
  port: process.env.PORT || 4000,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data.db'),
  attachmentStoragePath:
    process.env.ATTACHMENT_STORAGE_PATH ||
    path.join(__dirname, '..', 'attachments'),
  attachmentMaxFileSize: toInt(
    process.env.ATTACHMENT_MAX_FILE_SIZE,
    25 * 1024 * 1024,
  ),
  apiKey: process.env.API_KEY || process.env.ESTIMATE_TOOL_API_KEY || null,
  requireApiKey:
    String(process.env.REQUIRE_API_KEY || 'true').toLowerCase() !== 'false',
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
  limits: {
    sanitizeDepthLimit: toInt(process.env.SANITIZE_DEPTH_LIMIT, 6),
    maxStringLength: toInt(process.env.MAX_STRING_LENGTH, 10000),
    maxArrayLength: toInt(process.env.MAX_ARRAY_LENGTH, 1000),
    maxBackupItems: toInt(process.env.MAX_BACKUP_ITEMS, 5000),
  },
  rateLimit: {
    enabled:
      String(process.env.RATE_LIMIT_ENABLED || 'true').toLowerCase() !== 'false',
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    dayMax: toInt(process.env.RATE_LIMIT_DAY_MAX, 120),
    offHoursMax: toInt(process.env.RATE_LIMIT_OFF_HOURS_MAX, 20),
    offHoursStart: toInt(process.env.RATE_LIMIT_OFF_HOURS_START, 18),
    offHoursEnd: toInt(process.env.RATE_LIMIT_OFF_HOURS_END, 9),
  },
  cors: {
    allowVercelApps,
    allowedOrigins,
    normalizeOrigin,
  },
};

module.exports = { config };
