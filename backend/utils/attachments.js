const path = require('path');

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'zip', '7z', 'rar']);

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/octet-stream',
]);

const decodeMojibakeFilename = (value) => {
  const filename = String(value || '');
  if (!/[\u00c0-\u00ff]/.test(filename)) {
    return filename;
  }

  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  if (decoded.includes('\uFFFD')) {
    return filename;
  }

  return /[\uac00-\ud7af]/.test(decoded) ? decoded : filename;
};

const sanitizeOriginalFilename = (value) => {
  const basename = path.basename(decodeMojibakeFilename(value || 'attachment'));
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'attachment';
};

const sanitizeStorageSegment = (value) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 128) || 'project';

const getAttachmentExtension = (filename) =>
  path.extname(filename || '').replace('.', '').toLowerCase();

const isAllowedAttachmentFile = ({ originalname, mimetype } = {}) => {
  const extension = getAttachmentExtension(originalname);
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    return false;
  }
  if (!mimetype) {
    return true;
  }
  return ALLOWED_ATTACHMENT_MIME_TYPES.has(mimetype);
};

const normalizeAttachedFiles = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      typeof item.extension === 'string',
  );
};

module.exports = {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  sanitizeOriginalFilename,
  sanitizeStorageSegment,
  getAttachmentExtension,
  isAllowedAttachmentFile,
  normalizeAttachedFiles,
};
