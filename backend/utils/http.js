const sendError = (res, status, message, options = {}) => {
  const payload = { error: message };

  if (options.code) {
    payload.code = options.code;
  }

  if (options.details && typeof options.details === 'object') {
    payload.details = options.details;
  }

  return res.status(status).json(payload);
};

module.exports = { sendError };
