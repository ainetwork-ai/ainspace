# 17.7 Space 자산 인벤토리와 Aindrive 이관 계획

## 인벤토리 스크립트

```
npx tsx scripts/ain-asset-inventory.ts            # Redis + Vercel Blob + Firebase Storage(GCS)
npx tsx scripts/ain-asset-inventory.ts --redis --json
```

- Redis 는 `SCAN` 으로 **키 이름만** 본다(값을 읽는 명령 없음). Blob·버킷은 목록 API 의 이름·크기만(바이트를 받지 않음).
- 비밀을 담는 종류(봉인된 aindrive 연결, OAuth state, 예전 평문 토큰)는 샘플 이름도 `prefix:…` 로 가린다.
- env 의 URL·토큰·서비스 계정 값은 출력하지 않는다(설정 여부만). 분류 규칙: `src/lib/ain-integration/asset-inventory.ts`.

## 무엇이 어디로 가나

| 자산 | 저장소 | 계획 | 이유 |
|---|---|---|---|
| 타일 업로드 `tiles/*.png` | Vercel Blob | **남는다** | 게임 렌더 자산, 공개 CDN URL 이 맵 데이터에 박혀 있다 |
| 마을 맵 `villages/<slug>/map.tmj`, 타일셋 | Firebase Storage | **남는다** + 소유자 드라이브 복사본 참조(아래 도구) | 맵 로더가 직접 읽는 게임 자산 — 원래 URL 유지 |
| 공용 타일셋 `villages/*` | Firebase Storage | **남는다** | 〃 |
| 에이전트 스프라이트 `<repo>/sprites/*` | Firebase Storage | **남는다** | 게임 캐릭터 이미지, 공개 URL |
| 마을·격자·접속자·에이전트 배치·권한·타일 레이어 | Redis | **남는다** | 게임 상태(파일이 아님) |
| 마을 자료 `village:*:ain_materials`, TaskRef `user:*:ain_tasks` | Redis | 이미 **Aindrive 참조** | fileKey·FileRef 만(바이트 없음) |
| 채팅 첨부 | backend `files`(자체호스팅 S3, `/api/files/:id`) | **Aindrive 로 이동** | 사용자 파일은 사용자의 드라이브가 원본이어야 권한·삭제·공유가 한 곳에서 판단된다 |
| aindrive 연결 `ain:aindrive_account:*` | Redis | 봉인 비밀 | 옮기지 않음, 값 읽지 않음 |
| 예전 평문 `ain:aindrive_token:*`, `ain:sso_id_token:*` | Redis | **삭제 가능** | 더는 읽지 않음 |

## 채팅 첨부 이관 (이번 구현 범위)

- **새 첨부** — 채팅 입력 옆 "파일 첨부"(`ChatAttachmentUpload`, 플래그 뒤) → `POST /api/ain/attachments`(multipart, ≤10MB)
  → 답변 저장(saveTo)과 같은 경로: 내 폴더 확인(`folderKey` 또는 내 첫 드라이브 루트) → 같은 이름이면 `rename` → aindrive
  `fs/write` / MCP `write_file`(base64) → FileRef. 채팅에는 링크 파트 `[이름](sourceUrl)` 만 들어간다. Space/backend 스토리지에 올리지 않는다.
  aindrive 연결이 없으면 `auth_required` + 연결 시작 actionUrl.
- **옛 첨부** — backend `files` 의 첨부(agent 가 보낸 이미지 등)는 그대로 `/api/files/:id` 프록시로 열린다. 옮기지 않는다.
  옛 첨부를 옮기는 도구는 Teams 13.6 과 같은 방식(소유자 드라이브로 복사 + 참조 기록, 원본 90일 보존)으로 backend 쪽에서 한다 — 이 브랜치 범위 밖.
- 남는 결정: 첨부 기본 폴더(현재 내 첫 드라이브 루트) 대신 전용 폴더(`Space attachments/`)를 둘지 — 폴더 생성 API 가 필요.

## 기존 자산 연결 도구 (소유자 드라이브 복사 + fileKey 기록)

```
npx tsx scripts/ain-asset-link.ts                               # dry-run(기본): 무엇을 어디로 매핑하는지만
npx tsx scripts/ain-asset-link.ts --village alpha --owner <id>  # 필터
npx tsx scripts/ain-asset-link.ts --apply [--run-id <id>]       # 실행
npx tsx scripts/ain-asset-link.ts --rollback <runId> [--apply] [--delete-copies]
```

- `AIN_INTEGRATION_ENABLED`(또는 `NEXT_PUBLIC_…`)가 꺼져 있으면 아무것도 하지 않고 종료 코드 2.
- **분명한 소유자만**: 마을 맵·마을 타일셋(`villages/<slug>/…`)은 마을 레코드가 있고 `village:<slug>:owner`(검증된 세션으로
  기록된 backend 사용자 id)가 있을 때 그 사람. 나머지는 거절한다 — 타일 업로드(Blob `tiles/`)·공용 타일셋·채팅 첨부는
  올린 사람 기록이 없고(`no_owner`), 에이전트 스프라이트의 `creator` 는 클라이언트가 보낸 지갑 주소라 aindrive 연결의
  사용자 id 와 이어지지 않는다(`owner_not_account`). 소유자 없는 마을은 `no_owner`, 레코드 없는 객체는 `no_record`.
- 소유자의 aindrive 연결(`ain:aindrive_account:<id>`)이 없으면 `skip`(연결하면 다음 실행에서 연결된다). 배포 공용 토큰으로
  물러서지 않는다.
- 대상 경로: 소유자의 첫 드라이브(채팅 첨부 기본 폴더와 같은 규칙) 안 `/Space assets/<객체 경로>`
  (Blob 은 `/Space assets/blob/<pathname>`). 부모 폴더는 aindrive 기기가 만든다. 한 자산 ≤10MB.
- `--apply`: 원본 바이트를 읽어(버킷 다운로드 / Blob 공개 URL) 소유자 연결로 쓴다(`fs/write` → MCP `write_file`, base64).
  대상에 이미 파일이 있으면 크기가 같을 때만 그대로 쓰고(중간에 멈춘 이전 실행), 다르면 덮어쓰지 않고 `target_conflict`.
  그 뒤 **롤백 항목을 먼저** `ain:asset_link_rollback:<runId>`(hash, field = 자산 id)와 로컬 JSONL(`--rollback-file`,
  기본 `ain-asset-link-rollback-<runId>.jsonl`, 0600)에 남기고, 자산 레코드 옆 `village:<slug>:ain_asset_links`
  (field = `bucket:<객체 경로>`, value = `{fileKey, sourceUrl, originalUrl, driveId, path, revision, ownerUserId, linkedAt, runId}`)에 적는다.
  **원래 URL·객체·마을 레코드(`tmjUrl` 등)는 바꾸지 않는다** — 게임은 계속 원래 URL 을 읽는다. 이미 링크가 있는 자산은 건너뛴다(재실행 안전).
- `--rollback <runId> --apply`: 링크 필드를 이전 값으로 되돌리거나 지운다(그 뒤 다른 실행이 바꾼 링크는 `changed_since` 로 두고 건드리지 않는다).
  복사본은 소유자의 파일이라 기본으로 남긴다. `--delete-copies` 면 이 실행이 새로 만든 복사본 중 크기·mtime 이 기록과
  같은 것만 MCP `delete_path` 로 지운다(소유자가 고쳤으면 `kept_modified`).
- 출력·롤백 항목에 토큰·봉인 값은 없다. 마을을 지우면 `village:<slug>:ain_asset_links` 도 함께 지운다(드라이브 복사본은 남는다).
- 인벤토리는 `village:*:ain_asset_links` 를 `reference`, `ain:asset_link_rollback:*` 를 `stays` 로 센다.
- 로직: `src/lib/ain-integration/asset-linking.ts`, 테스트(가짜 KV·마을·aindrive): `asset-linking.test.ts`.
