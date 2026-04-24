import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import QuoteBuilder from '@/components/quotes/QuoteBuilder';

export default async function NewQuotePage() {
  const session = await verifySession();
  if (!session) redirect('/login');
  if (session.role !== 'gm') redirect('/overview');

  return <QuoteBuilder />;
}
