import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(
  err: Error,
  request: {
    path: string;
  },
  context: {
    routerKind: 'Pages Router' | 'App Router';
    routePath: string;
    routeType: 'render' | 'route' | 'action' | 'middleware';
  },
) {
  Sentry.captureException(err, {
    tags: {
      router_kind: context.routerKind,
      route_type: context.routeType,
    },
    extra: {
      request_path: request.path,
      router_path: context.routePath,
    },
  });
}
