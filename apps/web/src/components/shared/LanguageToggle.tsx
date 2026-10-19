import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LANGUAGES, type Language } from '@/i18n/resources';

export function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language) as Language;

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[current]}
      onValueChange={(values) => {
        const next = values[0] as Language | undefined;
        if (next) void i18n.changeLanguage(next);
      }}
      aria-label={t('language.label')}
    >
      {LANGUAGES.map((language) => (
        <ToggleGroupItem
          key={language}
          value={language}
          lang={language}
          title={t(`language.${language}`)}
        >
          <span className="font-mono text-xs uppercase">{language}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
