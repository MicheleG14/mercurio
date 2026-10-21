import { Navigate } from 'react-router';
import { AppLayout } from '@/components/shared/AppLayout';
import { AccountPage } from '@/features/account/AccountPage';
import { ActivityPage } from '@/features/activity/ActivityPage';
import { ActivatePage } from '@/features/auth/ActivatePage';
import { EnrollPage } from '@/features/auth/EnrollPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { MfaPage } from '@/features/auth/MfaPage';
import { SelectTenantPage } from '@/features/auth/SelectTenantPage';
import { HomePage } from '@/features/home/HomePage';
import { ItemPage } from '@/features/registry/items/ItemPage';
import { ItemsPage } from '@/features/registry/items/ItemsPage';
import { PartiesPage } from '@/features/registry/parties/PartiesPage';
import { PartyPage } from '@/features/registry/parties/PartyPage';
import { StatusPage } from '@/features/status/StatusPage';
import { RequireAnonymous, RequireSession } from './AuthProvider';
import { ProtectedLayout } from './ProtectedLayout';

/** Every screen of the app; the guards decide who may see which. */
export const routes = [
  {
    element: <AppLayout />,
    children: [
      // Public: the status page shows nothing about any customer.
      { path: 'status', element: <StatusPage /> },
      {
        element: <RequireAnonymous />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'login/mfa', element: <MfaPage /> },
          { path: 'activate', element: <ActivatePage /> },
          { path: 'activate/enroll', element: <EnrollPage /> },
        ],
      },
      { path: 'select-tenant', element: <SelectTenantPage /> },
    ],
  },
  {
    element: <RequireSession />,
    children: [
      {
        element: <ProtectedLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'account', element: <AccountPage /> },
          { path: 'activity', element: <ActivityPage /> },
          { path: 'parties', element: <PartiesPage /> },
          { path: 'parties/new', element: <PartyPage /> },
          { path: 'parties/:id', element: <PartyPage /> },
          { path: 'items', element: <ItemsPage /> },
          { path: 'items/new', element: <ItemPage /> },
          { path: 'items/:id', element: <ItemPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];
