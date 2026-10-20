import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from 'cn';

const alertVariants = cva('relative w-full rounded-lg border px-3 py-2.5 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      warning: 'border-warning/30 bg-warning-soft text-warning',
      success: 'border-success/30 bg-success-soft text-success',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Alert };
