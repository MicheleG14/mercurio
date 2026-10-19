import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useTheme, type Theme } from '@/lib/theme';

const OPTIONS = [
  { value: 'system', Icon: MonitorIcon },
  { value: 'light', Icon: SunIcon },
  { value: 'dark', Icon: MoonIcon },
] as const satisfies readonly { value: Theme; Icon: unknown }[];

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      value={[theme]}
      onValueChange={(values) => {
        const next = values[0] as Theme | undefined;
        if (next) setTheme(next); // ignore clicks that would leave nothing selected
      }}
      aria-label={t('theme.label')}
    >
      {OPTIONS.map(({ value, Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(`theme.${value}`)}
          title={t(`theme.${value}`)}
        >
          <Icon />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
