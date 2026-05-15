import type { Metadata } from 'next';
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
  title: 'Meridian',
  description: 'AI-powered crypto trading analysis assistant',
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
