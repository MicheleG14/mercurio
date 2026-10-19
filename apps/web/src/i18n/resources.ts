import enCommon from '@/locales/en/common.json';
import enStatus from '@/locales/en/status.json';
import itCommon from '@/locales/it/common.json';
import itStatus from '@/locales/it/status.json';

/**
 * One JSON file per language and per area (docs/conventions.md F21).
 * Adding a language = adding its folder under src/locales and one entry here.
 */
export const resources = {
  it: { common: itCommon, status: itStatus },
  en: { common: enCommon, status: enStatus },
} as const;

export type Language = keyof typeof resources;
export const LANGUAGES = Object.keys(resources) as Language[];
export const DEFAULT_LANGUAGE: Language = 'it';
export const LANGUAGE_STORAGE_KEY = 'mercurio.lang';

/** The Intl locale used to format numbers and dates for each language (docs/conventions.md F10). */
export const INTL_LOCALES: Record<Language, string> = { it: 'it-IT', en: 'en-GB' };
