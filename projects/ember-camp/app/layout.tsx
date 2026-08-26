import type { Metadata, Viewport } from 'next';
import './globals.css';
import './voice.css';

export const metadata: Metadata = {
  title: 'Ember Camp — Live Conversational English',
  description: 'Learn conversational English from A1 to C2 by living through voice-first survival scenes.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#274d37',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
