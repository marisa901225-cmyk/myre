const express = require('express');
const { safeParseJson } = require('../utils/parse');
const {
  mapRowToProject,
  buildDbFieldsFromProject,
} = require('../utils/projectMapper');
const {
  requireJsonObjectBody,
  requireStringField,
  validateProjectBody,
  validateMemoBody,
  validateBackupRestoreBody,
} = require('../validators');

const createApiRouter = ({ db } = {}) => {
  if (!db) {
    throw new Error('Database instance is required');
  }

  const router = express.Router();

  // 1. Health Check
  router.get('/health', (req, res) =>
    res.json({ status: 'ok', db: 'sqlite' }),
  );

  // 2. API Key Verification
  router.get('/verify-key', (req, res) =>
    res.json({ valid: true }),
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
    const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(req.params.id);

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
      const selectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
      const row = selectStmt.get(req.params.id);

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

      const updateStmt = db.prepare(`
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

      updateStmt.run(dbProject);
      res.json({ success: true });
    },
  );

  // 7. 프로젝트 삭제
  router.delete('/projects/:id', (req, res) => {
    const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  });

  // --- 리비전 API ---

  // 8. 리비전 추가
  router.post(
    '/projects/:id/revisions',
    requireJsonObjectBody,
    (req, res) => {
      const stmt = db.prepare('SELECT revisions FROM projects WHERE id = ?');
      const row = stmt.get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });

      const revisions = safeParseJson(row.revisions, []);
      const newRevision = {
        id: Date.now().toString(),
        ...req.body,
        createdAt: new Date().toISOString(),
      };
      revisions.push(newRevision);

      const updateStmt = db.prepare(
        'UPDATE projects SET revisions = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(revisions),
        new Date().toISOString(),
        req.params.id,
      );
      res.json(newRevision);
    },
  );

  // 9. 리비전 수정
  router.put(
    '/projects/:projectId/revisions/:revisionId',
    requireJsonObjectBody,
    (req, res) => {
      const stmt = db.prepare(
        'SELECT revisions FROM projects WHERE id = ?',
      );
      const row = stmt.get(req.params.projectId);
      if (!row) return res.status(404).json({ error: 'Not found' });

      let revisions = safeParseJson(row.revisions, []);
      revisions = revisions.map((r) =>
        r.id === req.params.revisionId ? { ...r, ...req.body } : r,
      );

      const updateStmt = db.prepare(
        'UPDATE projects SET revisions = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(revisions),
        new Date().toISOString(),
        req.params.projectId,
      );
      res.json({ success: true });
    },
  );

  // 17. 리비전 삭제
  router.delete(
    '/projects/:projectId/revisions/:revisionId',
    (req, res) => {
      const stmt = db.prepare('SELECT revisions FROM projects WHERE id = ?');
      const row = stmt.get(req.params.projectId);
      if (!row) return res.status(404).json({ error: 'Not found' });

      let revisions = safeParseJson(row.revisions, []);
      revisions = revisions.filter((r) => r.id !== req.params.revisionId);

      const updateStmt = db.prepare(
        'UPDATE projects SET revisions = ?, updatedAt = ? WHERE id = ?',
      );
      updateStmt.run(
        JSON.stringify(revisions),
        new Date().toISOString(),
        req.params.projectId,
      );
      res.json({ success: true });
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

  return router;
};

module.exports = { createApiRouter };
