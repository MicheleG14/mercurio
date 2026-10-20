import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '@/app/AuthProvider';
import { routes } from '@/app/routes';
import { resetSessionStart } from '@/lib/auth/client';
import { companyStore } from '@/lib/auth/company';
import { ThemeProvider } from '@/lib/theme';

/** The whole app at a given address, with a fresh session and a fresh cache. */
export function renderApp(path: string) {
  resetSessionStart();
  companyStore.clear();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...view, router };
}
