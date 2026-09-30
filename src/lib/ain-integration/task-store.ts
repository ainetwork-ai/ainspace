/**
 * 호출 결과 TaskRef 보관 — 서버 전용, best-effort.
 *
 * Space 의 대화 상태는 Redis `user:<userId>:threads`(스레드 목록)에 있고 메시지 본문은 backend 에 있다.
 * TaskRef 는 스레드 옆에 `user:<userId>:ain_tasks` 해시(taskId → TaskRef)로 두고, 같은 대화에서 마지막
 * task 를 빨리 찾도록 `conversation` 별 포인터도 남긴다. 토큰은 TaskRef 에 없다(계약).
 * 실패해도 호출 응답에는 영향을 주지 않는다(로그만).
 */
import { getRedisClient } from '@/lib/redis';
import type { TaskRef } from './types';

const TTL_SEC = 86400 * 30;
const tasksKey = (userId: string) => `user:${userId}:ain_tasks`;
const lastKey = (userId: string) => `user:${userId}:ain_task_by_conversation`;

export async function saveTaskRef(userId: string, conversation: string, task: TaskRef): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.hSet(tasksKey(userId), { [task.taskId]: JSON.stringify(task) });
    await redis.hSet(lastKey(userId), { [conversation]: task.taskId });
    await redis.expire(tasksKey(userId), TTL_SEC);
    await redis.expire(lastKey(userId), TTL_SEC);
  } catch (error) {
    console.error('AIN task ref save failed:', error instanceof Error ? error.message : 'unknown');
  }
}

export async function getTaskRef(userId: string, taskId: string): Promise<TaskRef | null> {
  try {
    const redis = await getRedisClient();
    const v = await redis.hGet(tasksKey(userId), taskId);
    return v ? (JSON.parse(v) as TaskRef) : null;
  } catch (error) {
    console.error('AIN task ref read failed:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

export async function getLastTaskRef(userId: string, conversation: string): Promise<TaskRef | null> {
  try {
    const redis = await getRedisClient();
    const id = await redis.hGet(lastKey(userId), conversation);
    return id ? getTaskRef(userId, id) : null;
  } catch (error) {
    console.error('AIN task ref lookup failed:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}
