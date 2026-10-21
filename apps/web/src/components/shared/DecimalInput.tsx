import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A text field for decimals typed in the person's language ("12,50" in Italian). It holds the
 * text as typed; lib/decimal.ts turns it into the API's format (B30) when the form is checked.
 * Not type="number": that would parse with the browser's rules and lose what was typed.
 */
export function DecimalInput(props: Omit<ComponentProps<typeof Input>, 'type' | 'inputMode'>) {
  return (
    <Input type="text" inputMode="decimal" autoComplete="off" className="tabular-nums" {...props} />
  );
}
