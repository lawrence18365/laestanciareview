// Read-only: prints how classifyLocation() reads every location for the last
// complete week. Run before changing thresholds or shipping a briefing.
import { config } from 'dotenv';
process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: '.env.production.local' });
config({ path: '.env.local' });

async function main() {
  const { getWeeklySignals, lastCompleteWeekStart } = await import('../src/lib/weekly-signal');
  const { signalLabel } = await import('../src/lib/location-signal');

  const weekStart = lastCompleteWeekStart();
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  console.log(`Reporting week: ${weekStart.toDateString()} → ${new Date(weekEnd.getTime() - 1).toDateString()}\n`);

  const rows = await getWeeklySignals(weekStart);
  rows.sort((a, b) => Number(b.signal.actionable) - Number(a.signal.actionable));

  for (const r of rows) {
    const flag = r.signal.actionable ? '  ⚠ ' : '    ';
    console.log(`${flag}${r.name}  [${signalLabel(r.signal.signal)}]`);
    console.log(`      scans ${r.scansLastWeek} → ${r.scansThisWeek}   meseros ${r.staffAskingLastWeek} → ${r.staffAskingThisWeek}   gm ${r.gmActiveDays}d`);
    console.log(`      ${r.signal.summary}\n`);
  }
  const alerts = rows.filter((r) => r.signal.actionable);
  console.log(`${alerts.length} of ${rows.length} locations flagged for a call.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
