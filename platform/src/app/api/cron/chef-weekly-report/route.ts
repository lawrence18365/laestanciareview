import { NextRequest } from 'next/server';
import { deliveryFailed, runChefReport } from '@/lib/chef-weekly-report';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: 'cron_secret_not_configured' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  // Catch-up and recipient overrides exist only in the operator CLI.
  if (req.nextUrl.search) return Response.json({ error: 'query_parameters_not_allowed' }, { status: 400 });
  try {
    const result = await runChefReport({ mode: 'live' });
    return Response.json({ status: result.status, weekStart: result.window?.startDate, outcomes: result.outcomes }, {
      status: result.outcomes.some(deliveryFailed) ? 502 : 200,
    });
  } catch {
    // Do not log raw database/SMTP errors, comments, or addresses.
    console.warn('[chef-report] configuration_scope_or_ledger_check_failed');
    return Response.json({ error: 'chef_report_failed_check_configuration_scope_and_delivery_ledger_no_automatic_retry' }, { status: 500 });
  }
}
