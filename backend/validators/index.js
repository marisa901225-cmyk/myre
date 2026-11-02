const { config } = require('../config');
const { sendError } = require('../utils/http');
const { isPlainObject } = require('../utils/isPlainObject');
const { ALLOWED_ATTACHMENT_EXTENSIONS } = require('../utils/attachments');

const {
  maxStringLength: MAX_STRING_LENGTH,
  maxArrayLength: MAX_ARRAY_LENGTH,
  maxBackupItems: MAX_BACKUP_ITEMS,
} = config.limits;

const requireJsonObjectBody = (req, res, next) => {
  if (req.body === undefined || req.body === null) {
    req.body = {};
    return next();
  }
  if (!isPlainObject(req.body)) {
    return sendError(res, 400, 'Body must be a JSON object');
  }
  return next();
};

const requireStringField =
  (field, { allowEmpty = false } = {}) =>
    (req, res, next) => {
      if (!isPlainObject(req.body)) {
        return sendError(res, 400, 'Body must be a JSON object');
      }

      const value = req.body[field];
      if (typeof value !== 'string') {
        return sendError(res, 400, `\`${field}\` must be a string`);
      }
      if (value.length > MAX_STRING_LENGTH) {
        return sendError(res, 400, `\`${field}\` is too long`);
      }
      if (!allowEmpty && value.trim().length === 0) {
        return sendError(res, 400, `\`${field}\` is required`);
      }
      return next();
    };

const getAttachedFilesError = (attachedFiles) => {
  if (attachedFiles === undefined) {
    return null;
  }
  if (!Array.isArray(attachedFiles)) {
    return '`attachedFiles` must be an array';
  }
  if (attachedFiles.length > MAX_ARRAY_LENGTH) {
    return '`attachedFiles` is too large';
  }

  for (const file of attachedFiles) {
    if (!isPlainObject(file)) {
      return '`attachedFiles` items must be objects';
    }

    const { id, name, size, type, extension, addedAt } = file;
    if (typeof id !== 'string' || id.length === 0) {
      return '`attachedFiles[].id` must be a string';
    }
    if (id.length > MAX_STRING_LENGTH) {
      return '`attachedFiles[].id` is too long';
    }
    if (typeof name !== 'string' || name.length === 0) {
      return '`attachedFiles[].name` must be a string';
    }
    if (name.length > MAX_STRING_LENGTH) {
      return '`attachedFiles[].name` is too long';
    }
    if (
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 0
    ) {
      return '`attachedFiles[].size` must be a non-negative number';
    }
    if (typeof type !== 'string') {
      return '`attachedFiles[].type` must be a string';
    }
    if (type.length > MAX_STRING_LENGTH) {
      return '`attachedFiles[].type` is too long';
    }
    if (
      typeof extension !== 'string' ||
      !ALLOWED_ATTACHMENT_EXTENSIONS.has(extension.toLowerCase())
    ) {
      return '`attachedFiles[].extension` is invalid';
    }
    if (typeof addedAt !== 'string') {
      return '`attachedFiles[].addedAt` must be a string';
    }
    if (addedAt.length > MAX_STRING_LENGTH) {
      return '`attachedFiles[].addedAt` is too long';
    }
  }

  return null;
};

const validateProjectBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return sendError(res, 400, 'Body must be a JSON object');
  }

  const {
    id,
    name,
    client,
    revisions,
    memos,
    progress,
    createdAt,
    updatedAt,
    data,
    attachedFiles,
  } = req.body;

  if (id !== undefined && typeof id !== 'string') {
    return sendError(res, 400, '`id` must be a string');
  }
  if (id !== undefined && id.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`id` is too long');
  }
  if (name !== undefined && typeof name !== 'string') {
    return sendError(res, 400, '`name` must be a string');
  }
  if (name !== undefined && name.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`name` is too long');
  }
  if (client !== undefined && typeof client !== 'string') {
    return sendError(res, 400, '`client` must be a string');
  }
  if (client !== undefined && client.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`client` is too long');
  }
  if (revisions !== undefined && !Array.isArray(revisions)) {
    return sendError(res, 400, '`revisions` must be an array');
  }
  if (Array.isArray(revisions) && revisions.length > MAX_ARRAY_LENGTH) {
    return sendError(res, 400, '`revisions` is too large');
  }
  if (memos !== undefined && !Array.isArray(memos)) {
    return sendError(res, 400, '`memos` must be an array');
  }
  if (Array.isArray(memos) && memos.length > MAX_ARRAY_LENGTH) {
    return sendError(res, 400, '`memos` is too large');
  }
  if (progress !== undefined && !isPlainObject(progress)) {
    return sendError(res, 400, '`progress` must be an object');
  }
  if (data !== undefined && !isPlainObject(data)) {
    return sendError(res, 400, '`data` must be an object');
  }
  const attachedFilesError = getAttachedFilesError(attachedFiles);
  if (attachedFilesError) {
    return sendError(res, 400, attachedFilesError);
  }
  const dataAttachedFilesError = getAttachedFilesError(
    data && data.attachedFiles,
  );
  if (dataAttachedFilesError) {
    return sendError(res, 400, dataAttachedFilesError);
  }
  if (createdAt !== undefined && typeof createdAt !== 'string') {
    return sendError(res, 400, '`createdAt` must be a string');
  }
  if (createdAt !== undefined && createdAt.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`createdAt` is too long');
  }
  if (updatedAt !== undefined && typeof updatedAt !== 'string') {
    return sendError(res, 400, '`updatedAt` must be a string');
  }
  if (updatedAt !== undefined && updatedAt.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`updatedAt` is too long');
  }

  return next();
};

const validateMemoBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return sendError(res, 400, 'Body must be a JSON object');
  }

  const { title, content } = req.body;
  if (title !== undefined && typeof title !== 'string') {
    return sendError(res, 400, '`title` must be a string');
  }
  if (title !== undefined && title.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`title` is too long');
  }
  if (content !== undefined && typeof content !== 'string') {
    return sendError(res, 400, '`content` must be a string');
  }
  if (content !== undefined && content.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`content` is too long');
  }

  return next();
};

const validateBackupRestoreBody = (req, res, next) => {
  const projects = req.body;
  if (!Array.isArray(projects)) {
    return sendError(res, 400, 'Invalid backup data');
  }
  if (projects.length > MAX_BACKUP_ITEMS) {
    return sendError(res, 400, 'Backup data is too large');
  }
  if (!projects.every((p) => isPlainObject(p))) {
    return sendError(res, 400, 'Invalid backup data');
  }
  if (
    !projects.every((p) => {
      const directError = getAttachedFilesError(p.attachedFiles);
      const dataError = getAttachedFilesError(
        p.data && p.data.attachedFiles,
      );
      return !directError && !dataError;
    })
  ) {
    return sendError(res, 400, 'Invalid attachment metadata');
  }
  return next();
};

const validateLedgerNameRenameBody = (req, res, next) => {
  if (!isPlainObject(req.body)) {
    return sendError(res, 400, 'Body must be a JSON object');
  }

  const { from, to, dryRun } = req.body;
  if (typeof from !== 'string' || from.trim().length === 0) {
    return sendError(res, 400, '`from` is required');
  }
  if (from.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`from` is too long');
  }
  if (typeof to !== 'string' || to.trim().length === 0) {
    return sendError(res, 400, '`to` is required');
  }
  if (to.length > MAX_STRING_LENGTH) {
    return sendError(res, 400, '`to` is too long');
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') {
    return sendError(res, 400, '`dryRun` must be a boolean');
  }

  return next();
};

module.exports = {
  requireJsonObjectBody,
  requireStringField,
  validateProjectBody,
  validateMemoBody,
  validateBackupRestoreBody,
  validateLedgerNameRenameBody,
};
