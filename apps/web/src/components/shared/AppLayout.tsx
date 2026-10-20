import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { BrandMark } from './BrandMark';
import { LanguageToggle } from './LanguageToggle';
import { ThemeToggle } from './ThemeToggle';

const REPOSITORY_URL = 'https://github.com/MicheleG14/mercurio';

/** Layout of the public pages: status, sign-in, activation, choice of the customer. */
export function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border bg-card/60 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="flex flex-col leading-tight">
              <span className="font-semibold tracking-tight">{t('app.name')}</span>
              <span className="text-muted-foreground text-xs">{t('app.tagline')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-10">
        <Outlet />
      </main>

      <footer className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-wrap justify-between gap-2 px-4 py-6 text-sm">
        <span className="flex gap-4">
          <span>{t('app.demo')}</span>
          <Link className="hover:text-foreground underline underline-offset-4" to="/status">
            {t('nav.status')}
          </Link>
        </span>
        <a
          className="hover:text-foreground underline underline-offset-4"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
        >
          {t('footer.source')}
        </a>
      </footer>
    </div>
  );
}
