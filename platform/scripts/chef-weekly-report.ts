import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { computeWeekWindow } from '../src/lib/chef-weekly-export';
import type { RunOptions } from '../src/lib/chef-weekly-report';

export function parseReportArgs(args: string[], now = new Date()): RunOptions & { auditFile?: string } {
  let sendPreview = false;
  let dryRun = false;
  let weekStart: string | undefined;
  let importManual = false;
  let auditFile: string | undefined;
  const previewTo: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === '--send-preview' && !sendPreview) sendPreview = true;
    else if (flag === '--dry-run' && !dryRun) dryRun = true;
    else if (flag === '--import-manual-sends' && !importManual) importManual = true;
    else if (flag === '--audit-file' && auditFile === undefined && args[i + 1] && !args[i + 1].startsWith('--')) auditFile = args[++i];
    else if (flag === '--week-start' && weekStart === undefined && args[i + 1] && !args[i + 1].startsWith('--')) weekStart = args[++i];
    else if (flag === '--preview-to' && args[i + 1] && !args[i + 1].startsWith('--')) previewTo.push(args[++i]);
    else throw new Error('Usage: chef-weekly-report.ts [--week-start YYYY-MM-DD] [--dry-run | --send-preview --preview-to ADDRESS ...]');
  }
  if (importManual || auditFile !== undefined) {
    if (!importManual || !auditFile || dryRun || sendPreview || previewTo.length || weekStart) throw new Error('Manual import requires --import-manual-sends --audit-file PATH only');
    return { mode: 'import', auditFile };
  }
  if (sendPreview && dryRun) throw new Error('Choose dry-run or send-preview, not both');
  if (sendPreview !== (previewTo.length > 0)) throw new Error('--send-preview requires explicit --preview-to; recipients are not used in dry-run');
  computeWeekWindow(weekStart, now);
  return { mode: sendPreview ? 'preview' : 'dry-run', weekStart, previewTo };
}

async function main() {
  const options = parseReportArgs(process.argv.slice(2));
  const platform = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  config({ path: path.join(platform, '.env.local'), quiet: true });
  // Load SMTP configuration only after the protected local environment.
  const { runChefReport, deliveryFailed } = await import('../src/lib/chef-weekly-report');
  const result = await runChefReport(options.mode === 'import' ? { ...options, audit: JSON.parse(fs.readFileSync(path.resolve(options.auditFile!), 'utf8')) } : options);
  if (result.status === 'dry-run' && result.report && result.window) {
    const directory = path.resolve(platform, '../data/chef-exports');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stem = `chef-report-${result.window.startDate}`;
    for (const [suffix, content] of [['html', result.report.html], ['txt', result.report.text]]) {
      const file = path.join(directory, `${stem}.${suffix}`);
      fs.writeFileSync(file, content, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
    }
    for (const attachment of result.report.attachments) {
      const file = path.join(directory, attachment.filename);
      fs.writeFileSync(file, attachment.content, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
    }
    process.stdout.write(`dry-run: ${directory}/${stem}.{html,txt}; CSV adjuntos guardados. Sin envíos ni cambios en la base de datos.\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: result.status, weekStart: result.window?.startDate, counts: result.report?.counts, outcomes: result.outcomes, imports: result.imports })}\n`);
  if (result.outcomes.some(deliveryFailed)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // No raw query/SMTP error can expose customer data or credentials.
    process.stderr.write('chef-report failed: check arguments, configuration, scope and ledger; do not retry an uncertain delivery.\n');
    process.exitCode = 1;
  });
}
