/**
 * `commonAgentId` = 계약 `agentKey(ref)` = `"<registryIssuer>#<agentId>"`.
 * issuer 는 https 오리진(localhost 만 http), agentId 는 공백·슬래시 없는 토큰(계약 opaqueId).
 */
const ISSUER_RE = /^(https:\/\/[^\s/#?]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const AGENT_ID_RE = /^[^\s/\\]{1,256}$/;

/**
 * 검증·정규화. 값이 없으면 `undefined`(선택 필드), 모양이 틀리면 `false`(400 용), 맞으면 그 문자열.
 */
export function parseCommonAgentId(raw: unknown): string | undefined | false {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > 1024) return false;
  const hash = raw.indexOf('#');
  if (hash <= 0) return false;
  const issuer = raw.slice(0, hash).replace(/\/+$/, '');
  const agentId = raw.slice(hash + 1);
  if (!ISSUER_RE.test(issuer) || !AGENT_ID_RE.test(agentId)) return false;
  return `${issuer}#${agentId}`;
}
