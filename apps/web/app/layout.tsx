import type { Metadata, Viewport } from 'next';
import { Inter, Antonio } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
});

const antonio = Antonio({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-antonio',
});

export const metadata: Metadata = {
  title: { default: 'Meridian', template: '%s · Meridian' },
  // Says what it does, not what it is built with. "AI-powered" was also
  // wrong: every number is computed in TypeScript, and Claude only narrates.
  description:
    'Finds the price levels where several timeframes agree, reads whether the market is compressing, trending or ranging, and writes the trade plan that follows.',
  applicationName: 'Meridian',
  // One password, one user, no public content. Nothing here should ever be
  // indexed, and the URL leaking is not the same as wanting visitors.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Matches --background in globals.css, so the browser chrome does not flash
  // white above a dark page on mobile.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4EFE7' },
    { media: '(prefers-color-scheme: dark)', color: '#0F1419' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${antonio.variable}`} suppressHydrationWarning>
      <body className="bg-background text-text-primary font-inter">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
