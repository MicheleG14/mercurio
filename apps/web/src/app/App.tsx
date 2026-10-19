import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppLayout } from '@/components/shared/AppLayout';
import { StatusPage } from '@/features/status/StatusPage';
import { ThemeProvider } from '@/lib/theme';

// The router knows the base path (e.g. /mercurio), so links and routes stay relative to it.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const router = createBrowserRouter(
  [
    {
      element: <AppLayout />,
      children: [{ index: true, element: <StatusPage /> }],
    },
  ],
  { basename },
);

export function App() {
  // App-wide data policy: one retry for failed reads, never for writes.
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } } }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
