import Link from 'next/link';

interface SectionHeadProps {
  eyebrow: string;
  title: string;
  linkText?: string;
  linkHref?: string;
}

export function SectionHead({ eyebrow, title, linkText, linkHref }: SectionHeadProps) {
  return (
    <div className="flex items-end justify-between mb-6 gap-6">
      <div>
        <div className="text-[13px] tracking-[0.18em] uppercase text-gold-ink font-semibold mb-1.5">
          {eyebrow}
        </div>
        <h2 className="font-antonio uppercase tracking-[0.04em] font-semibold text-[22px] m-0">
          {title}
        </h2>
      </div>
      {linkText && linkHref && (
        <Link
          href={linkHref}
          className="text-[13px] text-text-secondary font-medium px-2.5 py-2 rounded-md no-underline transition-colors hover:text-text-primary hover:bg-primary/[0.08]"
        >
          {linkText}
        </Link>
      )}
    </div>
  );
}
