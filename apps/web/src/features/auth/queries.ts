import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api-client';
import { companyStore } from '@/lib/auth/company';
import { sessionStore } from '@/lib/auth/session';

export function useLogin() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      unwrap(api.POST('/auth/login', { body })),
  });
}

export function useVerifyMfa() {
  return useMutation({
    mutationFn: (body: { challengeToken: string; code: string }) =>
      unwrap(api.POST('/auth/mfa/verify', { body })),
    onSuccess: (session) => sessionStore.signIn(session),
  });
}

export function useActivate() {
  return useMutation({
    mutationFn: (body: { code: string; password: string }) =>
      unwrap(api.POST('/auth/activate', { body })),
  });
}

export function useEnrollStart() {
  return useMutation({
    mutationFn: (body: { enrollToken: string }) =>
      unwrap(api.POST('/auth/mfa/enroll/start', { body })),
  });
}

/**
 * Confirms the two-factor setup. The person is signed in at once, but the session is stored only
 * when they leave the recovery-codes screen, so the guard does not move them away before they
 * have saved the codes.
 */
export function useEnrollConfirm() {
  return useMutation({
    mutationFn: (body: { enrollToken: string; code: string }) =>
      unwrap(api.POST('/auth/mfa/enroll/confirm', { body })),
  });
}

export function useSelectTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tenantId: string) => unwrap(api.POST('/auth/tenant', { body: { tenantId } })),
    onSuccess: (session) => {
      // Everything cached belongs to the previous tenant.
      queryClient.clear();
      companyStore.clear();
      sessionStore.signIn(session);
    },
  });
}
