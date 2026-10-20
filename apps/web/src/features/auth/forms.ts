import { z } from 'zod';
import { ApiError } from '@/lib/api';

/**
 * Validation messages are translation keys (namespace `errors`, `validation.*`), not text, so the
 * schemas stay free of language (G2) and the form translates them when it shows them.
 */
export const requiredText = z.string().trim().min(1, 'validation.required');
export const emailField = z.string().trim().pipe(z.email('validation.email'));
export const sixDigits = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'validation.codeFormat');

/** A new password: length is what matters (NIST SP 800-63B), the server applies the same rule. */
export const passwordField = z
  .string()
  .min(12, 'validation.TOO_SHORT')
  .max(128, 'validation.TOO_LONG');

/** Used with `.refine` on a schema holding a password and its repetition. */
export const passwordsMatch = {
  path: ['confirm'],
  message: 'validation.passwordsDifferent',
};

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
