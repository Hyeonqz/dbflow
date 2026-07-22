import Link from 'next/link';

export function StatCard({
  label,
  value,
  href,
  emphasis,
}: {
  label: string;
  value: number | string;
  href?: string;
  emphasis?: boolean;
}) {
  const base = `group block rounded-2xl p-5 ring-1 transition-shadow ${
    emphasis ? 'bg-primary text-white ring-primary' : 'bg-card text-ink ring-border'
  }`;

  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className={`text-sm ${emphasis ? 'text-white/90' : 'text-muted'}`}>{label}</p>
        {href && (
          <span
            aria-hidden
            className={`text-sm transition-transform group-hover:translate-x-0.5 ${
              emphasis ? 'text-white/90' : 'text-muted'
            }`}
          >
            →
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`focusable ${base} hover:shadow-md`}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}
