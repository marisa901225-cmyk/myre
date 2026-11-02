const { config } = require('../config');
const { sendError } = require('../utils/http');

const {
  enabled: RATE_LIMIT_ENABLED,
  windowMs: rateLimitWindowMs,
  dayMax: rateLimitDayMax,
  offHoursMax: rateLimitOffHoursMax,
  offHoursStart: rateLimitOffHoursStart,
  offHoursEnd: rateLimitOffHoursEnd,
} = config.rateLimit;

const isOffHours = (date) => {
  const hour = date.getHours();
  if (rateLimitOffHoursStart < rateLimitOffHoursEnd) {
    return (
      hour >= rateLimitOffHoursStart &&
      hour < rateLimitOffHoursEnd
    );
  }
  return (
    hour >= rateLimitOffHoursStart ||
    hour < rateLimitOffHoursEnd
  );
};

const rateLimitBuckets = new Map();
const getRateLimitKey = (req) => {
  const ip = req.ip || 'unknown';
  const apiKey = req.headers['x-api-key'];
  if (apiKey && typeof apiKey === 'string') {
    return `${ip}|${apiKey}`;
  }
  return ip;
};
const rateLimiter = (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  if (!RATE_LIMIT_ENABLED) return next();

  const now = Date.now();
  const key = getRateLimitKey(req);
  const limit = isOffHours(new Date())
    ? rateLimitOffHoursMax
    : rateLimitDayMax;

  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + rateLimitWindowMs,
    });
    return next();
  }

  if (bucket.count >= limit) {
    const retryAfterSeconds = Math.ceil(
      (bucket.resetAt - now) / 1000,
    );
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return sendError(res, 429, 'Too many requests');
  }

  bucket.count += 1;
  return next();
};

module.exports = { rateLimiter };
