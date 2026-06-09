# Ainspace ↔ Backend Integration Guide

> 외부 클라이언트가 dm/agent/orchestration 자원을 **backend(NestJS) 를 직접 호출** 해서 쓰기 위한 통합 명세서. ainspace 가 첫 외부 클라이언트이지만 본 가이드는 *client-agnostic* — 미래에 추가될 다른 도메인도 동일한 흐름.

본 문서는 [EPIC13 - Unified JWT Auth](../epics/yoojin/EPIC13-auth-assets-backend-migration.md) 의 구현 결과를 외부 개발자가 읽고 자기 측 코드를 작업할 수 있도록 정리한다. (이전 EPIC12 버전은 BFF 경유 + cookie/JWT 병용이었으나, EPIC13 에서 **JWT 단일 + backend 직접 호출** 로 전환.)

## ⚠️ 현재 상태 (읽기 전 필독)

- backend 엔드포인트는 현재 `dev/refactor_backend` 브랜치에만 있고 **prod 미배포**. 아래 `${BACKEND_BASE}` 는 배포 후 확정.
- `POST /agents/:id/send` · `GET /agents/stream` 은 PR #202 머지 후 확정.
- **built 에이전트(VLLM+MCP) 및 a2a-builder 로 만든 에이전트** 의 build/send/stream 은 backend 미지원(BFF 유지). ainspace 가 **외부 A2A 에이전트** 만 쓰면 무관.

## 개요

backend 는 **JWT Bearer 단일 인증**. internal/external 구분 없이 *같은 엔드포인트* 를 JWT 로 호출한다 (EPIC13). cookie/iron-session 은 폐기 진행 중이며 외부 클라이언트와는 무관 — ainspace 는 처음부터 JWT 만 쓴다.

- 발급/검증 source = backend 한 곳.
- 모든 보호 엔드포인트는 `Authorization: Bearer <accessToken>`.
- scope claim 으로 권한 한정 (dm:read/write, agents:read/write, orchestration:stream).

## 사전 준비

backend 운영자에게 요청:

1. **`clientId` 발급** — e.g. `"ainspace"`. verify 호출 body 의 `clientId` 로 전달.
2. **`workspaceId` 할당** — clientId 가 가입할 workspace UUID.
3. **외부 origin 등록** — ainspace 가 호출할 브라우저 origin (e.g. `https://ainspace.example.com`).

backend env (운영자 측):

```bash
# backend/.env
JWT_SIGNING_KEY="<32+ chars>"
JWT_ACCESS_TTL_SECONDS=3600
JWT_REFRESH_TTL_SECONDS=604800
CLIENT_WORKSPACE_MAP="ainspace=00000000-0000-0000-0000-000000000000"
EXTERNAL_ORIGIN_ALLOWLIST="https://ainspace.example.com"
```

> `clientId` 가 있으면 해당 workspace 로 자동 가입 + token 의 `workspaceId` claim 부착(외부 클라이언트). 없으면 멤버인 모든 workspace 접근(web UI 용). ainspace 는 `clientId` 를 넣는다.

## 인증 흐름 (wallet 예시)

### 1단계: Challenge 요청

```http
GET ${BACKEND_BASE}/auth/challenge
Origin: https://ainspace.example.com
```

응답:
```json
{ "nonce": "<uuid>", "message": "Sign in to AIN Teams: <uuid>" }
```

### 2단계: message 서명

```ts
// 응답의 message 필드를 그대로 서명
const signature = await wallet.signMessage(challenge.message);
```

### 3단계: Verify + token 발급

```http
POST ${BACKEND_BASE}/auth/verify
Origin: https://ainspace.example.com
Content-Type: application/json

{
  "signature": "0x...",
  "address": "0x...",
  "provider": "eth",            // "eth" | "metamask" | "ain"
  "clientId": "ainspace",
  "challengeNonce": "<1단계의 nonce>"   // ★ 필수 — single-use, 5분 TTL
}
```

응답 (성공):
```json
{
  "user": { "id": "<uuid>", "displayName": "...", "ainAddress": "0x...", "avatarUrl": null },
  "tokens": { "accessToken": "eyJ...", "refreshToken": "eyJ...", "expiresIn": 3600 }
}
```

응답 (실패):
- `400` — `challengeNonce` 누락/만료/재사용 (`invalid or expired challenge`) 또는 `unknown clientId`
- `401` — 서명 검증 실패 (`invalid signature`)

> **다른 로그인 방식**: `POST /auth/key-login { privateKey, clientId }`, `POST /auth/email/login { email, password, clientId }`, `POST /auth/email/register { email, password, displayName?, clientId }`. 모두 동일하게 `{ user, tokens }` 반환.

### 4단계: Token 저장

- **메모리(in-memory)** 가장 안전 (새로고침 시 재로그인). `sessionStorage` < `localStorage` 순으로 XSS 노출. localStorage 비권장.

## API 호출

### 공통 헤더 / fetch

```ts
fetch(`${BACKEND_BASE}${path}`, {
  method,
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  credentials: "omit",   // cookie 안 보냄 — backend CORS 가 Allow-Credentials 응답 X
  body: body && JSON.stringify(body),
});
```

### 노출된 엔드포인트

| Path | Methods | scope |
|---|---|---|
| `/auth/{challenge,verify,refresh,key-login,email/login,email/register}` | GET/POST | (Public) |
| `/dm?workspaceId=` | GET (list) / POST (create) | dm:read / dm:write |
| `/dm/:param` | GET (detail) / PATCH (`{action:"markRead"}`) | dm:read / dm:write |
| `/dm/:id/messages` | GET (cursor) / POST (send) | dm:read / dm:write |
| `/dm/:id/messages/refresh` | POST | dm:read |
| `/dm/:id/mute`, `/dm/:id/read` | PATCH | dm:write |
| `/agents?workspaceId=` | GET (list) / POST (invite) | agents:read / agents:write |
| `/agents/registry?tab=mine\|public&q=&category=` | GET | agents:read |
| `/agents/card?url=` | GET (외부 카드 조회) | agents:read |
| `/agents/stream?agentId=&text=&skillId=` | GET (SSE) | agents:read |
| `/agents/:id` | GET / DELETE | agents:read / agents:write |
| `/agents/:id/card` | GET | (Public — A2A `.well-known` 카드) |
| `/agents/:id/channels` | GET | agents:read |
| `/agents/:id/skills` | GET / PATCH | agents:read / agents:write |
| `/agents/:id/registry` | PATCH | agents:write |
| `/agents/:id/subscribe` | POST (`{workspaceId}`) | agents:write |
| `/agents/:id/send` | POST (`{text, conversationId?, channelId?, skillId?}`) | agents:write |
| `/orchestration/dm/:id/send` | POST (`{userMessageId}`) | orchestration:stream |
| `/orchestration/dm/:id/stream` | GET (SSE) | orchestration:stream |

> **`/dm/:param` 의 param**: shortId(`D…`/`A…`) / UUID / AIN주소 / a2aId 다 해석. 단 `/dm/:id/messages`·`mute`·`read` 는 **conversation UUID** 를 쓴다(create/detail 응답의 `id`).
> **백엔드 미이주(BFF only)**: `POST /agents/build`, `PATCH /agents/:id/build`, `GET /agents/builder` (a2a-builder), 그리고 **built 에이전트의 send/stream**(backend 는 501 반환). notion/channels/admin 등 다른 도메인도 backend 미노출.

### 예시: DM 생성 + 메시지 send

```ts
// 1) 새 DM 생성 (외부 A2A agent 멤버 포함)
const dm = await api("/dm", "POST", { workspaceId: WS, userIds: [agentAUuid, agentBUuid] });

// 2) 메시지 보내기
//    - 외부 non-builder agent ≥ 2  → backend orchestration 자동 trigger
//    - 외부 agent 1명             → 해당 agent 에 단발 send 자동 trigger
await api(`/dm/${dm.id}/messages`, "POST", { content: "Hello agents", metadata: { skillId: "summarize" } });
```

### 예시: refresh on 401 wrapper

```ts
class BackendClient {
  constructor(private accessToken: string, private refreshToken: string) {}
  async fetch(path: string, init: RequestInit = {}) {
    const go = (t: string) => fetch(`${BACKEND_BASE}${path}`, {
      ...init, credentials: "omit",
      headers: { ...init.headers, Authorization: `Bearer ${t}` },
    });
    let res = await go(this.accessToken);
    if (res.status === 401 && (await this.refresh())) res = await go(this.accessToken);
    return res;
  }
  private async refresh() {
    const res = await fetch(`${BACKEND_BASE}/auth/refresh`, {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: this.refreshToken }),
    });
    if (!res.ok) return false;
    ({ accessToken: this.accessToken, refreshToken: this.refreshToken } = await res.json());
    return true;
  }
}
```

## Token Rotation

- Access 1시간 / Refresh 7일 (기본, env override). 만료 후 401.
- Refresh 시 새 access + 새 refresh 쌍, **이전 refresh 즉시 무효화**(single-use, 재사용 시 401 — 도난 방어).
- Refresh 만료 → challenge/verify 부터 재로그인.

```http
POST ${BACKEND_BASE}/auth/refresh
{ "refreshToken": "eyJ..." }
→ { "accessToken": "...", "refreshToken": "...(rotated)", "expiresIn": 3600 }
```

## SSE 구독 (fetch streaming)

브라우저 `EventSource` 는 custom 헤더 미지원 → Bearer 를 못 보낸다. backend SSE 는 **fetch streaming** 으로 소비한다.

```ts
const res = await fetch(`${BACKEND_BASE}/orchestration/dm/${convId}/stream`, {
  headers: { Authorization: `Bearer ${accessToken}` },
  credentials: "omit",
});
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  for (const block of buf.split("\n\n")) {
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") return;
    handleEvent(JSON.parse(payload));
  }
}
```

- `/orchestration/dm/:id/stream` 이벤트: `{ type:"message", data:{...} }` / `{ type:"block", data:{...} }` (EPIC09/10).
- `/agents/stream` 이벤트: `{ type:"status"|"artifact"|"error", content }`, 종단에 `data: [DONE]`.

## CORS

- ainspace origin 이 backend `EXTERNAL_ORIGIN_ALLOWLIST` 에 등록돼야 통과. `*` 와일드카드 안 씀 — 매칭된 origin 만 reflect.
- preflight(OPTIONS) → 204. 응답: `Access-Control-Allow-Origin: <ainspace>`, `Allow-Headers: Authorization, Content-Type, X-Client-Id`, `Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`, `Vary: Origin`.
- **`Access-Control-Allow-Credentials` 응답 안 함** (Bearer only) → 클라이언트는 `credentials: 'omit'`.

## 에러 응답 표준

| Status | 의미 |
|---|---|
| 200/201/202 | 정상 |
| 400 | 잘못된 요청 (challengeNonce 무효, unknown clientId, 검증 실패 등) |
| 401 | 인증 실패 (token 없음/만료/invalid signature/refresh 재사용) |
| 403 | 권한 부족 (scope 부족, 다른 workspace 의 DM/agent 접근) |
| 404 | 리소스 없음 |
| 501 | backend 미지원 (built/local agent send) — BFF 경로 사용 |
| 5xx | 서버 에러 (지수 백오프 retry) |

401 은 사유 비노출 — 받으면 refresh 시도, 또 401 이면 재로그인.

## 데이터 모델 매핑 (ainspace ↔ backend)

| ainspace | backend |
|---|---|
| `Thread { id, createdAt, agents[] }` | `dm_conversations` + `dm_members` |
| `Message { id, threadId, sender, content, timestamp }` | `messages (id, conversationId, userId, content, createdAt)` |
| `Agent { name, role, a2aUrl }` | `users { id, displayName, isAgent=true, a2aUrl, agentCardJson }` |
| `userId` (wallet) | `users.id` (UUID; wallet 은 `ainAddress`) |

## 통합 체크리스트

- [ ] 운영자에게 `clientId` / `workspaceId` / `EXTERNAL_ORIGIN_ALLOWLIST` 등록 요청
- [ ] endpoint base 를 `${BACKEND_BASE}` (backend 직접) 로 — BFF `/api/slack/*` 아님
- [ ] 인증 wrapper: challenge → verify(**challengeNonce 포함**) → tokens, refresh on 401
- [ ] 모든 fetch `credentials: 'omit'`
- [ ] SSE 는 fetch streaming (EventSource 아님), `[DONE]` 종단 처리
- [ ] 외부 A2A agent 만 사용 (built/a2a-builder agent 는 backend 미지원 — 필요 시 BFF)
- [ ] error 표준 처리 (401→refresh, 403→권한, 501→BFF fallback)

## 참고

- EPIC13: [`docs/epics/yoojin/EPIC13-auth-assets-backend-migration.md`](../epics/yoojin/EPIC13-auth-assets-backend-migration.md)
- 인증: [`backend/src/auth/jwt/token.ts`](../../backend/src/auth/jwt/token.ts), [`auth.controller.ts`](../../backend/src/auth/jwt/auth.controller.ts), [`scope.ts`](../../backend/src/auth/jwt/scope.ts), [`client-mapping.ts`](../../backend/src/auth/jwt/client-mapping.ts)
- CORS: [`backend/src/main.ts`](../../backend/src/main.ts)
- dm/agents: [`backend/src/domain/dm/*`](../../backend/src/domain/dm/), [`backend/src/domain/agents/*`](../../backend/src/domain/agents/)
