const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Duplex } = require('node:stream');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tempDbPath = path.join(
  os.tmpdir(),
  `switchgear-test-limits-${Date.now()}.db`,
);

process.env.API_KEY = 'limit-test-key';
process.env.REQUIRE_API_KEY = 'true';
process.env.DB_PATH = tempDbPath;
process.env.MAX_STRING_LENGTH = '5';
process.env.MAX_ARRAY_LENGTH = '2';
process.env.MAX_BACKUP_ITEMS = '2';

const { app } = require('../server');

const createMockRequest = ({ method, path: reqPath, body, headers }) => {
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const req = new http.IncomingMessage(socket);
  req.method = method;
  req.url = reqPath;
  req.headers = headers || {};

  const res = new http.ServerResponse(req);
  res.assignSocket(socket);

  let data = '';
  const originalWrite = res.write;
  res.write = function (chunk, ...args) {
    data += chunk;
    return originalWrite.call(this, chunk, ...args);
  };
  const originalEnd = res.end;
  res.end = function (chunk, ...args) {
    if (chunk) data += chunk;
    return originalEnd.call(this, chunk, ...args);
  };

  if (body) {
    const payload = JSON.stringify(body);
    req.push(payload);
  }
  req.push(null);

  return { req, res, getBody: () => data };
};

const requestJson = ({ method, path: reqPath, body, headers }) =>
  new Promise((resolve) => {
    const finalHeaders = { ...(headers || {}) };
    if (body) {
      const payload = JSON.stringify(body);
      finalHeaders['content-type'] = 'application/json';
      finalHeaders['content-length'] = Buffer.byteLength(payload);
    }

    const { req, res, getBody } = createMockRequest({
      method,
      path: reqPath,
      body,
      headers: finalHeaders,
    });

    res.on('finish', () => {
      const raw = getBody();
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          parsed = raw;
        }
      }
      resolve({ status: res.statusCode, body: parsed });
    });

    app.handle(req, res);
  });
const headers = { 'x-api-key': 'limit-test-key' };

after(async () => {
  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
});

test('rejects project name exceeding max string length', async () => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/projects',
    headers,
    body: { name: '123456', client: 'A' },
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, '`name` is too long');
});

test('rejects revisions exceeding max array length', async () => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/projects',
    headers,
    body: {
      name: 'Test',
      client: 'A',
      revisions: [{}, {}, {}],
    },
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, '`revisions` is too large');
});

test('rejects backup restore exceeding max items', async () => {
  const res = await requestJson({
    method: 'POST',
    path: '/api/backup/projects',
    headers,
    body: [{ id: '1' }, { id: '2' }, { id: '3' }],
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'Backup data is too large');
});
