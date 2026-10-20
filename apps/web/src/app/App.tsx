import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ThemeProvider } from '@/lib/theme';
import { routes } from './routes';
import { AuthProvider } from './AuthProvider';

// The router knows the base path (e.g. /mercurio), so links and routes stay relative to it.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const router = createBrowserRouter(routes, { basename });

export function App() {
  // App-wide data policy: one retry for failed reads, never for writes.
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } } }),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
