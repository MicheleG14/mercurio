import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMe } from '@/lib/auth/me';

/** The landing page after signing in. Module features join it in the next phases. */
export function HomePage() {
  const { t } = useTranslation('home');
  const { t: tAuth } = useTranslation('auth');
  const me = useMe().data;
  if (!me?.tenant) return null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('welcome', { name: me.user.name })}
        description={t('description', { tenant: me.tenant.name })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('role')}</CardTitle>
          </CardHeader>
          <CardContent>{tAuth(`roles.${me.role as 'ADMIN'}`)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('modules')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {me.modules.length === 0 && (
              <span className="text-muted-foreground">{t('noModules')}</span>
            )}
            {me.modules.map((key) => (
              <Badge key={key} variant="secondary">
                {t(`module.${key as 'registry'}`)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
      <p className="text-muted-foreground text-sm">{t('comingSoon')}</p>
    </div>
  );
}
