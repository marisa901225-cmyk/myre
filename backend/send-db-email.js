const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const { execSync } = require('child_process');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error(
    '[send-db-email] better-sqlite3 모듈을 찾을 수 없습니다. backend 폴더에서 "npm install"을 실행해 주세요.',
  );
  process.exit(1);
}

// xlsx는 엑셀 기능 켰을 때만 로드 (DB만 백업할 때 xlsx 없어도 동작)
let XLSX = null;
const loadXlsx = () => {
  if (XLSX) return XLSX;
  XLSX = require('xlsx');
  return XLSX;
};

// backend/.env, 루트 .env 둘 다 시도해서 읽기
const backendEnvPath = path.join(__dirname, '.env');
const rootEnvPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath });

if (fs.existsSync(backendEnvPath)) {
  const envConfig = dotenv.parse(fs.readFileSync(backendEnvPath));
  for (const k in envConfig) process.env[k] = envConfig[k];
}

const safeParseJson = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const mapRowToProject = (row) => {
  const data = safeParseJson(row.data, {});
  const revisions = safeParseJson(row.revisions, []);
  const memos = safeParseJson(row.memos, []);
  const progress = safeParseJson(row.progress, {});

  return {
    ...data,
    id: row.id,
    name: row.name || data.name || '',
    client: row.client || data.client || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revisions,
    memos,
    progress,
  };
};

const getKstDateStr = (d = new Date()) => {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD
};

const createExcelBackupFromDb = (dbPath, dateStr) => {
  const XLSXLocal = loadXlsx();
  const db = new Database(dbPath, { readonly: true });

  try {
    const stmt = db.prepare('SELECT * FROM projects');
    const rows = stmt.all();
    const projects = rows.map(mapRowToProject);

    const workbook = XLSXLocal.utils.book_new();

    const sheetData = projects.map((p) => ({
      상태: p.status || '',
      프로젝트명: p.name || '',
      발주처: p.client || '',
      소속대장: p.ledgerName || '',
      영업담당: p.salesRep || '',
      설계담당: p.manager || '',
      계약금액: p.contractAmount || 0,
      최종실행원가: p.finalCost || 0,
      생성일: p.createdAt ? String(p.createdAt).slice(0, 10) : '',
      최근수정: p.updatedAt ? String(p.updatedAt).slice(0, 10) : '',
    }));

    const worksheet =
      sheetData.length > 0
        ? XLSXLocal.utils.json_to_sheet(sheetData)
        : XLSXLocal.utils.aoa_to_sheet([
          [
            '상태',
            '프로젝트명',
            '발주처',
            '소속대장',
            '영업담당',
            '설계담당',
            '계약금액',
            '최종실행원가',
            '생성일',
            '최근수정',
          ],
        ]);

    XLSXLocal.utils.book_append_sheet(workbook, worksheet, '프로젝트목록');

    const excelFilename = `프로젝트목록_${dateStr}.xlsx`;
    const excelPath = path.join(__dirname, excelFilename);

    XLSXLocal.writeFile(workbook, excelPath);
    return excelPath;
  } finally {
    db.close();
  }
};

// --- Dropbox Helpers ---
async function getDropboxAccessToken(appKey, appSecret, refreshToken) {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  params.append('client_id', appKey);
  params.append('client_secret', appSecret);

  const response = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh Dropbox token: ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function uploadToDropbox(accessToken, localPath, remotePath) {
  const fileContent = fs.readFileSync(localPath);

  const args = { path: remotePath, mode: 'add', autorename: true, mute: false };
  const apiArgsString = JSON.stringify(args).replace(/[\u007f-\uffff]/g, (c) => {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': apiArgsString,
      'Content-Type': 'application/octet-stream',
    },
    body: fileContent,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed for ${remotePath}: ${text}`);
  }

  const result = await response.json();
  console.log('[Dropbox] 업로드 성공:', result.path_display);
}

/**
 * 오래된 백업 파일 정리 (기본 14일)
 */
function cleanupOldFiles(directory, daysToKeep = 14) {
  const now = Date.now();
  const threshold = daysToKeep * 24 * 60 * 60 * 1000;

  console.log(`[cleanup] ${daysToKeep}일 이상 된 파일 정리 중...`);

  const files = fs.readdirSync(directory);
  files.forEach((file) => {
    // data-*.db.gz 또는 프로젝트목록_*.xlsx 형식 확인
    const isBackupFile = /^data-.*\.db\.gz$/.test(file) || /^프로젝트목록_.*\.xlsx$/.test(file);
    if (!isBackupFile) return;

    const filePath = path.join(directory, file);
    try {
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;

      if (fileAge > threshold) {
        fs.unlinkSync(filePath);
        console.log(`[cleanup] 삭제됨: ${file}`);
      }
    } catch (err) {
      console.error(`[cleanup] 파일 확인 실패 (${file}):`, err.message);
    }
  });
}

async function main() {
  const dbPath = path.join(__dirname, 'data.db');
  if (!fs.existsSync(dbPath)) {
    console.error('[send-db-email] data.db 파일을 찾을 수 없습니다:', dbPath);
    process.exit(1);
  }

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    MAIL_FROM,
    MAIL_TO,
    DROPBOX_APP_KEY,
    DROPBOX_APP_SECRET,
    DROPBOX_REFRESH_TOKEN,
  } = process.env;

  // --- 옵션 스위치 ---
  const args = new Set(process.argv.slice(2));

  const ENABLE_EMAIL = !(args.has('--no-email') || process.env.SEND_EMAIL === '0');
  const ENABLE_DROPBOX = !(args.has('--no-dropbox') || process.env.SEND_DROPBOX === '0');
  const ENABLE_EXCEL = !(args.has('--no-excel') || process.env.SEND_EXCEL === '0');

  const hasEmailConfig = SMTP_HOST && SMTP_USER && SMTP_PASS && MAIL_FROM && MAIL_TO;
  const hasDropboxConfig = DROPBOX_APP_KEY && DROPBOX_APP_SECRET && DROPBOX_REFRESH_TOKEN;

  const now = new Date();
  const dateStr = getKstDateStr(now);

  // 1) Safe DB Backup & Compress
  const backupDbName = `data-${dateStr}.db`;
  const backupDbPath = path.join(__dirname, backupDbName);
  const compressedDbPath = `${backupDbPath}.gz`;

  try {
    console.log('[send-db-email] DB 백업 및 압축 시작...');
    const db = new Database(dbPath);
    await db.backup(backupDbPath);
    db.close();

    // gzip -f로 덮어쓰기
    execSync(`gzip -f "${backupDbPath}"`);
    console.log('[send-db-email] DB 압축 완료:', path.basename(compressedDbPath));
  } catch (e) {
    console.error('[send-db-email] DB 백업/압축 실패:', e);
    // 스냅샷/압축이 없으면 작업 실패로 표시
    if (!fs.existsSync(compressedDbPath) && !fs.existsSync(backupDbPath)) {
      process.exitCode = 1;
    }
  }

  // DB 아티팩트 선택: 압축본 > 스냅샷 > (최후) 원본
  const dbArtifactPath = fs.existsSync(compressedDbPath)
    ? compressedDbPath
    : (fs.existsSync(backupDbPath) ? backupDbPath : dbPath);

  const dbArtifactName = fs.existsSync(compressedDbPath)
    ? `data-${dateStr}.db.gz`
    : (fs.existsSync(backupDbPath) ? `data-${dateStr}.db` : 'data.db');

  // 2) Excel Generation (옵션)
  let excelPath = null;
  if (ENABLE_EXCEL) {
    try {
      excelPath = createExcelBackupFromDb(dbPath, dateStr);
      console.log('[send-db-email] 엑셀 백업 생성 완료:', path.basename(excelPath));
    } catch (e) {
      console.error('[send-db-email] 엑셀 백업 생성 오류(계속 진행):', e);
    }
  } else {
    console.log('[send-db-email] 엑셀 생성 비활성화됨.');
  }

  // 3) Email
  if (ENABLE_EMAIL && hasEmailConfig) {
    const port = Number(SMTP_PORT) || 587;
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    // 엑셀 파일만 첨부 (DB는 드롭박스 링크로 대체)
    const attachments = [];
    if (excelPath && fs.existsSync(excelPath)) {
      attachments.push({ filename: path.basename(excelPath), path: excelPath });
    }

    // 드롭박스 고정 링크 사용
    const dbSharedLink =
      process.env.DROPBOX_SHARED_LINK ||
      'https://www.dropbox.com/scl/fo/cqqfxn1uwj88ednqfceph/AOVR2hSnAxjdBoAGiCcjUo8?rlkey=9z13ub050tt2kl14puqalu9so&st=s4wr97a2&dl=0';

    try {
      const emailText =
        '스위치기어 견적관리 툴의 백업 보고서입니다.\n\n' +
        `보낸 시각(KST): ${now.toLocaleString('ko-KR')}\n` +
        (excelPath ? `엑셀 파일: ${path.basename(excelPath)} (첨부됨)\n` : '') +
        `DB 백업 폴더: ${dbSharedLink}\n` +
        '\n첨부된 엑셀 파일을 확인해 주세요. DB 파일은 위 드롭박스 공유 폴더 링크를 통해 접근 가능합니다.\n';

      const info = await transporter.sendMail({
        from: MAIL_FROM,
        to: MAIL_TO,
        subject: `[Switchgear] 주간 DB 백업 보고 (${dateStr})`,
        text: emailText,
        attachments,
      });
      console.log('[send-db-email] 메일 전송 성공:', info.messageId);
    } catch (err) {
      console.error('[send-db-email] 메일 전송 실패:', err);
      process.exitCode = 1;
    }
  } else {
    if (!ENABLE_EMAIL) console.log('[send-db-email] 이메일 전송 비활성화됨.');
    else console.log('[send-db-email] 이메일 설정이 없어 메일 전송을 건너뜁니다.');
  }

  // 4) Dropbox
  if (ENABLE_DROPBOX && hasDropboxConfig) {
    try {
      console.log('[Dropbox] 토큰 갱신 중...');
      const dropboxToken = await getDropboxAccessToken(
        DROPBOX_APP_KEY,
        DROPBOX_APP_SECRET,
        DROPBOX_REFRESH_TOKEN,
      );

      console.log('[Dropbox] 파일 업로드 시작...');
      await uploadToDropbox(
        dropboxToken,
        dbArtifactPath,
        `/switchgear-db-backup/${dbArtifactName}`,
      );

      if (excelPath && fs.existsSync(excelPath)) {
        await uploadToDropbox(
          dropboxToken,
          excelPath,
          `/switchgear-db-backup/${path.basename(excelPath)}`,
        );
      }
    } catch (err) {
      console.error('[Dropbox] 업로드 실패:', err);
      process.exitCode = 1;
    }
  } else {
    if (!ENABLE_DROPBOX) console.log('[Dropbox] 업로드 비활성화됨.');
    else console.log('[Dropbox] 드롭박스 설정이 없어 업로드를 건너뜁니다.');
  }

  // 5) Cleanup
  cleanupOldFiles(__dirname, 14);
}

main().catch((e) => {
  console.error('[send-db-email] 치명적 오류:', e);
  process.exitCode = 1;
});
