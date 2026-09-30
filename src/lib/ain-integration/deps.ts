/**
 * `/api/ain/*` 라우트의 주입 지점. Next 라우트 모듈은 HTTP 핸들러 외의 export 를 허용하지
 * 않으므로 여기 두고, 테스트가 Redis·원본 호출 없이 라우트를 돌릴 때 이 객체의 필드를 바꿔 끼운다.
 */
import { applyAgentEvents } from './agent-events';
import { getAindriveAccountToken } from './aindrive-token';
import { listSharedAgents } from './agents';
import { fetchEvents } from './events';
import { listSharedFiles } from './files';
import { invokeSharedAgent } from './invoke';
import { getSessionProof } from './session-proof';
import { saveTaskRef } from './task-store';

export const sharedFilesDeps = { getAindriveAccountToken, listSharedFiles };
export const sharedAgentsDeps = { listSharedAgents };
export const invokeDeps = { getAindriveAccountToken, getSessionProof, invokeSharedAgent, saveTaskRef };
export const eventsDeps = { getAindriveAccountToken, fetchEvents, applyAgentEvents };
