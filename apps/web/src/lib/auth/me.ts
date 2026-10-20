import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api-client';
import { useSession } from './session';

export const meKey = (tenantId: string | null) => ['auth', 'me', tenantId] as const;

/** Who is signed in, with permissions, modules and companies of the current tenant. */
export function useMe() {
  const session = useSession();
  return useQuery({
    queryKey: meKey(session.tenantId),
    queryFn: () => unwrap(api.GET('/auth/me')),
    enabled: session.status === 'authenticated',
  });
}
