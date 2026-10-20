import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, LANGUAGES, resources } from './resources';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: LANGUAGES,
    fallbackLng: DEFAULT_LANGUAGE,
    load: 'languageOnly', // "it-CH" uses the Italian files
    ns: ['common', 'status', 'account', 'activity', 'auth', 'errors', 'home'],
    defaultNS: 'common',
    // The user's choice wins, then the browser language (docs/conventions.md G2).
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false }, // React already escapes
  });

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;
