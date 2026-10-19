/** The Mercurio logo mark: an "M" on the primary colour with an amber dot. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect width="28" height="28" rx="7" className="fill-primary" />
      <path
        d="M7.5 20V9l6.5 7 6.5-7v11"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21.5" cy="7" r="2.2" className="fill-highlight" />
    </svg>
  );
}
