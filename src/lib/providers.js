'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { App as AntApp } from 'antd';
import '@ant-design/v5-patch-for-react-19';

import ThemeProvider from './ThemeProvider.js';

/**
 * App-wide providers.
 *
 * The `staleTime` here is doing real work. In the old app, every navigation
 * remounted a component that re-queried Firestore — so going Members → Member →
 * Back re-downloaded the whole list. With a five-minute stale time, going back
 * is instant and costs nothing, and the data still refreshes on its own.
 */

export default function Providers({ children }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: (failureCount, error) => {
              // Never retry a rejection the server meant — only transient ones.
              const status = error?.status ?? 0;
              if (status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // A failed payment must never be auto-retried: the idempotency key
            // makes a deliberate retry safe, but a silent one is not our call.
            retry: false,
          },
        },
      }),
  );

  return (
    <AntdRegistry>
      {/* React Query wraps the theme, not the other way round: the theme is
          itself fetched, so it needs a query client above it. */}
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <AntApp>{children}</AntApp>
        </ThemeProvider>
      </QueryClientProvider>
    </AntdRegistry>
  );
}
