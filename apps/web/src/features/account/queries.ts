import { useMutation, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api-client';

export function useAuthEvents(page: number) {
  return useQuery({
    queryKey: ['account', 'events', page] as const,
    queryFn: () => unwrap(api.GET('/auth/events', { params: { query: { page, pageSize: 10 } } })),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      unwrap(api.POST('/auth/password', { body, parseAs: 'text' })),
  });
}

export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: (body: { password: string; code: string }) =>
      unwrap(api.POST('/auth/recovery-codes', { body })),
  });
}
