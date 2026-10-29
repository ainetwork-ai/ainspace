/** Reject duplicate/unknown query parameters before any private membership lookup. */
export function parseHuddleMentionQuery(params: URLSearchParams, requireInstance: boolean): { instanceId?: string; after?: string } | null {
  const allowed = requireInstance ? ['instanceId', 'after'] : ['after'];
  const result: { instanceId?: string; after?: string } = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key) || Object.hasOwn(result, key) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) return null;
    if (key === 'instanceId') result.instanceId = value; else result.after = value;
  }
  return requireInstance && !result.instanceId ? null : result;
}
