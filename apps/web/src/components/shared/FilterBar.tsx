import { SlidersHorizontalIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBreakpoint } from '@/lib/breakpoint';

/**
 * Search and filters above a list (F12, F20): in one row on desktops and tablets; on a phone the
 * search stays visible and the filters move to a panel from the bottom, behind a button that
 * counts the active ones.
 */
export function FilterBar({
  search,
  activeCount,
  children,
}: {
  search: ReactNode;
  /** How many filters differ from their default, shown on the phone's button. */
  activeCount: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const breakpoint = useBreakpoint();
  const [open, setOpen] = useState(false);

  if (breakpoint !== 'phone') {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {search}
        {children}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">{search}</div>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontalIcon data-icon="inline-start" />
        {activeCount > 0 ? t('filters.active', { count: activeCount }) : t('filters.open')}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" closeLabel={t('actions.close')} className="rounded-t-xl">
          <SheetHeader>
            <SheetTitle>{t('filters.open')}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">{children}</div>
          <SheetFooter>
            <Button size="lg" onClick={() => setOpen(false)}>
              {t('filters.show')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
