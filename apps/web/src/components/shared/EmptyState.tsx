import type { ReactNode } from 'react';

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-1 px-4 py-10 text-center text-sm">
      <p className="text-foreground font-medium">{title}</p>
      {children}
    </div>
  );
}
