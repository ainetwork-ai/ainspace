/**
 * AIN 통합 설정 (어댑터 사양 §제품에 넣을 것 2).
 *
 * 서버 전용 값(`AINDRIVE_URL`, `AINIZE_URL`, `AINDRIVE_CONNECT_URL`, `AINDRIVE_ACCOUNT_TOKEN`,
 * `AINDRIVE_OAUTH_CLIENT_ID`, `AINDRIVE_TOKEN_KEY`)은
 * 라우트에서만 읽는다. 플래그는 서버 라우트(`AIN_INTEGRATION_ENABLED`)와 클라이언트 진입점
 * (`NEXT_PUBLIC_AIN_INTEGRATION_ENABLED`) 양쪽에서 확인한다 — 기본은 **off** 이며, off 면
 * 라우트는 404, 진입점은 렌더링하지 않는다.
 *
 * 함수로 두는 이유: 호출 시점에 읽어야 테스트가 env 를 바꿔 가며 검증할 수 있다.
 */

const stripSlash = (u: string) => u.replace(/\/+$/, '');

export const getAindriveUrl = (): string =>
  stripSlash(process.env.AINDRIVE_URL?.trim() || 'https://aindrive.ainetwork.ai');

export const getAinizeUrl = (): string =>
  stripSlash(process.env.AINIZE_URL?.trim() || 'https://ainize.ai');

/**
 * 이 제품의 공개 오리진 — OAuth redirect_uri·actionUrl 을 만들 때 쓴다. 프록시 뒤에서 요청 오리진이 내부 주소일 수
 * 있어 `NEXT_PUBLIC_URL` 을 우선하고, 없으면 요청 오리진.
 */
export const getPublicOrigin = (requestOrigin: string): string =>
  stripSlash(process.env.NEXT_PUBLIC_URL?.trim() || requestOrigin);

/** aindrive 계정 연결 시작 라우트(이 제품). */
export const AINDRIVE_CONNECT_PATH = '/api/ain/aindrive/connect';
export const AINDRIVE_CALLBACK_PATH = '/api/ain/aindrive/callback';

/**
 * `auth_required` 의 actionUrl — 사용자가 aindrive 계정을 연결하러 갈 곳 = **이 제품의 연결 시작 라우트**
 * (`GET /api/ain/aindrive/connect` → PKCE → aindrive `/oauth/authorize`). 계약상 절대 URL 이어야 하므로 오리진을 받는다.
 * `AINDRIVE_CONNECT_URL` 이 있으면 그것(운영자가 별도 안내 페이지를 둘 때).
 */
export const getAindriveConnectUrl = (requestOrigin: string): string =>
  process.env.AINDRIVE_CONNECT_URL?.trim() || `${getPublicOrigin(requestOrigin)}${AINDRIVE_CONNECT_PATH}`;

/** aindrive OAuth 클라이언트 id (public client, PKCE — 비밀 없음). 없으면 연결 흐름을 시작할 수 없다. */
export const getAindriveOAuthClientId = (): string | null => process.env.AINDRIVE_OAUTH_CLIENT_ID?.trim() || null;

/** 요청할 계정 스코프. aindrive ACCOUNT_SCOPES 중 파일 목록·호출·저장에 필요한 것만. */
export const AINDRIVE_OAUTH_SCOPES = 'profile drives:read drives:write';

const isOn = (v: string | undefined) => v === 'true' || v === '1';

/**
 * 서버(라우트)에서 부르는 플래그. 서버 전용 이름을 우선하고, 클라이언트 이름도 받아
 * 한 값만 설정한 배포에서도 양쪽이 같게 동작한다.
 */
export const isAinIntegrationEnabled = (): boolean =>
  isOn(process.env.AIN_INTEGRATION_ENABLED) || isOn(process.env.NEXT_PUBLIC_AIN_INTEGRATION_ENABLED);

/**
 * 클라이언트 컴포넌트에서 부르는 플래그. Next 는 `process.env.NEXT_PUBLIC_*` 를 **리터럴로**
 * 참조한 곳만 번들에 인라인하므로 여기서 그 이름을 직접 쓴다.
 */
export const isAinIntegrationEnabledClient = (): boolean =>
  isOn(process.env.NEXT_PUBLIC_AIN_INTEGRATION_ENABLED);

// ---------------------------------------------------------------------------------------------- 2단계: AIN SSO (위임 발급)

/** AIN SSO issuer — `POST {issuer}/api/delegations/resource` 를 부르는 곳. */
export const getAinSsoIssuer = (): string =>
  stripSlash(process.env.AIN_SSO_ISSUER?.trim() || 'https://auth.comcom.ai');

/** first-party 클라이언트 자격(client_secret_basic). 둘 중 하나라도 없으면 null → 위임을 요청할 수 없다. */
export const getAinSsoClientCredentials = (): { clientId: string; clientSecret: string } | null => {
  const clientId = process.env.AIN_SSO_CLIENT_ID?.trim();
  const clientSecret = process.env.AIN_SSO_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

/** `auth_required` 의 actionUrl — 사용자가 AIN SSO 를 연결하러 갈 곳. */
export const getAinSsoConnectUrl = (): string =>
  process.env.AIN_SSO_CONNECT_URL?.trim() || `${getAinSsoIssuer()}/`;

// ---------------------------------------------------------------------------------------------- 공유 에이전트 목록 자격

/**
 * 설치 단위의 Ainize **조직 범위 API 키**(선택, `AINIZE_API_KEY`) — Teams 와 같은 뜻. 있으면 목록 요청에 Bearer 로
 * 붙이고 기본 목록 범위가 `shared_with_org` 가 된다. 없으면 `public`. 서버 전용(헤더로만 나가고 응답·로그에 싣지 않는다).
 */
export const getAinizeApiKey = (): string | null => process.env.AINIZE_API_KEY?.trim() || null;

/** `/api/ain/shared-agents` 가 실제로 원본에 물은 범위를 알리는 응답 헤더 — 선택기가 목록 제목을 고르는 데 쓴다. */
export const AGENT_SCOPE_HEADER = 'x-ain-agent-scope';
