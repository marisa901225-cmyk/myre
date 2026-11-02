# NAS Docker 배포 가이드

이 프로젝트는 소규모 회사용 단일 백엔드라서 `Docker + SQLite` 조합으로 운영해도 충분히 괜찮습니다.
중요한 점은 SQLite 파일을 컨테이너 내부가 아니라 NAS 볼륨에 두는 것입니다.

## 1. 준비

- NAS에 Docker 또는 Container Manager가 설치되어 있어야 합니다.
- 이 저장소 전체를 NAS에 복사합니다.
- 환경변수 파일은 `backend/.env` 에 둡니다.

처음 세팅이라면:

```bash
cp backend/.env.example backend/.env
mkdir -p backend-data
```

기존 운영 DB를 이어서 쓸 거라면:

```bash
cp backend/data.db backend-data/data.db
```

## 2. 실행

루트 폴더에서 실행:

```bash
docker compose up -d --build
```

확인:

```bash
docker compose ps
docker compose logs -f backend
```

## 3. 접속 주소

- 헬스체크: `http://NAS_IP:4000/api/health`
- 기본 페이지: `http://NAS_IP:4000/estimate`

외부 공개가 필요하면 NAS 리버스 프록시 또는 별도 프록시(Nginx, Tailscale, Cloudflare Tunnel 등) 앞단에 붙이면 됩니다.

## 4. 운영 포인트

- SQLite 파일은 `./backend-data/data.db` 에 저장됩니다.
- 컨테이너를 지워도 `backend-data` 폴더를 유지하면 DB는 남습니다.
- 이 구조는 백엔드 컨테이너 1개 기준으로 운영하는 것이 안전합니다.
- SQLite 파일을 SMB/NFS 공유폴더로 여러 서버가 동시에 잡고 쓰는 구조는 피하는 편이 좋습니다.

## 5. 업데이트

코드 갱신 후:

```bash
docker compose up -d --build
```

DB는 `backend-data` 폴더에 남아 있으므로 그대로 유지됩니다.

## 6. 환경변수 메모

`backend/.env` 에서 특히 확인할 값:

- `API_KEY` 또는 `ESTIMATE_TOOL_API_KEY`
- `REQUIRE_API_KEY`
- `CORS_ORIGINS`
- `SMTP_*`
- `DROPBOX_*`

`DB_PATH` 는 Compose에서 `/data/data.db` 로 강제하므로 `.env` 에 비워둬도 됩니다.
