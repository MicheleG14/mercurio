import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@/api/schema';
import { api, unwrap } from '@/lib/api-client';

export type Member = components['schemas']['MemberDto'];
export type AddMemberBody = components['schemas']['AddMemberDto'];
export type UpdateMemberBody = components['schemas']['UpdateMemberDto'];
export type AddedMember = components['schemas']['AddedMemberDto'];
export type ActivationCode = components['schemas']['ActivationCodeDto'];
export type CustomRole = components['schemas']['CustomRoleDto'];
export type BuiltinRoleInfo = components['schemas']['BuiltinRoleDto'];
export type RoleList = components['schemas']['RoleListDto'];
export type PermissionInfo = components['schemas']['PermissionInfoDto'];
export type RoleChoice = components['schemas']['RoleChoiceDto'];
export type RoleBody = components['schemas']['CreateRoleDto'];

const keys = {
  all: ['members'] as const,
  list: (q: string, page: number) => ['members', 'list', q, page] as const,
  roles: ['members', 'roles'] as const,
  catalog: ['members', 'catalog'] as const,
};

/** People, roles and the auth context depend on each other: a change refreshes all of them. */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.all }),
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
    ]);
}

export function useMembers(q: string, page: number) {
  return useQuery({
    queryKey: keys.list(q, page),
    queryFn: () =>
      unwrap(api.GET('/members', { params: { query: { q: q || undefined, page, pageSize: 25 } } })),
    placeholderData: keepPreviousData,
  });
}

export function useRoles() {
  return useQuery({ queryKey: keys.roles, queryFn: () => unwrap(api.GET('/roles')) });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: keys.catalog,
    queryFn: () => unwrap(api.GET('/roles/catalog')),
    staleTime: 60_000,
  });
}

export function useAddMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: AddMemberBody) => unwrap(api.POST('/members', { body })),
    onSuccess: invalidate,
  });
}

export function useUpdateMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateMemberBody & { id: string }) =>
      unwrap(api.PATCH('/members/{id}', { params: { path: { id } }, body })),
    onSuccess: invalidate,
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      unwrap(api.POST('/members/{id}/remove', { params: { path: { id } }, body: { version } })),
    onSuccess: invalidate,
  });
}

export function useIssueCode() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/members/{id}/activation-code', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
}

export function useSaveRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: RoleBody & { id?: string; version?: number }) => {
      const { id, version, basedOn, ...body } = input;
      return id
        ? unwrap(
            api.PUT('/roles/{id}', {
              params: { path: { id } },
              body: { ...body, version: version! },
            }),
          )
        : unwrap(api.POST('/roles', { body: { ...body, basedOn } }));
    },
    onSuccess: invalidate,
  });
}

export function useArchiveRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      unwrap(api.POST('/roles/{id}/archive', { params: { path: { id } }, body: { version } })),
    onSuccess: invalidate,
  });
}
