import 'i18next';
import type { resources } from './resources';

// Makes translation keys type-checked: t('status:title') compiles, t('status:titel') does not.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['it'];
  }
}
