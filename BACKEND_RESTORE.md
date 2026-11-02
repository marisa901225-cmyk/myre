# 백엔드 서버 구축 및 복구 가이드

이 문서는 분실된 백엔드 서버를 복구하고, Tailscale Funnel을 통해 외부에서 접속할 수 있도록 설정하는 방법을 안내합니다.

## 1. 백엔드 코드 복구 (Reverse Engineering)

프론트엔드(`src/services/apiClient.js`)의 요청 패턴을 분석하여, Node.js + Express 기반의 호환 서버를 작성해야 합니다.

### 1.1 프로젝트 폴더 준비
`backend` 라는 이름의 새 폴더를 만들고 초기화합니다.

```bash
mkdir backend
cd backend
npm init -y
npm install express cors body-parser lowdb@1.0.0
```
*참고: DB는 간편한 파일 기반의 `lowdb`를 사용합니다.*

### 1.2 서버 코드 (`server.js`) 작성
아래 코드를 `backend/server.js` 파일로 저장하세요.

```javascript
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

// DB 초기화
db.defaults({ projects: [], settings: {} }).write();

const app = express();
const PORT = 4000;

app.use(cors());
app.use(bodyParser.json());

// --- API 라우트 ---

// 1. Health Check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// 2. API Key Verification (단순 통과)
app.get('/api/verify-key', (req, res) => res.json({ valid: true }));

// 3. 프로젝트 목록 조회
app.get('/api/projects', (req, res) => {
  const projects = db.get('projects').value();
  res.json(projects);
});

// 4. 프로젝트 생성
app.post('/api/projects', (req, res) => {
  const newProject = { 
    id: Date.now().toString(), 
    ...req.body,
    createdAt: new Date().toISOString(),
    revisions: [],
    memos: [],
    progress: {}
  };
  db.get('projects').push(newProject).write();
  res.json(newProject);
});

// 5. 프로젝트 상세 조회
app.get('/api/projects/:id', (req, res) => {
  const project = db.get('projects').find({ id: req.params.id }).value();
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

// 6. 프로젝트 수정
app.put('/api/projects/:id', (req, res) => {
  db.get('projects')
    .find({ id: req.params.id })
    .assign({ ...req.body, updatedAt: new Date().toISOString() })
    .write();
  res.json({ success: true });
});

// 7. 프로젝트 삭제
app.delete('/api/projects/:id', (req, res) => {
  db.get('projects').remove({ id: req.params.id }).write();
  res.json({ success: true });
});

// --- 서버 실행 ---
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
```

### 1.3 서버 실행
```bash
node server.js
```

---

## 2. Tailscale Funnel 설정 (외부 접속용)

기존에 사용 중인 Funnel 주소(`.../risk`)와 겹치지 않도록, **새로운 경로**나 **다른 포트**를 사용해야 합니다.

### 방법 A: 경로(Path)로 구분하기 (추천)
이미 80/443 포트를 `.../risk`가 쓰고 있다면, Nginx나 프록시 설정이 필요해서 복잡할 수 있습니다.
가장 쉬운 방법은 **Tailscale Serve의 포트 포워딩 기능**을 쓰는 것입니다.

```bash
# 백엔드(4000번 포트)를 Tailscale 주소의 /estimate 경로로 연결
tailscale serve --bg --set-path /estimate http://localhost:4000
```
이렇게 하면 주소는 다음과 같이 됩니다:
`https://marisa-server.tail5c2348.ts.net/estimate`

### 방법 B: 그냥 전체 다 열기
만약 `risk` 서비스가 443 포트를 독점하고 있지 않다면:
```bash
tailscale funnel 4000
```
이 경우 별도의 포트가 붙은 주소(예: `https://...:4000`)가 생성될 수 있습니다.

---

## 3. 프론트엔드 연결 설정

백엔드 주소가 확정되면 프론트엔드 코드를 수정합니다.

1. `src/services/apiClient.js` 파일 열기
2. `getStoredBaseUrl` 함수 내 주소 변경

```javascript
// 예시 (방법 A 사용 시)
return 'https://marisa-server.tail5c2348.ts.net/estimate';
```

3. 변경 사항 저장 및 배포 (GitHub Push)


sudo systemctl restart switchgear-backend.service
