/**
 * 저장 시 암호화(at rest) — AES-256-GCM. 서버 전용.
 *
 * 키: env `AINDRIVE_TOKEN_KEY`(32자 이상의 임의 문자열)를 HKDF-SHA256 으로 32바이트 키로 늘린다. 용도별 `info` 로
 * 서로 다른 키를 파생하므로 같은 env 로 봉인한 두 종류의 값이 서로 바꿔 끼워지지 않는다.
 * AAD: 호출자가 주는 문맥(예: 사용자 id). 다른 사용자의 레코드를 내 키 자리에 복사해 넣으면 열리지 않는다.
 * 형식: `v1.<iv>.<ciphertext>.<tag>` (모두 base64url). 평문·키는 로그·응답·오류 메시지에 싣지 않는다.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const SALT = 'ainspace/ain-integration/sealed/v1';
export const TOKEN_KEY_MIN_LENGTH = 32;

/** env 키 원문. 없거나 짧으면 null — 봉인할 수 없다(평문 저장으로 물러서지 않는다). */
export const getTokenKeyMaterial = (): string | null => {
  const v = process.env.AINDRIVE_TOKEN_KEY?.trim();
  return v && v.length >= TOKEN_KEY_MIN_LENGTH ? v : null;
};

export function deriveKey(material: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), Buffer.from(SALT), Buffer.from(purpose), 32));
}

export function seal(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

/** 열 수 없으면(키·AAD 불일치, 변조, 모양 오류) null. 이유는 말하지 않는다. */
export function unseal(key: Buffer, sealed: string, aad: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const ct = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
