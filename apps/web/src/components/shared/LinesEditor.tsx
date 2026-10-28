import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LinesEditorProps {
  legend: string;
  /** A sentence under the legend: what the lines are for. */
  hint?: ReactNode;
  /** An error about the lines as a whole ("at least one line"), already translated. */
  error?: string;
  /** One stable key per line (react-hook-form's field ids), in order. */
  keys: string[];
  /**
   * The grid of a line on wider screens, as a literal Tailwind class so that it is generated:
   * the last column holds `aside` and the remove button.
   */
  columns: string;
  renderLine: (index: number) => ReactNode;
  /** Shown next to the remove button: the stock of the line, its amount. */
  renderAside?: (index: number) => ReactNode;
  addLabel: string;
  onAdd: () => void;
  /** The accessible name of a line's remove button: "Remove line 2". */
  removeLabel: (n: number) => string;
  onRemove: (index: number) => void;
  /** Lines that must stay: the remove button is disabled at this count. */
  minLines?: number;
}

/**
 * The lines of a document being written (stock documents, orders): a grid row each on wider
 * screens, a card each on a phone (F20), with a button to add one and one to remove each. The
 * fields of a line are the caller's; this component only lays them out (F12).
 */
export function LinesEditor({
  legend,
  hint,
  error,
  keys,
  columns,
  renderLine,
  renderAside,
  addLabel,
  onAdd,
  removeLabel,
  onRemove,
  minLines = 1,
}: LinesEditorProps) {
  return (
    <fieldset className="border-border flex flex-col gap-3 border-t pt-4">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      {error && <p className="text-destructive text-sm">{error}</p>}
      <ol className="flex flex-col gap-3">
        {keys.map((key, index) => (
          <li
            key={key}
            className={cn(
              'border-border bg-card grid gap-3 rounded-lg border p-3 md:items-start md:border-0 md:bg-transparent md:p-0',
              columns,
            )}
          >
            {renderLine(index)}
            <div className="flex items-end justify-between gap-3 md:h-full md:flex-col md:items-end md:justify-start md:pt-6">
              {renderAside?.(index) ?? <span />}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={removeLabel(index + 1)}
                disabled={keys.length <= minLines}
                onClick={() => onRemove(index)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" className="self-start" onClick={onAdd}>
        <PlusIcon data-icon="inline-start" />
        {addLabel}
      </Button>
    </fieldset>
  );
}
