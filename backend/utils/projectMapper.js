const { safeParseJson } = require('./parse');

// DB Row -> 프론트에서 쓰는 프로젝트 형태
const mapRowToProject = (row) => {
  const data = safeParseJson(row.data, {});
  const revisions = safeParseJson(row.revisions, []);
  const memos = safeParseJson(row.memos, []);
  const progress = safeParseJson(row.progress, {});

  return {
    // 커스텀 필드(ledgerName, status, contractAmount 등)는 data 안에 저장되어 있음
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

// 프론트 프로젝트 객체 -> DB 컬럼 세트
const buildDbFieldsFromProject = (project) => {
  const {
    id,
    name,
    client,
    revisions = [],
    memos = [],
    progress = {},
    createdAt,
    updatedAt,
    data,
    ...rest
  } = project || {};

  const nowIso = new Date().toISOString();

  // 기존 data 안에 들어있던 값과 나머지 필드를 모두 병합
  const mergedData =
    data && typeof data === 'object'
      ? { ...data, ...rest }
      : { ...rest };

  return {
    id: id || Date.now().toString(),
    name: name || '',
    client: client || '',
    data: JSON.stringify(mergedData),
    revisions: JSON.stringify(revisions),
    memos: JSON.stringify(memos),
    progress: JSON.stringify(progress),
    createdAt: createdAt || nowIso,
    updatedAt: updatedAt || nowIso,
  };
};

module.exports = { mapRowToProject, buildDbFieldsFromProject };
