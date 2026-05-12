import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'RateTap Login',
  robots: {
    index: false,
    follow: false,
  },
};

export default function Home() {
  redirect('/login');
}
