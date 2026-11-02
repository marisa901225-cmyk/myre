const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { config } = require('../config');
const { safeParseJson } = require('../utils/parse');
const {
  mapRowToProject,
  buildDbFieldsFromProject,
} = require('../utils/projectMapper');
const {
  sanitizeOriginalFilename,
  sanitizeStorageSegment,
  getAttachmentExtension,
  isAllowedAttachmentFile,
  normalizeAttachedFiles,
} = require('../utils/attachments');
const {
  requireJsonObjectBody,
  requireStringField,
  validateProjectBody,
  validateMemoBody,
  validateBackupRestoreBody,
  validateLedgerNameRenameBody,
} = require('../validators');

const createApiRouter = ({ db } = {}) => {
  if (!db) {
    throw new Error('Database instance is required');
  }

  const DEFAULT_COMPANY_SETTINGS = {
    companies: ['골드텍', '한양기전공업', '한양기전', '새봄엔지니어링', '기타'],
    companyAliases: {},
    hiddenCompanies: [],
  };
  const COMPANY_SETTINGS_KEY = 'company-settings';

  const router = express.Router();
  const selectProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const updateProjectStmt = db.prepare(`
    UPDATE projects
    SET name = @name,
        client = @client,
        data = @data,
        revisions = @revisions,
        memos = @memos,
        progress = @progress,
        createdAt = @createdAt,
        updatedAt = @updatedAt
    WHERE id = @id
  `);
  const selectSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsertSettingStmt = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const normalizeStringArray = (value) => {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  };

  const normalizeAliases = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([ledgerName, companyName]) =>
            typeof ledgerName === 'string' &&
            ledgerName.trim() &&
            typeof companyName === 'string' &&
            companyName.trim(),
        )
        .map(([ledgerName, companyName]) => [
          ledgerName.trim(),
          companyName.trim(),
        ]),
    );
  };

  const normalizeCompanySettings = (value = {}) => {
    const companies = normalizeStringArray(value.companies);
    return {
      companies: Array.from(
        new Set([
          ...(companies.length ? companies : DEFAULT_COMPANY_SETTINGS.companies),
          ...DEFAULT_COMPANY_SETTINGS.companies,
        ]),
      ),
      companyAliases: normalizeAliases(value.companyAliases),
      hiddenCompanies: normalizeStringArray(value.hiddenCompanies),
    };
  };

  const loadCompanySettings = () => {
    const row = selectSettingStmt.get(COMPANY_SETTINGS_KEY);
    if (!row || !row.value) {
      return normalizeCompanySettings();
    }

    return normalizeCompanySettings(safeParseJson(row.value, {}));
  };

  const saveCompanySettings = (settings) => {
    const normalized = normalizeCompanySettings(settings);
    upsertSettingStmt.run({
      key: COMPANY_SETTINGS_KEY,
      value: JSON.stringify(normalized),
    });
    return normalized;
  };

  const persistProject = (project) => {
    const dbProject = buildDbFieldsFromProject({
      ...project,
      updatedAt: new Date().toISOString(),
    });
    updateProjectStmt.run(dbProject);
    return mapRowToProject(selectProjectStmt.get(project.id));
  };

  const getProjectAttachmentDir = (projectId) =>
    path.join(
      config.attachmentStoragePath,
      sanitizeStorageSegment(projectId),
    );

  const loadProject = (req, res, next) => {
    const row = selectProjectStmt.get(req.params.id || req.params.projectId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    req.project = mapRowToProject(row);
    return next();
  };

  const attachmentStorage = multer.diskStorage({
    destination(req, file, cb) {
      const projectDir = getProjectAttachmentDir(req.project.id);
      fs.mkdirSync(projectDir, { recursive: true });
      cb(null, projectDir);
    },
    filename(req, file, cb) {
      const attachmentId = crypto.randomUUID();
      const extension = getAttachmentExtension(file.originalname);
      file.attachmentId = attachmentId;
      cb(null, `${attachmentId}.${extension}`);
    },
  });

  const uploadAttachments = multer({
    storage: attachmentStorage,
    limits: {
      fileSize: config.attachmentMaxFileSize,
      files: config.limits.maxArrayLength,
    },
    fileFilter(req, file, cb) {
      if (!isAllowedAttachmentFile(file)) {
        const error = new Error('Unsupported attachment type');
        error.status = 400;
        return cb(error);
      }
      return cb(null, true);
    },
  }).array('files');

  const handleAttachmentUpload = (req, res, next) => {
    uploadAttachments(req, res, (error) => {
      if (!error) return next();

      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: `Attachment exceeds max size of ${config.attachmentMaxFileSize} bytes`,
          });
        }
        return res.status(400).json({ error: error.message });
      }

      return res
        .status(error.status || 500)
        .json({ error: error.message || 'Attachment upload failed' });
    });
  };

  const syncContractAmountWithLatestRevision = (project, revisions) => {
    const latestRevision = revisions[revisions.length - 1];

    return {
      ...project,
      revisions,
      contractAmount:
        latestRevision?.amount ?? project.contractAmount ?? 0,
    };
  };

  // 1. Health Check
  router.get('/health', (req, res) =>
    res.json({ status: 'ok', db: 'sqlite' }),
  );

  // 2. API Key Verification
  router.get('/verify-key', (req, res) =>
    res.json({ valid: true }),
  );

  router.get('/settings/company-settings', (req, res) => {
    res.json(loadCompanySettings());
  });

  router.put(
    '/settings/company-settings',
    requireJsonObjectBody,
    (req, res) => {
      res.json(saveCompanySettings(req.body));
    },
  );

  // 3. 프로젝트 목록 조회
  router.get('/projects', (req, res) => {
    const stmt = db.prepare('SELECT * FROM projects');
    const rows = stmt.all();
    const projects = rows.map(mapRowToProject);
    res.json(projects);
  });

  // 4. 프로젝트 생성
  router.post(
    '/projects',
    requireJsonObjectBody,
    validateProjectBody,
    (req, res) => {
      const dbProject = buildDbFieldsFromProject(req.body || {});

      const stmt = db.prepare(`
    INSERT INTO projects (id, name, client, data, revisions, memos, progress, createdAt, updatedAt)
    VALUES (@id, @name, @client, @data, @revisions, @memos, @progress, @createdAt, @updatedAt)
  `);

      stmt.run(dbProject);

      res.json({ success: true, id: dbProject.id });
    },
  );

  // 5. 프로젝트 상세 조회
  router.get('/projects/:id', (req, res) => {
    const row = selectProjectStmt.get(req.params.id);

    if (!row) {
      return res.status(404).json({ error: 'Not found' });
    }

    const project = mapRowToProject(row);
    res.json(project);
  });

  // 6. 프로젝트 수정
  router.put(
    '/projects/:id',
    requireJsonObjectBody,
    validateProjectBody,
    (req, res) => {
      const row = selectProjectStmt.get(req.params.id);

      if (!row) {
        return res.status(404).json({ error: 'Not found' });
      }

      const existing = mapRowToProject(row);
      const updated = {
        ...existing,
        ...req.body,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };

      const dbProject = buildDbFieldsFromProject(updated);
      updateProjectStmt.run(dbProject);
      res.json({ success: true });
    },
  );

  // 7. 프로젝트 삭제
  router.delete('/projects/:id', (req, res) => {
    const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  });

  // 7-1. 프로젝트 첨부파일 업로드
  router.post(
    '/projects/:id/attachments',
    loadProject,
    handleAttachmentUpload,
    (req, res) => {
      const uploadedFiles = req.files || [];
      if (uploadedFiles.length === 0) {
        return res.status(400).json({ error: '`files` is required' });
      }

      const attachedFiles = [
        ...normalizeAttachedFiles(req.project.attachedFiles),
        ...uploadedFiles.map((file) => {
          const name = sanitizeOriginalFilename(file.originalname);
          return {
            id: file.attachmentId,
            name,
            size: file.size,
            type: file.mimetype || 'application/octet-stream',
            extension: getAttachmentExtension(name),
            addedAt: new Date().toISOString(),
          };
        }),
      ];

      const updatedProject = persistProject({
        ...req.project,
        attachedFiles,
      });
      return res.json(updatedProject);
    },
  );

  // 7-2. 프로젝트 첨부파일 다운로드
  router.get(
    '/projects/:id/attachments/:attachmentId',
    loadProject,
    (req, res) => {
      const attachment = normalizeAttachedFiles(
        req.project.attachedFiles,
      ).find((file) => file.id === req.params.attachmentId);

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const extension = getAttachmentExtension(attachment.name);
      if (extension !== attachment.extension.toLowerCase()) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const projectDir = getProjectAttachmentDir(req.project.id);
      const filePath = path.join(projectDir, `${attachment.id}.${extension}`);
      if (!filePath.startsWith(projectDir + path.sep)) {
        return res.status(400).json({ error: 'Invalid attachment path' });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Attachment file not found' });
      }

      return res.download(filePath, attachment.name);
    },
  );

  // 7-3. 프로젝트 첨부파일 삭제
  router.delete(
    '/projects/:id/attachments/:attachmentId',
    loadProject,
    (req, res) => {
      const attachedFiles = normalizeAttachedFiles(
        req.project.attachedFiles,
      );
      const attachment = attachedFiles.find(
        (file) => file.id === req.params.attachmentId,
      );

      if (!attachment) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const projectDir = getProjectAttachmentDir(req.project.id);
      const extension = attachment.extension.toLowerCase();
      const filePath = path.join(projectDir, `${attachment.id}.${extension}`);
      if (filePath.startsWith(projectDir + path.sep)) {
        fs.rmSync(filePath, { force: true });
      }

      const updatedProject = persistProject({
        ...req.project,
        attachedFiles: attachedFiles.filter(
          (file) => file.id !== req.params.attachmentId,
        ),
      });
      return res.json(updatedProject);
    },
  );

  // --- 리비전 API ---

  // 8. 리비전 추가
  router.post(
    '/projects/:id/revisions',
    requireJsonObjectBody,
    (req, res) => {
      const row = selectProjectStmt.get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const project = mapRowToProject(row);
      const revisions = [...(project.revisions || [])];
      const newRevision = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
      };
      revisions.push(newRevision);

      const updatedProject = persistProject(
        syncContractAmountWithLatestRevision(project, revisions),
      );
      res.json(updatedProject);
    },
  );

  // 9. 리비전 수정
  router.put(
    '/projects/:projectId/revisions/:revisionId',
    requireJsonObjectBody,
    (req, res) => {
      const row = selectProjectStmt.get(req.params.projectId);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const project = mapRowToProject(row);
      let revisions = [...(project.revisions || [])];
      revisions = revisions.map((r) =>
        r.id === req.params.revisionId ? { ...r, ...req.body } : r,
      );

      const updatedProject = persistProject(
        syncContractAmountWithLatestRevision(project, revisions),
      );
      res.json(updatedProject);
    },
  );

  // 17. 리비전 삭제
  router.delete(
    '/projects/:projectId/revisions/:revisionId',
    (req, res) => {
      const row = selectProjectStmt.get(req.params.projectId);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const project = mapRowToProject(row);
      let revisions = [...(project.revisions || [])];
      revisions = revisions.filter((r) => r.id !== req.params.revisionId);

      const updatedProject = persistProject(
        syncContractAmountWithLatestRevision(project, revisions),
      );
      res.json(updatedProject);
    },
  );

  // --- 상태/진행 API ---

  // 10. 상태 업데이트
  router.put(
    '/projects/:id/status',
    requireJsonObjectBody,
    requireStringField('status', { allowEmpty: true }),
    (req, res) => {
      const stmt = db.prepare('SELECT data FROM projects WHERE id = ?');
      const row = stmt.get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const data = safeParseJson(row.data, {});
      data.status = req.body.status;

      const updateStmt = db.prepare(
        'UPDATE projects SET data = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(data),
        new Date().toISOString(),
        req.params.id,
      );

      // 업데이트된 status 반환
      res.json({ success: true, status: data.status });
    },
  );

  // 11. 진행 단계 업데이트 (토글 방식)
  router.put(
    '/projects/:id/progress',
    requireJsonObjectBody,
    requireStringField('stage'),
    (req, res) => {
      const stmt = db.prepare(
        'SELECT progress FROM projects WHERE id = ?',
      );
      const row = stmt.get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const progress = safeParseJson(row.progress, {});
      const stage = req.body.stage;

      // 토글: 이미 있으면 해제, 없으면 설정
      if (progress[stage]) {
        delete progress[stage];
      } else {
        progress[stage] = new Date().toISOString();
      }

      const updateStmt = db.prepare(
        'UPDATE projects SET progress = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(progress),
        new Date().toISOString(),
        req.params.id,
      );

      // 업데이트된 progress 반환
      res.json({ success: true, progress });
    },
  );

  // --- 메모 API ---

  // 12. 메모 생성
  router.post(
    '/projects/:id/memos',
    requireJsonObjectBody,
    validateMemoBody,
    (req, res) => {
      const stmt = db.prepare('SELECT memos FROM projects WHERE id = ?');
      const row = stmt.get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const memos = safeParseJson(row.memos, []);
      const newMemo = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
      };
      memos.push(newMemo);

      const updateStmt = db.prepare(
        'UPDATE projects SET memos = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(memos),
        new Date().toISOString(),
        req.params.id,
      );
      res.json(newMemo);
    },
  );

  // 13. 메모 수정
  router.put(
    '/projects/:projectId/memos/:memoId',
    requireJsonObjectBody,
    validateMemoBody,
    (req, res) => {
      const stmt = db.prepare('SELECT memos FROM projects WHERE id = ?');
      const row = stmt.get(req.params.projectId);
      if (!row) return res.status(404).json({ error: 'Not found' });

      let memos = safeParseJson(row.memos, []);
      memos = memos.map((m) =>
        m.id === req.params.memoId ? { ...m, ...req.body } : m,
      );

      const updateStmt = db.prepare(
        'UPDATE projects SET memos = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(memos),
        new Date().toISOString(),
        req.params.projectId,
      );
      res.json({ success: true });
    },
  );

  // 14. 메모 삭제
  router.delete(
    '/projects/:projectId/memos/:memoId',
    (req, res) => {
      const stmt = db.prepare('SELECT memos FROM projects WHERE id = ?');
      const row = stmt.get(req.params.projectId);
      if (!row) return res.status(404).json({ error: 'Not found' });

      let memos = safeParseJson(row.memos, []);
      memos = memos.filter((m) => m.id !== req.params.memoId);

      const updateStmt = db.prepare(
        'UPDATE projects SET memos = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(memos),
        new Date().toISOString(),
        req.params.projectId,
      );
      res.json({ success: true });
    },
  );

  // --- 백업 API ---

  // 15. 백업 다운로드
  router.get('/backup/projects', (req, res) => {
    const stmt = db.prepare('SELECT * FROM projects');
    const rows = stmt.all();
    const projects = rows.map(mapRowToProject);
    res.json(projects);
  });

  // 16. 백업 복원
  router.post(
    '/backup/projects',
    validateBackupRestoreBody,
    (req, res) => {
      const projects = req.body;

      const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, client, data, revisions, memos, progress, createdAt, updatedAt)
    VALUES (@id, @name, @client, @data, @revisions, @memos, @progress, @createdAt, @updatedAt)
  `);

      const insertMany = db.transaction((items) => {
        items.forEach((p) => {
          const dbProject = buildDbFieldsFromProject(p);
          insertStmt.run(dbProject);
        });
      });

      insertMany(projects);
      res.json({ success: true, count: projects.length });
    },
  );

  router.post(
    '/projects/ledger-name/rename',
    requireJsonObjectBody,
    validateLedgerNameRenameBody,
    (req, res) => {
      const from = req.body.from.trim();
      const to = req.body.to.trim();
      const dryRun = req.body.dryRun !== false;
      const rows = db.prepare('SELECT * FROM projects').all();
      const matches = rows
        .map((row) => ({ row, data: safeParseJson(row.data, {}) }))
        .filter(({ data }) => data.ledgerName === from);

      const preview = matches.slice(0, 20).map(({ row, data }) => ({
        id: row.id,
        name: row.name || data.name || '',
        ledgerName: data.ledgerName,
      }));

      if (dryRun || from === to || matches.length === 0) {
        return res.json({
          success: true,
          dryRun,
          from,
          to,
          matchedCount: matches.length,
          updatedCount: 0,
          preview,
        });
      }

      const updateLedgerName = db.transaction((items) => {
        const stmt = db.prepare(
          'UPDATE projects SET data = ?, updatedAt = ? WHERE id = ?',
        );
        const updatedAt = new Date().toISOString();

        items.forEach(({ row, data }) => {
          stmt.run(
            JSON.stringify({ ...data, ledgerName: to }),
            updatedAt,
            row.id,
          );
        });
      });

      updateLedgerName(matches);

      return res.json({
        success: true,
        dryRun,
        from,
        to,
        matchedCount: matches.length,
        updatedCount: matches.length,
        preview,
      });
    },
  );

  return router;
};

module.exports = { createApiRouter };
