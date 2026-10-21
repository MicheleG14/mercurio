import { ApiError } from '@/lib/api';

/**
 * Field errors sent by the server (Problem Details `errors`) become messages on the same
 * fields: `{ field: 'password', code: 'TOO_SHORT' }` shows "validation.TOO_SHORT" under it.
 * Returns whether the error was fully explained by fields.
 */
export function serverFieldErrors(
  error: unknown,
  setError: (field: never, error: { message: string }) => void,
  fieldNames: readonly string[],
): boolean {
  if (!(error instanceof ApiError) || !error.problem?.errors?.length) return false;
  let shown = false;
  for (const { field, code } of error.problem.errors) {
    if (fieldNames.includes(field)) {
      setError(field as never, { message: `validation.${code}` });
      shown = true;
    }
  }
  return shown;
}
