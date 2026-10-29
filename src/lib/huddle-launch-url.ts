/** Server-configured destination; no access token or SSO credential travels in the URL. */
export function huddleLaunchUrl(base: string | undefined, slug: string): string | null {
  if (!base || !/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  try {
    const url = new URL(base);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    url.pathname = '/meetings/space'; url.searchParams.set('slug', slug);
    return url.href;
  } catch { return null; }
}
