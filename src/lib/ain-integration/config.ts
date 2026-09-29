/**
 * AIN 통합 설정 (어댑터 사양 §제품에 넣을 것 2).
 *
 * 서버 전용 값(`AINDRIVE_URL`, `AINIZE_URL`, `AINDRIVE_CONNECT_URL`, `AINDRIVE_ACCOUNT_TOKEN`)은
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

/** `auth_required` 의 actionUrl — 사용자가 aindrive 계정을 연결하러 갈 곳. */
export const getAindriveConnectUrl = (): string =>
  process.env.AINDRIVE_CONNECT_URL?.trim() || `${getAindriveUrl()}/oauth/authorize`;

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
