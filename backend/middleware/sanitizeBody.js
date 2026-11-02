const { config } = require('../config');
const { isPlainObject } = require('../utils/isPlainObject');

const SANITIZE_DEPTH_LIMIT = config.limits.sanitizeDepthLimit;
const DANGEROUS_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);
const sanitizeValue = (value, depth = 0) => {
  if (depth > SANITIZE_DEPTH_LIMIT) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      output[key] = sanitizeValue(item, depth + 1);
    }
    return output;
  }
  return value;
};
const sanitizeBody = (req, res, next) => {
  if (req.body !== undefined && req.body !== null) {
    req.body = sanitizeValue(req.body);
  }
  return next();
};

module.exports = { sanitizeBody };
