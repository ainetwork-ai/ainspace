# AIN Teams backend 연동 — ainspace 가 쓰는 경로

> **계약의 정본은 ainteams 레포의 `docs/integration/ainspace-integration-guide.md` 다**(비공개 — ainetwork-ai 조직 멤버만 읽는다).
> 인증 흐름 · 토큰 회전 · CORS · 오류 표 · 응답 모양은 거기를 본다. 이 문서는 ainspace 코드가 그 계약에서 **어느 경로를 어디서
> 부르는지**만 든다 — ainspace 에서 backend 호출을 더하거나 지우면 아래 표를 같이 고친다.

## ainspace 가 부르는 backend 경로

`${BACKEND_BASE_URL}`(서버) · `${NEXT_PUBLIC_BACKEND_BASE_URL}`(브라우저 직접 인증) 뒤에 붙는다.

| 메서드 · 경로 | 부르는 자리 |
|---|---|
| `GET /auth/challenge` | `src/lib/backend/auth.ts` · `src/app/api/backend-auth/challenge/route.ts` · `src/app/api/backend-auth/kiosk-login/route.ts` |
| `POST /auth/verify` | `src/lib/backend/auth.ts` · `src/app/api/backend-auth/verify/route.ts` · `src/app/api/backend-auth/kiosk-login/route.ts` |
| `POST /auth/refresh` | `src/lib/backend/auth.ts` · `src/app/api/backend-auth/refresh/route.ts` |
| `POST /auth/logout` | `src/lib/backend/auth.ts` |
| `POST /auth/email/{request-code,verify-code,register,login}` | `src/lib/backend/auth.ts` |
| `POST /auth/sso/external/exchange` | `src/lib/backend/sso.ts` |
| `GET /auth/me` | `src/lib/ain-integration/app-session.ts` — `BACKEND_JWT_SIGNING_KEY` 가 없는 배포에서 토큰을 이 경로로 확인한다 |
| `GET /agents?workspaceId=` | `src/lib/backend/agent-mapping.ts` |
| `POST /agents` | `src/app/api/agents/route.ts` |
| `GET /dm?workspaceId=` · `POST /dm` | `src/app/api/threads/route.ts` |
| `GET /dm/:id/messages` | `src/app/api/threads/[id]/route.ts` |
| `POST /dm/:id/messages` | `src/app/api/thread-message/route.ts` |
| `GET /files/:id/stream` | `src/app/api/files/[id]/route.ts` |
| `GET /orchestration/dm/:id/stream` (SSE) | `src/app/api/thread-stream/[threadId]/route.ts` |

refresh 토큰은 httpOnly 쿠키(`__Host-rt`)로만 오간다 — backend 를 직접 부르는 브라우저 fetch 는 `credentials: "include"` 를 켠다.

## backend 에 없는 경로

AIN Teams 0.6.91(2026-11-02 prod 배포)부터 아래 경로는 `404` 다 — 부르는 클라이언트가 없어 지웠다. ainspace 에서 다시 쓰려면
AIN Teams 쪽에 먼저 요청한다.

- `GET /agents/card` · `GET /agents/stream` · `GET /agents/registry`
- `GET · DELETE /agents/:id` · `GET /agents/:id/card` · `GET /agents/:id/channels` · `GET · PATCH /agents/:id/skills` ·
  `PATCH /agents/:id/registry` · `POST /agents/:id/subscribe` · `POST /agents/:id/send`
- `GET · PATCH /dm/:param` · `POST /dm/:id/messages/refresh` · `PATCH /dm/:id/mute` · `PATCH /dm/:id/read`
- `GET /notifications`
