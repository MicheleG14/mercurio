import { z } from 'zod';

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
