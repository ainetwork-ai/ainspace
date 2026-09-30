/**
 * `/api/ain/*` 라우트의 주입 지점. Next 라우트 모듈은 HTTP 핸들러 외의 export 를 허용하지
 * 않으므로 여기 두고, 테스트가 Redis·원본 호출 없이 라우트를 돌릴 때 이 객체의 필드를 바꿔 끼운다.
 */
import { applyAgentEvents, redisAgentStore } from './agent-events';
import { observeAgentOwners, observeResolvedAgent, resolveAgentOwners, trackedAgentKeys, verifyVillageAgentOwner } from './agent-ownership';
import { defaultOAuthDeps, getAindriveAccountToken } from './aindrive-token';
import { listSharedAgents } from './agents';
import { fetchEvents } from './events';
import { checkExhibits } from './exhibition';
import { listSharedFiles } from './files';
import { saveChatAttachment } from './chat-attachments';
import { invokeSharedAgent, resolveFiles } from './invoke';
import { getSessionProof } from './session-proof';
import { saveTaskRef } from './task-store';
import { defaultVillageStore, listVillageMaterials } from './village-materials';
import { redisVillageDirectory } from './village-membership';

export const sharedFilesDeps = { getAindriveAccountToken, listSharedFiles };
export const sharedAgentsDeps = { listSharedAgents };
export const invokeDeps = {
  getAindriveAccountToken, getSessionProof, invokeSharedAgent, saveTaskRef,
  listVillageMaterials: (slug: string) => listVillageMaterials(slug, villageMaterialsDeps.store),
  /** 17.3: invoke 가 resolve 한 에이전트의 소유자 관찰. */
  observeResolvedAgent: (ref: Parameters<typeof observeResolvedAgent>[0]) => observeResolvedAgent(ref, villageAgentsDeps.store),
  /** 17.3: 마을 자료를 넘기기 전 기다리는 소유자 확인. */
  verifyVillageAgentOwner: (slug: string, ref: Parameters<typeof verifyVillageAgentOwner>[1]) => verifyVillageAgentOwner(slug, ref, villageAgentsDeps.store),
};
/** 17.3 이벤트 반영: 상태(applyAgentEvents) + 소유권(agent.updated/moved → 레지스트리 재조회 → observeAgentOwners). */
export const eventsDeps = {
  getAindriveAccountToken, fetchEvents, applyAgentEvents,
  trackedAgentKeys: (keys: string[]) => trackedAgentKeys(keys, villageAgentsDeps.store),
  resolveAgentOwners,
  observeAgentOwners: (m: Parameters<typeof observeAgentOwners>[0]) => observeAgentOwners(m, villageAgentsDeps.store),
};
/** aindrive 계정 연결(connect/callback) 라우트의 저장소·원본 fetch·시계. */
export const aindriveConnectDeps = defaultOAuthDeps;
/** 17.5 마을 자료 라우트: 저장소(KV·멤버 판정)와 파일 해석. 17.4 전시 자료 가용성 확인(checkExhibits). */
export const villageMaterialsDeps = { store: defaultVillageStore, getAindriveAccountToken, resolveFiles, checkExhibits };
/** 17.7 채팅 첨부(새 첨부 → aindrive). */
export const attachmentsDeps = { getAindriveAccountToken, saveChatAttachment };
/** 17.5 마을 멤버십·검증된 체류·배치 에이전트(village-membership.ts)와 시계. 마을 생성·삭제 라우트도 이것을 쓴다. */
export const villageDeps = { directory: redisVillageDirectory, now: () => Date.now() };
/** 17.3 마을 배치 공유 에이전트(소유권 변경 재확인)의 저장소. */
export const villageAgentsDeps = { store: redisAgentStore };
