import { Combobox } from '@base-ui/react/combobox';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckIcon, ChevronsUpDownIcon, LoaderIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface SearchComboboxProps<T> {
  /** The record chosen, kept so its label shows even when it is not among the results. */
  value: T | null;
  onChange: (value: T | null) => void;
  /** Asks the server; called with the text typed (empty: the first results). */
  search: (text: string) => Promise<T[]>;
  /** Identifies the search for caching: the same key and text reuse the answer. */
  queryKey: readonly unknown[];
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  /** A second line under the label (code, VAT number, stock). */
  itemDetail?: (item: T) => ReactNode;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** Milliseconds of quiet typing before asking the server. */
  delay?: number;
}

/**
 * Choosing one record among many, searched on the server as the person types (F12): items on a
 * document line, a supplier on its header. Base UI's Combobox gives the keyboard and screen
 * reader behaviour; TanStack Query does the asking (F13), so typing back the same text costs
 * nothing.
 */
export function SearchCombobox<T>({
  value,
  onChange,
  search,
  queryKey,
  itemKey,
  itemLabel,
  itemDetail,
  id,
  placeholder,
  disabled,
  delay = 250,
  ...aria
}: SearchComboboxProps<T>) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), delay);
    return () => clearTimeout(timer);
  }, [text, delay]);

  const results = useQuery({
    queryKey: [...queryKey, query],
    queryFn: () => search(query),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  // The chosen record stays among the items, or the input could not show its label.
  const items = useMemo(() => {
    const found = results.data ?? [];
    if (!value || found.some((item) => itemKey(item) === itemKey(value))) return found;
    return [...found, value];
  }, [results.data, value, itemKey]);

  return (
    <Combobox.Root
      items={items}
      filteredItems={results.data ?? []}
      value={value}
      onValueChange={(next) => {
        onChange(next);
        setText('');
      }}
      onInputValueChange={(next, { reason }) => {
        if (reason !== 'item-press') setText(next);
      }}
      onOpenChange={setOpen}
      itemToStringLabel={itemLabel}
      isItemEqualToValue={(item, other) => itemKey(item) === itemKey(other)}
      filter={null}
      disabled={disabled}
    >
      <Combobox.InputGroup className="relative">
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          aria-invalid={aria['aria-invalid']}
          aria-describedby={aria['aria-describedby']}
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 h-9 w-full min-w-0 rounded-lg border py-1 pr-9 pl-2.5 text-sm outline-none focus-visible:ring-3 disabled:opacity-50 aria-invalid:ring-3 max-md:h-11 max-md:text-base"
        />
        <Combobox.Trigger
          aria-label={t('combobox.open')}
          className="text-muted-foreground absolute inset-y-0 right-0 flex w-9 items-center justify-center"
        >
          {results.isFetching ? (
            <LoaderIcon className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronsUpDownIcon className="size-4" aria-hidden="true" />
          )}
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
          <Combobox.Popup
            aria-busy={results.isFetching || undefined}
            className="bg-popover text-popover-foreground border-border max-h-[min(var(--available-height),20rem)] w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-y-auto overscroll-contain rounded-lg border py-1 shadow-md"
          >
            <Combobox.Status>
              {results.error ? (
                <div className="text-destructive px-3 py-2 text-sm">{t('combobox.error')}</div>
              ) : null}
            </Combobox.Status>
            <Combobox.Empty>
              {!results.isFetching && !results.error ? (
                <div className="text-muted-foreground px-3 py-2 text-sm">
                  {query ? t('combobox.noMatch', { text: query }) : t('combobox.empty')}
                </div>
              ) : null}
            </Combobox.Empty>
            <Combobox.List>
              {(item: T) => (
                <Combobox.Item
                  key={itemKey(item)}
                  value={item}
                  className={cn(
                    'grid cursor-default grid-cols-[1rem_1fr] items-start gap-2 px-3 py-2 text-sm outline-none select-none',
                    'data-highlighted:bg-accent data-highlighted:text-accent-foreground max-md:min-h-11',
                  )}
                >
                  <Combobox.ItemIndicator className="mt-0.5">
                    <CheckIcon className="size-4" aria-hidden="true" />
                  </Combobox.ItemIndicator>
                  <span className="col-start-2 flex flex-col">
                    <span>{itemLabel(item)}</span>
                    {itemDetail && (
                      <span className="text-muted-foreground text-xs">{itemDetail(item)}</span>
                    )}
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
