import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { companyStore, useCompanyId } from '@/lib/auth/company';
import { signOut } from '@/lib/auth/client';
import { useMe } from '@/lib/auth/me';
import { BrandMark } from '@/components/shared/BrandMark';
import { LanguageToggle } from '@/components/shared/LanguageToggle';
import { ThemeToggle } from '@/components/shared/ThemeToggle';

interface NavItem {
  to: string;
  label: 'home' | 'activity' | 'account';
  /** Shown only with this permission. The API still checks it on every call (F18). */
  permission?: string;
}

const NAVIGATION: NavItem[] = [
  { to: '/', label: 'home' },
  { to: '/activity', label: 'activity', permission: 'audit:read' },
  { to: '/account', label: 'account' },
];

/**
 * The shell of the signed-in app: who and where (customer, company), the menu filtered by what
 * the person may do, theme, language and sign-out. The company is a working context chosen here,
 * not a field of the forms (docs/proposta-saas.md, azienda corrente).
 */
export function ProtectedLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const companyId = useCompanyId();
  const tenantId = me?.tenant?.id;
  const companies = me?.companies;

  useEffect(() => {
    if (tenantId && companies) {
      companyStore.initialise(
        tenantId,
        companies.map((c) => c.id),
      );
    }
  }, [tenantId, companies]);

  const items = NAVIGATION.filter(
    (item) => !item.permission || me?.permissions.includes(item.permission),
  );
  const company = companies?.find((c) => c.id === companyId);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border bg-card/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="font-semibold tracking-tight">{t('app.name')}</span>
            </div>
            <nav aria-label={t('nav.menu')} className="flex items-center gap-1">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `rounded-md px-2.5 py-1 text-sm ${isActive ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`
                  }
                >
                  {t(`nav.${item.label}`)}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {me?.tenant && (
              <div className="text-sm">
                <span className="text-muted-foreground">{t('context.tenant')}: </span>
                <span className="font-medium">{me.tenant.name}</span>
                {me.tenants.length > 1 && (
                  <Button variant="link" size="sm" onClick={() => navigate('/select-tenant')}>
                    {t('context.switchTenant')}
                  </Button>
                )}
              </div>
            )}
            {companies && companies.length > 1 ? (
              <div className="flex items-center gap-1.5 text-sm">
                <label htmlFor="company-select" className="text-muted-foreground">
                  {t('context.company')}:
                </label>
                <select
                  id="company-select"
                  className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
                  value={companyId ?? ''}
                  onChange={(event) => {
                    companyStore.choose(me!.tenant!.id, event.target.value);
                    // Data on screen belongs to the previous company.
                    void queryClient.invalidateQueries();
                  }}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legalName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              company && (
                <span className="text-sm">
                  <span className="text-muted-foreground">{t('context.company')}: </span>
                  <span className="font-medium">{company.legalName}</span>
                </span>
              )
            )}
            <LanguageToggle />
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut().then(() => navigate('/login'))}
            >
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-8">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
