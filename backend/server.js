const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');

// backend/.env, 루트 .env 둘 다 시도해서 읽기 (backend/.env 우선)
const backendEnvPath = path.join(__dirname, '.env');
const rootEnvPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
}

const { config } = require('./config');
const { sendError } = require('./utils/http');
const { sanitizeBody } = require('./middleware/sanitizeBody');
const { rateLimiter } = require('./middleware/rateLimiter');
const { createApiKeyMiddleware } = require('./middleware/apiKey');
const { createApiRouter } = require('./routes/api');

// SQLite 초기화
const db = new Database(config.dbPath);

// --- DB 스키마 ---
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    client TEXT,
    data TEXT,
    revisions TEXT,
    memos TEXT,
    progress TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// --- Express 앱 설정 ---
const app = express();
const PORT = config.port;
const API_KEY = config.apiKey;
const REQUIRE_API_KEY = config.requireApiKey;

app.disable('x-powered-by');

// Allow Private Network Access preflight (Chrome/Edge).
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
const {
  allowVercelApps,
  allowedOrigins,
  normalizeOrigin,
} = config.cors;
const isVercelOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'vercel.app' || hostname.endsWith('.vercel.app');
  } catch (error) {
    return false;
  }
};
const isAllowedOrigin = (origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }
  if (allowVercelApps && isVercelOrigin(origin)) {
    return true;
  }
  return false;
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  }),
);
app.use(bodyParser.json({ limit: config.jsonBodyLimit }));
app.use(sanitizeBody);

app.use('/api', rateLimiter);

// --- 기본 페이지 ---
app.get('/', (req, res) => {
  res.send(
    '스위치기어 견적관리 백엔드 서버가 정상 동작 중입니다.',
  );
});

app.get('/estimate', (req, res) => {
  res.send(
    '스위치기어 견적관리 백엔드 서버가 정상 동작 중입니다. (/estimate 경로)',
  );
});

// API Key 미들웨어 (health 예외)
app.use(
  createApiKeyMiddleware({
    apiKey: API_KEY,
    requireApiKey: REQUIRE_API_KEY,
  }),
);

app.use('/api', createApiRouter({ db }));

app.use((req, res) => sendError(res, 404, 'Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'Malformed JSON');
  }

  console.error(err);
  return sendError(res, 500, 'Internal server error');
});

// --- 서버 실행 ---
const startServer = (port = PORT, host) =>
  app.listen(port, host, (err) => {
    if (err) {
      console.error('Failed to start backend server:', err);
      process.exit(1);
    }
    const hostLabel = host || 'localhost';
    console.log(`Backend server running on http://${hostLabel}:${port}`);
    console.log(`Database: SQLite (${config.dbPath})`);
  });

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
