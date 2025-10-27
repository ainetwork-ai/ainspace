'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="rounded-lg bg-white p-8 shadow-lg">
        <h2 className="mb-4 text-2xl font-bold text-red-600">Something went wrong!</h2>
        <p className="mb-4 text-gray-700">
          An error occurred while rendering this page. The error has been logged and our team will investigate.
        </p>
        {error.message && (
          <div className="mb-4 rounded bg-gray-100 p-4">
            <p className="font-mono text-sm text-gray-800">{error.message}</p>
          </div>
        )}
        <button
          onClick={reset}
          className="rounded bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
