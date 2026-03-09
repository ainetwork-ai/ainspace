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
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      response.headers.set('Access-Control-Max-Age', '86400');
    }
    return response;
  }

  // Handle actual requests
  const response = NextResponse.next();
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
