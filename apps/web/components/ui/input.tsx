'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-md border border-input bg-surface text-foreground placeholder:text-muted-foreground/70 ' +
  'transition-[border-color,box-shadow] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted/50';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Rendered inside the field on the left; decorative only. */
  leadingIcon?: React.ReactNode;
  trailing?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', invalid, leadingIcon, trailing, ...props }, ref) => {
    const field = (
      <input
        type={type}
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          fieldBase,
          'h-9 px-2.5 text-sm',
          leadingIcon && 'pl-8',
          trailing && 'pr-9',
          invalid &&
            'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/25',
          className,
        )}
        {...props}
      />
    );

    if (!leadingIcon && !trailing) return field;

    return (
      <div className="relative">
        {leadingIcon ? (
          <span
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4"
            aria-hidden="true"
          >
            {leadingIcon}
          </span>
        ) : null}
        {field}
        {trailing ? (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
            {trailing}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      fieldBase,
      'min-h-[80px] resize-y px-2.5 py-2 text-sm leading-relaxed',
      invalid &&
        'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/25',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-xs font-medium leading-none text-foreground peer-disabled:opacity-60',
      className,
    )}
    {...props}
  >
    {children}
    {required ? (
      <span className="ml-0.5 text-destructive" aria-hidden="true">
        *
      </span>
    ) : null}
  </LabelPrimitive.Root>
));
Label.displayName = 'Label';

/**
 * Field wrapper enforcing the form rules: a visible label, persistent helper
 * text, and an error rendered below the control and wired via aria-describedby.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = htmlFor ? `${htmlFor}-hint` : undefined;
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1 text-xs text-destructive text-pretty"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export { Input, Label, Textarea };
