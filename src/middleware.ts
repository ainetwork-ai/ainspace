import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  process.env.ADMIN_DASHBOARD_URL,
].filter(Boolean) as string[];

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');

  // Only handle CORS for API routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Handle preflight (OPTIONS) requests
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
      response.headers.set('Access-Control-Max-Age', '86400');
      response.headers.set('Vary', 'Origin');
    }
    return response;
  }

  // Handle admin dashboard requests with verified secret
  const adminSecret = process.env.ADMIN_API_SECRET;
  if (
    adminSecret &&
    origin === process.env.ADMIN_DASHBOARD_URL &&
    request.headers.get('x-admin-secret') === adminSecret
  ) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-admin-verified', 'true');
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    return response;
  }

  // Handle actual requests — strip x-admin-verified to prevent header forgery
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-admin-verified');
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
