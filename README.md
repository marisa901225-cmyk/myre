# Switchgear Estimate Backend Archive

이 저장소는 스위치기어 견적관리 시스템의 백엔드 보관/복구용 작업본입니다.
운영 프론트엔드는 다른 PC에서 관리하며, 이 저장소에는 포함하지 않습니다.

## Included

- `backend/`: Express + SQLite 백엔드
- `BACKEND_RESTORE.md`: 복구 메모와 배포/연결 절차

## Requirements

- Node.js LTS
- npm

## Setup

```bash
npm --prefix backend install
cp backend/.env.example backend/.env
```

필수/주요 환경변수:

- `API_KEY` 또는 `ESTIMATE_TOOL_API_KEY`
- `REQUIRE_API_KEY`
- `DB_PATH` (선택)
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `MAIL_TO`

## Run

```bash
node backend/server.js
```

기본 헬스체크:

- `GET /api/health`
- `GET /estimate`

## Test

```bash
npm --prefix backend test
```

## Backup

DB/엑셀 메일 및 Dropbox 업로드 스크립트:

```bash
npm --prefix backend run send-db-email
```

현재 Tailscale 백엔드 경로:

- `https://marisa-server.tail5c2348.ts.net/estimate`

자세한 복구 절차는 `BACKEND_RESTORE.md`를 참고하세요.

## Docker / NAS Deploy

NAS에서 Docker로 운영할 때는 SQLite 파일을 컨테이너 밖 볼륨에 두는 방식이 가장 무난합니다.

```bash
mkdir -p backend-data
cp backend/data.db backend-data/data.db
docker compose up -d --build
```

자세한 절차는 `NAS_DOCKER_DEPLOY.md`를 참고하세요.

## Company NAS Migration Checklist

회사 NAS로 옮길 때는 코드와 실제 운영 데이터를 분리해서 옮기면 됩니다.

GitHub에 올릴 것:

- 백엔드 소스코드
- `backend/Dockerfile`
- `docker-compose.yml`
- 문서 파일들

USB로 들고갈 것:

- `backend/data.db`
- `backend/.env`

주의:

- `backend/.env` 와 실제 DB 파일은 GitHub에 올리지 않습니다.
- Docker 배포 기준 실제 운영 DB 위치는 `backend-data/data.db` 입니다.

### NAS에서 옮기는 순서

1. GitHub에서 프로젝트를 내려받습니다.
2. 프로젝트 루트에서 DB 폴더를 만듭니다.
3. USB에 있는 DB와 `.env` 를 제자리에 복사합니다.
4. Docker Compose로 백엔드를 실행합니다.
5. 브라우저에서 헬스체크 주소로 확인합니다.

```bash
mkdir -p backend-data
cp /USB경로/data.db backend-data/data.db
cp /USB경로/.env backend/.env
docker compose up -d --build
```

실행 확인:

```bash
docker compose ps
docker compose logs -f backend
```

접속 확인:

- `http://NAS_IP:4000/api/health`
- `http://NAS_IP:4000/estimate`
