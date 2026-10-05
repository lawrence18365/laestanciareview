import { afterEach, describe, expect, it, vi } from 'vitest';
import MailComposer from 'nodemailer/lib/mail-composer';
const mocks = vi.hoisted(() => ({ smtp: vi.fn(), close: vi.fn(), transport: vi.fn(), analysis: vi.fn(() => { throw new Error('Automatic chef classification must not call the global helper'); }), pool: vi.fn(() => { throw new Error('No external DB in tests'); }) }));
vi.mock('../lib/review-classification', async (importOriginal) => ({ ...await importOriginal<typeof import('../lib/review-classification')>(), analyzeFeedbackText: mocks.analysis }));
vi.mock('@neondatabase/serverless', () => ({ Pool: mocks.pool, neonConfig: {} }));
vi.mock('nodemailer', () => ({ createTransport: (config: unknown) => { mocks.transport(config); return { sendMail: mocks.smtp, close: mocks.close }; } }));
vi.mock('imapflow', () => ({ ImapFlow: class { async connect() {} async list() { return [{ specialUse: '\\Sent', path: 'Sent' }]; } async append() {} async logout() {} } }));
import { buildChefReport, deliveryFailed, deliveryKey, deliverChefReport, isKitchenTopic, classifyKitchenSignals, publicKitchenRow, signalLabel, KITCHEN_SIGNALS, type KitchenSignalId, importManualDeliveries, validateManualAudit, liveRecipients, loadChefReport, normalizeRecipient, previewRecipients, reserveDelivery, runChefReport, validateScope, type CapturedComment, type ChefPool, type SqlClient } from '../lib/chef-weekly-report';
import { computeWeekWindow, UNIT_IDS, UNIT_NAMES } from '../lib/chef-weekly-export';
import { sendEmail } from '../lib/email';
import { parseReportArgs } from '../../scripts/chef-weekly-report';

const NOW = new Date('2026-10-05T14:00:00Z');
const window = computeWeekWindow(undefined, NOW);
const units = UNIT_IDS.map((id, i) => ({ id, slug: Object.keys(UNIT_NAMES)[i] }));
const env = { CHEF_REPORT_ENABLED: 'true', CHEF_REPORT_EMAIL: 'chef@example.test', CHEF_REPORT_PREVIEW_EMAILS: 'one@example.test,two@example.test' };
const comment = (feedback: string, extra: Partial<CapturedComment> & { staff_name?: string; customer_name?: string; customer_email?: string } = {}): CapturedComment => ({ restaurant_id: units[0].id, slug: units[0].slug, rating: 5, feedback, created_at: '2026-09-30T18:00:00Z', staff_name: null, customer_name: null, customer_email: null, ...extra });

// Stateful mock of the SQL boundary: per-key transaction locks serialize reserve
// calls; no PostgreSQL or SMTP connections are opened by these tests.
function fixture(rows: CapturedComment[] = [], options: { units?: typeof units; finalizeFailure?: boolean; commitFailure?: boolean; count?: number; staff?: string[] } = {}) {
  const events: { id: string; properties: Record<string, unknown>; committed: boolean }[] = [];
  const queries: { text: string; values: unknown[] }[] = [];
  const locks = new Map<string, Promise<void>>();
  const pool: ChefPool = {
    async connect(): Promise<SqlClient> {
      let unlock: (() => void) | undefined;
      const pending: typeof events = [];
      const backups = new Map<string, Record<string, unknown>>();
      return {
        async query(text, values = []) {
          queries.push({ text, values });
          if (text.includes('pg_advisory_xact_lock')) {
            const key = String(values[0]);
            const previous = locks.get(key) ?? Promise.resolve();
            let resolve!: () => void;
            const current = new Promise<void>((r) => { resolve = r; });
            locks.set(key, previous.then(() => current));
            await previous;
            const previousUnlock = unlock;
            unlock = () => { previousUnlock?.(); resolve(); };
          } else if (text.startsWith('SELECT id, properties')) {
            return { rows: events.filter((e) => e.committed && e.properties.fingerprint === values[1]).map((e) => ({ id: e.id, properties: structuredClone(e.properties) })) };
          } else if (text.startsWith('INSERT INTO product_events')) {
            const event = { id: String(events.length + 1), properties: JSON.parse(String(values[1])), committed: false };
            pending.push(event); events.push(event);
            return { rows: [{ id: event.id }] };
          } else if (text === 'COMMIT') {
            if (options.commitFailure) throw new Error('mock commit failure');
            for (const event of pending) event.committed = true;
            unlock?.(); unlock = undefined;
          } else if (text === 'ROLLBACK') {
            for (const event of pending) events.splice(events.indexOf(event), 1);
            for (const [id, properties] of backups) events.find((e) => e.id === id)!.properties = properties;
            unlock?.(); unlock = undefined;
          }
          else if (text.startsWith('UPDATE product_events')) {
            if (options.finalizeFailure) throw new Error('mock finalize failure');
            const event = events.find((e) => e.id === values[1]);
            if (event && (!text.includes("properties->>'status' = 'attempted'") || event.properties.status === 'attempted')) {
              backups.set(event.id, structuredClone(event.properties));
              Object.assign(event.properties, JSON.parse(String(values[0])));
              return { rows: [{ id: event.id }] };
            }
          } else if (text.startsWith('SELECT id, slug')) return { rows: options.units ?? units };
          else if (text.startsWith('SELECT count')) return { rows: [{ captured: options.count ?? rows.length }] };
          else if (text.startsWith('SELECT restaurant_id')) return { rows };
          else if (text.startsWith('SELECT name')) return { rows: (options.staff ?? []).map((name) => ({ name })) };
          return { rows: [] };
        },
        release() { unlock?.(); },
      };
    },
  };
  return { pool, queries, events };
}
const report = () => buildChefReport(window, units, [comment('La pasta estaba rica')]);
const successfulSend = () => vi.fn(async (_options: Parameters<typeof sendEmail>[0]) => ({ provider: 'smtp' as const, data: { id: 'mock-message-id' } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); mocks.smtp.mockReset(); mocks.close.mockReset(); mocks.transport.mockClear(); });

// Parse records, including quoted commas, double quotes and multiline fields.
function parseCsv(csv: string): string[][] {
  const records: string[][] = []; let row: string[] = []; let field = ''; let quoted = false;
  const input = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); records.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) records.push([...row, field]);
  return records;
}

describe('chef report scope, structured content and privacy', () => {
  it('fails closed on missing, duplicate, unexpected IDs/slugs or row/unit mismatch', () => {
    expect(() => validateScope(units.slice(1))).toThrow('chef_scope_mismatch');
    expect(() => validateScope([...units.slice(1), units[1]])).toThrow('chef_scope_mismatch');
    expect(() => validateScope(units.map((u, i) => i ? u : { id: 99, slug: u.slug }))).toThrow('chef_scope_mismatch');
    expect(() => validateScope(units.map((u, i) => i ? u : { id: u.id, slug: 'owner' }))).toThrow('chef_scope_mismatch');
    expect(() => buildChefReport(window, units, [comment('pasta', { restaurant_id: 4 })])).toThrow('chef_scope_mismatch');
  });
  it('includes twelve units and zero coverage without inventing activity or trends', () => {
    const output = buildChefReport(window, units, []);
    expect(output.counts).toEqual({ captured: 0, kitchen: 0, unclassified: 0 });
    for (const unit of Object.values(UNIT_NAMES)) expect(output.text).toContain(`${unit}: 0`);
    expect(output.text).toContain('Cero comentarios no significa cero actividad');
    expect(output.text).toContain('No se capturaron comentarios');
    expect(output.text).toContain('lunes 2026-09-28 a domingo 2026-10-04');
    expect(output.text).not.toMatch(/tendencia|recurrente|causado|retenidos/);
  });
  it('includes Pomodoro/cream misses, 5-star food signals and menu topics without asserting defects', () => {
    const output = buildChefReport(window, units, [comment('La pasta Pomodoro dejó mucho que desear'), comment('A las cremas les falta sazón'), comment('La carne estaba cruda'), comment('Podrían agregar postres sin azúcar'), comment('Buen servicio')]);
    expect(output.counts).toEqual({ captured: 5, kitchen: 4, unclassified: 1 });
    expect(output.rows.map((r) => r.signals)).toEqual([['pomodoro_preparation'], ['cream_flavor'], ['cut_doneness'], ['menu_suggestion'], []]);
    expect(output.text).toContain('5★');
    expect(output.text).toContain('Observaciones automáticas, no causas verificadas');
    expect(output.text).not.toContain('quejas verificadas');
    expect(isKitchenTopic('El término y la cocción, temperatura de la sopa')).toBe(true);
    expect(isKitchenTopic('Buena atención')).toBe(false);
  });
  it('correlates eleven fictional culinary cases per record to finite signals and parsed CSV metadata', () => {
    const cases: [string, KitchenSignalId[]][] = [
      ['Costillero algo duro', ['costillero_texture']],
      ['Asado de tira más rojo que el término 3/4 solicitado', ['asado_doneness']],
      ['El corte malo de sabor y término', ['cut_flavor', 'cut_doneness']],
      ['Cuidar sal en sopa', ['soup_salt']],
      ['El filete llegó demasiado cocido y no se pudo comer', ['filete_overcooked']],
      ['Los platillos muy sencillos', ['plate_presentation_suggestion']],
      ['El corte llegó algo frío a terraza', ['cut_temperature']],
      ['La crema de espinaca no tenía sabor', ['spinach_cream_flavor']],
      ['Cambien la preparación de pasta Pomodoro, no está nada bueno', ['pomodoro_preparation']],
      ['Mejoren los sabores de cremas', ['cream_flavor']],
      ['Tres fragmentos duros en hamburguesa, cuidar calidad de carne', ['burger_hard_fragments']],
    ];
    const inputs = cases.map(([text], i) => comment(text, { restaurant_id: units[i].id, slug: units[i].slug, created_at: `2026-10-01T${String(i + 6).padStart(2, '0')}:00:00Z`, rating: i % 5 + 1 }));
    const output = buildChefReport(window, units, inputs);
    expect(output.counts).toEqual({ captured: 11, kitchen: 11, unclassified: 0 });
    for (const [i, input] of inputs.entries()) {
      const row = output.rows.find((r) => r.unit === UNIT_NAMES[input.slug] && r.date === '2026-10-01' && r.rating === input.rating)!;
      expect(row.signals).toEqual(cases[i][1]);
      for (const attachment of output.attachments) {
        const record = parseCsv(attachment.content).slice(1).find((r) => r[0] === row.unit && r[1] === row.date && r[2] === String(row.rating));
        expect(record).toEqual([row.unit, row.date, String(row.rating), row.signals.map(signalLabel).join('; ')]);
      }
    }
    expect(output.html.match(/class="observation"/g)).toHaveLength(8);
  });
  it('release compatibility ignores throwing or inverted global polarity and concerns override mixed praise', () => {
    const cases: [string, KitchenSignalId[]][] = [
      ['El asado estaba demasiado rojo para el término tres cuartos pedido', ['asado_doneness']],
      ['Comida muy rica, excepto las espinacas con crema: les faltó un poco de sabor', ['spinach_cream_flavor']],
      ['Comida deliciosa. La crema de espinacas estaba sin sabor.', ['spinach_cream_flavor']],
      ['La sopa estaba fría. El mesero fue muy atento.', ['soup_temperature']],
      ['La comida deliciosa', ['food_praise']],
    ];
    for (const inverted of [false, true]) {
      mocks.analysis.mockImplementation(() => {
        if (!inverted) throw new Error('Global helper unavailable');
        return { positive: true, signals: ['negative:food_quality', 'negative:temperature'] } as never;
      });
      for (const [feedback, expected] of cases) {
        expect(() => classifyKitchenSignals(feedback)).not.toThrow();
        expect(classifyKitchenSignals(feedback)).toEqual(expected);
      }
    }
    expect(mocks.analysis).not.toHaveBeenCalled();
  });
  it.each([
    ['El asado no estaba demasiado rojo para el término pedido', []],
    ['Espinacas con crema, no les faltó sabor', []],
    ['El asado rojo fue justo lo que pedí, comida deliciosa', ['food_praise']],
    ['Comida deliciosa. La crema de espinacas tenía buen sabor.', ['food_praise']],
    ['La comida. El mesero fue excelente.', []],
    ['La sopa, el mesero fue excelente', []],
    ['La comida deliciosa y el servicio excelente', ['food_praise']],
  ] as [string, KitchenSignalId[]][])('release counterexample control: %s', (feedback, expected) => {
    expect(classifyKitchenSignals(feedback)).toEqual(expected);
  });
  it('uses incumbent branded table layout with separate menu suggestions and one reply CTA', () => {
    const output = buildChefReport(window, units, [comment('La carne estaba cruda'), comment('Podrían agregar postres sin azúcar'), comment('No podría agregar algo más, comida deliciosa')]);
    expect(output.html).toContain('alt="RateTap"');
    expect(output.html).toContain('ratetap_logo_transparent_background.png');
    expect(output.html).toContain('name="viewport"');
    expect(output.html).toContain('table role="presentation"');
    expect(output.html).toContain("Georgia,'Times New Roman',serif");
    expect(output.html.indexOf('Para revisar en cocina')).toBeLessThan(output.html.indexOf('Sugerencias de menú'));
    expect(output.html.indexOf('Sugerencias de menú')).toBeLessThan(output.html.indexOf('Valoraciones culinarias positivas'));
    expect(output.html.match(/Responde con lo revisado/g)).toHaveLength(1);
    expect(output.html).not.toMatch(/display:\s*(?:grid|flex)|<script/);
    // Existing paid-product wrapper, no new visual system. Enforce visible copy budget.
    expect(output.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length).toBeLessThan(450);
  });
  it('prioritizes concerns, bounds the body and attaches remaining structured observations only', () => {
    const rows = Array.from({ length: 12 }, (_, i) => comment(`El postre delicioso zzcanary${i}`));
    rows.push(comment('La carne estaba cruda zzcanaryExtra ' + 'x'.repeat(400)));
    const output = buildChefReport(window, units, rows);
    expect(output.html.match(/class="observation"/g)).toHaveLength(8);
    expect(output.text.indexOf(signalLabel('cut_doneness'))).toBeLessThan(output.text.indexOf(signalLabel('food_praise')));
    expect(parseCsv(output.attachments[1].content)).toHaveLength(14);
    expect(JSON.stringify(output)).not.toMatch(/zzcanary|xxx|texto completo en CSV/);
  });
  it('reconciles all captured rows, signals and unclassified without inferring positive feedback', () => {
    const output = buildChefReport(window, units, [comment('pasta rica'), comment('contact guest@example.test'), comment('Pregunten a Zorbi'), comment('La sopa estaba fría')]);
    expect(output.counts).toEqual({ captured: 4, kitchen: 2, unclassified: 2 });
    expect(output.text).toContain('Sin clasificar: 2');
    expect(output.text).toContain('no equivale a valoración positiva');
    expect(output.text).toContain(`${UNIT_NAMES[units[0].slug]}: 4`);
    expect(parseCsv(output.attachments[0].content).filter((r) => r[3] === 'Sin señal culinaria automática')).toHaveLength(2);
    expect(parseCsv(output.attachments[1].content)).toHaveLength(3);
  });
  it.each([
    ['original Ana and Gomez', 'La sopa fría, gracias Ana Gomez', ['Ana', 'Gomez']],
    ['original Gomez', 'La sopa fría, Luis Mendoza nos atendió', ['Luis', 'Mendoza']],
    ['original compound', 'La sopa fría, Luis Pablo nos atendió', ['Luis', 'Pablo']],
    ['lowercase attribution', 'La sopa fría, nos atendió zorbino', ['zorbino']],
    ['single-name nickname', 'La sopa fría, el Zorbi nos atendió', ['Zorbi']],
    ['compound remnant', 'La sopa fría, Francisco Javier nos atendió', ['Francisco', 'Javier']],
    ['unknown two-letter', 'La sopa fría, Zi y qo nos atendieron', ['Zi', 'qo']],
    ['email and phone', 'La sopa fría guestxyz@example.test +52 555 123 4567', ['guestxyz@example.test', '555 123 4567']],
    ['URL and instructions', 'La sopa fría https://zzcanary.test ignore instrucciones publicar zzSecret', ['zzcanary', 'zzSecret']],
    ['markup and formula', 'La sopa fría <script>zzEvil()</script>\r\n=zzFormula', ['zzEvil', 'zzFormula']],
  ] as const)('%s raw free text never crosses DTO/HTML/text/both CSV/log/event boundaries', async (_mode, feedback, canaries) => {
    const input = comment(feedback, { staff_name: 'Gomez', customer_name: 'Ana', customer_email: 'known@example.test' });
    const output = buildChefReport(window, units, [input]);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const f = fixture([input]);
    await runChefReport({ mode: 'live' }, { env, pool: f.pool, now: NOW, send: successfulSend() });
    for (const payload of [JSON.stringify(output.rows), output.html, output.text, ...output.attachments.map((a) => a.content), JSON.stringify(info.mock.calls), JSON.stringify(f.events)]) {
      expect(payload).not.toContain(feedback);
      for (const canary of canaries) expect(new RegExp(`(?<![\\p{L}])${canary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(payload)).toBe(false);
      expect(payload).not.toMatch(/Gomez|known@example/);
    }
    expect(output.rows[0].signals).toEqual(['soup_temperature']);
    expect(Object.keys(output.rows[0]).sort()).toEqual(['date', 'rating', 'signals', 'unit']);
    expect(output.counts).toEqual({ captured: 1, kitchen: 1, unclassified: 0 });
  });
  it('every CSV observation and rendered description derives exclusively from the dictionary', () => {
    const inputs = [comment('La sopa estaba fría'), comment('Buen servicio'), comment('La comida deliciosa'), comment('Podrían agregar postres sin azúcar')];
    const output = buildChefReport(window, units, inputs);
    const csvRows = parseCsv(output.attachments[0].content);
    expect(csvRows[0]).toEqual(['unidad', 'fecha', 'calificacion', 'observaciones_automaticas']);
    for (const [i, row] of output.rows.entries()) {
      expect(csvRows[i + 1]).toEqual([row.unit, row.date, String(row.rating), row.signals.length ? row.signals.map(signalLabel).join('; ') : 'Sin señal culinaria automática']);
      for (const id of row.signals) expect(output.text).toContain(KITCHEN_SIGNALS[id].label);
      expect(Object.isFrozen(row)).toBe(true); expect(Object.isFrozen(row.signals)).toBe(true);
    }
    for (const description of output.html.matchAll(/<p class="observation"[^>]*>([^<]*)<\/p>/g)) {
      expect(output.rows.map((r) => r.signals.map(signalLabel).join('; '))).toContain(description[1]);
    }
    expect(csvRows).toHaveLength(5);
  });
  it('rejects unsupported enums and metadata generically without echoing inputs', () => {
    for (const id of ['zzSecret', '__proto__', 'toString', '<script>zzSecret</script>']) {
      expect(() => signalLabel(id as KitchenSignalId)).toThrow(/^chef_signal_invalid$/);
      expect(() => publicKitchenRow(Object.values(UNIT_NAMES)[0], '2026-10-01', 5, [id as KitchenSignalId])).toThrow(/^chef_signal_invalid$/);
    }
    for (const rating of [0, 6, 4.5, NaN, '5']) expect(() => publicKitchenRow(Object.values(UNIT_NAMES)[0], '2026-10-01', rating, [])).toThrow(/^chef_public_row_invalid$/);
    for (const date of ['2026-02-30', '2026-01-01 zzSecret', 'zzSecret']) expect(() => publicKitchenRow(Object.values(UNIT_NAMES)[0], date, 5, [])).toThrow(/^chef_public_row_invalid$/);
    expect(() => publicKitchenRow('zzSecret', '2026-10-01', 5, [])).toThrow(/^chef_public_row_invalid$/);
    expect(() => buildChefReport({ ...window, startDate: 'zzSecret' }, units, [])).toThrow();
  });
  it('loads counts and private feedback only in a SELECT-only snapshot, refuses mismatch, never selects identity/contact', async () => {
    const f = fixture([comment('pasta'), comment('contact guest@example.test')]);
    expect((await loadChefReport(f.pool, window)).counts).toEqual({ captured: 2, kitchen: 0, unclassified: 2 });
    expect(f.queries[0].text).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.queries.findIndex((q) => q.text.startsWith('SELECT count'))).toBeLessThan(f.queries.findIndex((q) => q.text.startsWith('SELECT restaurant_id')));
    expect(f.queries.every((q) => !/INSERT|UPDATE|DELETE|staff|customer|email|phone/.test(q.text))).toBe(true);
    await expect(loadChefReport(fixture([], { count: 1 }).pool, window)).rejects.toThrow('chef_count_mismatch');
  });
});

describe('chef recipient gates, CLI and same-render preview', () => {
  it('is default-disabled before any database/SMTP work; enabled requires a single valid recipient', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      const f = fixture(); const send = successfulSend();
      expect((await runChefReport({ mode: 'live' }, { env: { CHEF_REPORT_ENABLED: flag }, pool: f.pool, send })).status).toBe('disabled');
      expect(f.queries).toEqual([]); expect(send).not.toHaveBeenCalled();
    }
    for (const address of [undefined, '', 'a@example.test,b@example.test', 'Display <a@example.test>', 'a@example.test\r\nBcc:b@example.test']) {
      await expect(runChefReport({ mode: 'live' }, { env: { CHEF_REPORT_ENABLED: 'true', CHEF_REPORT_EMAIL: address }, pool: fixture().pool })).rejects.toThrow('chef_recipient_missing_or_invalid');
    }
    expect(normalizeRecipient(' ONE@example.test ')).toBe('one@example.test');
  });
  it('requires preview allowlist and rejects outsider and live recipient even if allowlisted', async () => {
    expect(() => previewRecipients(['one@example.test'], {})).toThrow('chef_preview_allowlist_required');
    expect(() => previewRecipients(['outsider@example.test'], env)).toThrow('chef_preview_recipient_not_allowed');
    expect(() => previewRecipients(['chef@example.test'], { ...env, CHEF_REPORT_PREVIEW_EMAILS: 'chef@example.test' })).toThrow('chef_preview_recipient_not_allowed');
    const f = fixture(); const send = successfulSend();
    await expect(runChefReport({ mode: 'preview', previewTo: ['one@example.test', 'outsider@example.test'] }, { env, pool: f.pool, send })).rejects.toThrow('chef_preview_recipient_not_allowed');
    expect(f.queries).toEqual([]); expect(send).not.toHaveBeenCalled();
    await expect(deliverChefReport(f.pool, report(), window, 'live', 'other@example.test', env, send)).rejects.toThrow('target_mismatch');
    await expect(deliverChefReport(f.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, { ...env, CHEF_REPORT_ENABLED: 'false' }, send)).rejects.toThrow('chef_live_disabled');
  });
  it('has dry-run default, explicit single-week catch-up and no CLI live-send path', () => {
    expect(parseReportArgs([], NOW).mode).toBe('dry-run');
    for (const weekStart of ['2026-09-21', '2026-09-28']) expect(parseReportArgs(['--week-start', weekStart], NOW).weekStart).toBe(weekStart);
    expect(parseReportArgs(['--send-preview', '--preview-to', 'one@example.test'], NOW).mode).toBe('preview');
    for (const args of [['--send-preview'], ['--preview-to', 'one@example.test'], ['--send-live'], ['--send-preview', '--dry-run'], ['--week-start', '2026-10-05']]) expect(() => parseReportArgs(args, NOW)).toThrow();
  });
  it('does not mutate production ledger or invoke SMTP in dry-run', async () => {
    const f = fixture([comment('pasta')]); const send = successfulSend();
    const result = await runChefReport({ mode: 'dry-run', weekStart: '2026-09-28' }, { env: {}, pool: f.pool, now: NOW, send });
    expect(result.status).toBe('dry-run'); expect(result.report?.counts.captured).toBe(1);
    expect(f.events).toEqual([]); expect(send).not.toHaveBeenCalled();
    expect(f.queries.map((q) => q.text).join('\n')).not.toMatch(/product_events|INSERT|UPDATE/);
  });
  it('sends byte-identical text/HTML/attachments for preview and live except subject/recipient', async () => {
    const f = fixture([comment('La pasta Pomodoro dejó mucho que desear')]); const send = successfulSend();
    await runChefReport({ mode: 'preview', previewTo: ['one@example.test'] }, { env, pool: f.pool, now: NOW, send });
    await runChefReport({ mode: 'live' }, { env, pool: f.pool, now: NOW, send });
    expect(send).toHaveBeenCalledTimes(2);
    const preview = send.mock.calls[0][0] as unknown as Parameters<typeof sendEmail>[0];
    const live = send.mock.calls[1][0] as unknown as Parameters<typeof sendEmail>[0];
    expect(preview.subject).toBe(`[VISTA PREVIA] ${live.subject}`);
    expect(preview.to).toBe('one@example.test'); expect(live.to).toBe(env.CHEF_REPORT_EMAIL);
    expect(preview.text).toBe(live.text); expect(preview.html).toBe(live.html);
    expect(preview.attachments).toEqual(live.attachments);
    expect(live.requireRecipientAcceptance).toBe(true);
  });
});

describe('chef delivery durable reservation and SMTP uncertainty', () => {
  it('commits reservation BEFORE SMTP and concurrent identical runs send once', async () => {
    const f = fixture();
    const send = vi.fn(async () => {
      expect(f.events[0].committed).toBe(true);
      expect(f.queries.some((q) => q.text === 'COMMIT')).toBe(true);
      return { provider: 'smtp' as const, data: { id: 'mock-id' } };
    });
    const outcomes = await Promise.all([1, 2].map(() => deliverChefReport(f.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, send)));
    expect(send).toHaveBeenCalledTimes(1); expect(f.events).toHaveLength(1);
    expect(outcomes.map((o) => o.status).sort()).toEqual(['sent', 'skipped']);
    const insert = f.queries.find((q) => q.text.startsWith('INSERT'))!;
    expect(insert.text).toContain('NULL, NULL');
    expect(JSON.stringify(f.events)).not.toContain('@');
    expect(JSON.stringify(f.events)).not.toContain('pasta');
    expect(f.events[0].properties.messageId).toBe('mock-id');
  });
  it.each(['attempted', 'sent', 'failed', 'unknown'] as const)('never automatically retries %s reservations', async (status) => {
    const f = fixture(); const key = deliveryKey('live', window.startDate, env.CHEF_REPORT_EMAIL);
    await reserveDelivery(f.pool, key); f.events[0].properties.status = status;
    const send = successfulSend();
    const outcome = await deliverChefReport(f.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, send);
    expect(outcome).toMatchObject({ status: 'skipped', previousStatus: status });
    expect(send).not.toHaveBeenCalled(); expect(deliveryFailed(outcome)).toBe(status !== 'sent');
  });
  it('separates week, recipient and preview namespace fingerprints', async () => {
    const f = fixture();
    const keys = [deliveryKey('live', '2026-09-21', 'a@example.test'), deliveryKey('live', '2026-09-28', 'a@example.test'), deliveryKey('live', '2026-09-21', 'b@example.test'), deliveryKey('preview', '2026-09-21', 'a@example.test')];
    expect(new Set(keys.map((k) => k.fingerprint)).size).toBe(4);
    for (const key of keys) expect((await reserveDelivery(f.pool, key)).id).toBeDefined();
    expect(f.events).toHaveLength(4);
  });
  it.each([{ error: { responseCode: 550 }, status: 'unknown' }, { error: new Error('timeout including private@example.test'), status: 'unknown' }])('retains SMTP $status and reports sanitized actionable failure', async ({ error, status }) => {
    const f = fixture(); const send = vi.fn(async () => { throw error; });
    const outcome = await deliverChefReport(f.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, send);
    expect(outcome.status).toBe(status); expect(outcome.code).toContain('manual_check_no_retry');
    expect(f.events[0].properties.status).toBe(status); expect(deliveryFailed(outcome)).toBe(true);
    expect(JSON.stringify(outcome) + JSON.stringify(f.events)).not.toContain('private@example.test');
    await deliverChefReport(f.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not claim sent without messageId or when ledger finalization fails', async () => {
    const missingId = fixture();
    const result = await deliverChefReport(missingId.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, vi.fn(async () => ({ provider: 'smtp' as const })));
    expect(result.status).toBe('unknown'); expect(missingId.events[0].properties.status).toBe('unknown');
    const broken = fixture([], { finalizeFailure: true });
    expect((await deliverChefReport(broken.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, successfulSend())).code).toBe('ledger_finalize_failed_manual_check_no_retry');
    expect(broken.events[0].properties.status).toBe('attempted');
  });
  it('does not send if reservation commit fails', async () => {
    const f = fixture([], { commitFailure: true }); const send = successfulSend();
    await expect(deliverChefReport(f.pool, report(), window, 'live', env.CHEF_REPORT_EMAIL, env, send)).rejects.toThrow('mock commit failure');
    expect(send).not.toHaveBeenCalled();
  });
  it('SMTP helper requires actual recipient acceptance rather than only a generated messageId', async () => {
    vi.stubEnv('SMTP_USER', 'smtp@example.test'); vi.stubEnv('SMTP_PASS', 'mock-password');
    mocks.smtp.mockResolvedValueOnce({ messageId: 'generated', accepted: [], rejected: ['one@example.test'] });
    await expect(sendEmail({ to: 'one@example.test', subject: 'test', text: 'test', html: '<p>test</p>', requireRecipientAcceptance: true })).rejects.toThrow('acceptance not confirmed');
    mocks.smtp.mockResolvedValueOnce({ messageId: 'accepted', accepted: ['one@example.test'], rejected: [] });
    await expect(sendEmail({ to: 'one@example.test', subject: 'test', html: '<p>test</p>', requireRecipientAcceptance: true })).resolves.toMatchObject({ data: { id: 'accepted' } });
  });
});

const multiEnv = { CHEF_REPORT_ENABLED: 'true', CHEF_REPORT_EMAILS: 'CHEF@example.test,owner@example.test, chef@example.test', CHEF_REPORT_PREVIEW_EMAILS: 'one@example.test,two@example.test' };
const proof = (extra: Record<string, unknown> = {}) => ({ namespace: 'live', source: 'manual_smtp', status: 'smtp-accepted', to: 'chef@example.test', weekStart: '2026-09-28', messageId: '<manual-proof@example.test>', acceptedAt: '2026-10-05T13:00:00Z', ...extra });
const audit = (...deliveries: unknown[]) => ({ version: 1, deliveries });

describe('multi-target safe daily sweep and manual proof import', () => {
  it('normalizes and deduplicates two targets; rejects malformed lists, injection and conflicting legacy config', () => {
    expect(liveRecipients(multiEnv)).toEqual(['chef@example.test', 'owner@example.test']);
    for (const value of ['', 'a@example.test,', 'a..b@example.test', '.a@example.test', 'a@example.test\r\n', 'a@example.test,b@example.test,c@example.test']) expect(() => liveRecipients({ CHEF_REPORT_EMAILS: value })).toThrow();
    expect(() => liveRecipients({ ...multiEnv, CHEF_REPORT_EMAIL: 'chef@example.test' })).toThrow('conflicting_legacy');
    expect(liveRecipients({ CHEF_REPORT_EMAILS: 'chef@example.test', CHEF_REPORT_EMAIL: 'CHEF@example.test' })).toEqual(['chef@example.test']);
    for (const to of ['chef@example.test', 'owner@example.test']) expect(() => previewRecipients([to], { ...multiEnv, CHEF_REPORT_PREVIEW_EMAILS: to })).toThrow('not_allowed');
  });
  it('links the entire reply area to parsed mailbox with encoded week subject and matching SMTP replyTo', async () => {
    const output = buildChefReport(window, units, [comment('La sopa fría')], 'reply@example.test');
    const anchor = output.html.match(/<a href="(mailto:[^"]+)" style="([^"]+)"/)!;
    const url = new URL(anchor[1].replaceAll('&amp;', '&'));
    expect(url.protocol).toBe('mailto:'); expect(url.pathname).toBe('reply@example.test');
    expect(url.searchParams.get('subject')).toBe('Re: ' + output.subject);
    expect(anchor[1]).toContain(encodeURIComponent('Re: ' + output.subject));
    expect(anchor[2]).toContain('display:block;padding:18px');
    const send = successfulSend();
    await deliverChefReport(fixture().pool, output, window, 'live', 'chef@example.test', multiEnv, send);
    expect(send.mock.calls[0][0].replyTo).toBe(url.pathname);
    expect(() => buildChefReport(window, units, [], 'reply@example.test\r\n')).toThrow();
  });
  it('definite recipient rejection retries next day while accepted owner is never repeated; cap three attempts', async () => {
    const f = fixture();
    const send = vi.fn(async (options: Parameters<typeof sendEmail>[0]) => {
      if (options.to === 'chef@example.test') throw { command: 'RCPT TO', responseCode: 550 };
      return { provider: 'smtp' as const, data: { id: 'accepted-owner' } };
    });
    const run = (now: Date) => runChefReport({ mode: 'live' }, { env: multiEnv, now, pool: f.pool, send });
    expect((await run(NOW)).outcomes.map((o) => o.status)).toEqual(['failed', 'sent']);
    await run(NOW); expect(send).toHaveBeenCalledTimes(2);
    for (const day of [6, 7, 8]) await run(new Date('2026-10-0' + day + 'T14:00:00Z'));
    expect(send.mock.calls.filter(([o]) => o.to === 'chef@example.test')).toHaveLength(3);
    expect(send.mock.calls.filter(([o]) => o.to === 'owner@example.test')).toHaveLength(1);
    expect(f.events.find((e) => e.properties.status === 'failed')!.properties.attempts).toBe(3);
    expect(JSON.stringify(f.events)).not.toContain('chef@example');
  });
  it('retries positively known pre-SMTP failures, but never ambiguous DATA or attempted/unknown states', async () => {
    for (const error of [{ code: 'chef_pre_smtp_no_accept' }, { code: 'chef_recipient_rejected_no_accept' }, { command: 'DATA', responseCode: 550 }, new Error('private@example.test timeout')]) {
      const f = fixture(); const send = vi.fn(async () => { throw error; });
      await deliverChefReport(f.pool, report(), window, 'live', 'chef@example.test', multiEnv, send, { now: NOW, retry: true });
      await deliverChefReport(f.pool, report(), window, 'live', 'chef@example.test', multiEnv, send, { now: new Date('2026-10-06T14:00:00Z'), retry: true });
      const definite = 'code' in error;
      expect(send).toHaveBeenCalledTimes(definite ? 2 : 1);
      expect(f.events[0].properties.status).toBe(definite ? 'failed' : 'unknown');
      expect(JSON.stringify(f.events)).not.toContain('private@example.test');
    }
  });
  it('one unknown or reservation failure does not block the other recipient and is visible, not successful', async () => {
    const f = fixture(); const send = vi.fn(async (options: Parameters<typeof sendEmail>[0]) => {
      if (options.to === 'chef@example.test') throw new Error('ambiguous');
      return { provider: 'smtp' as const, data: { id: 'owner-accepted' } };
    });
    const result = await runChefReport({ mode: 'live' }, { env: multiEnv, now: NOW, pool: f.pool, send });
    expect(result.outcomes.map((o) => o.status)).toEqual(['unknown', 'sent']);
    expect(result.outcomes.some(deliveryFailed)).toBe(true);
    await runChefReport({ mode: 'live' }, { env: multiEnv, now: new Date('2026-10-06T14:00:00Z'), pool: f.pool, send });
    expect(send).toHaveBeenCalledTimes(2);
    const broken = fixture([], { commitFailure: true });
    expect((await runChefReport({ mode: 'live' }, { env: multiEnv, now: NOW, pool: broken.pool, send })).outcomes).toHaveLength(2);
  });
  it('first send waits for Monday 14 UTC; absent backlog is not sent and only recent two complete weeks are visited', async () => {
    const f = fixture(); const send = successfulSend();
    expect((await runChefReport({ mode: 'live' }, { env: multiEnv, now: new Date('2026-10-05T13:59:59Z'), pool: f.pool, send })).status).toBe('not-due');
    expect(f.queries).toEqual([]);
    await runChefReport({ mode: 'live' }, { env: multiEnv, now: NOW, pool: f.pool, send });
    expect(send).toHaveBeenCalledTimes(2); expect(f.events).toHaveLength(2);
    const queriedWeeks = f.queries.filter((q) => q.text.startsWith('SELECT id, properties')).map((q) => q.values[1]);
    for (const week of ['2026-09-28', '2026-09-21']) expect(queriedWeeks).toContain(deliveryKey('live', week, 'chef@example.test').fingerprint);
    expect(queriedWeeks).not.toContain(deliveryKey('live', '2026-09-14', 'chef@example.test').fingerprint);
  });
  it('backlog retries only recorded definite failures in recent two weeks for currently configured targets', async () => {
    const f = fixture();
    for (const [week, to] of [['2026-09-21', 'chef@example.test'], ['2026-09-14', 'chef@example.test'], ['2026-09-21', 'removed@example.test']]) {
      await reserveDelivery(f.pool, deliveryKey('live', week, to));
      Object.assign(f.events.at(-1)!.properties, { status: 'failed', retryable: true, attempts: 1, retryAfter: '2026-10-04T00:00:00Z' });
    }
    const send = successfulSend();
    await runChefReport({ mode: 'live' }, { env: multiEnv, now: NOW, pool: f.pool, send });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([o]) => o.to)).toEqual(['chef@example.test', 'owner@example.test', 'chef@example.test']);
    expect(f.events[0].properties.status).toBe('sent');
    expect(f.events[1].properties.attempts).toBe(1); expect(f.events[2].properties.attempts).toBe(1);
    expect(f.events.some((e) => e.properties.fingerprint === deliveryKey('live', '2026-09-21', 'owner@example.test').fingerprint)).toBe(false);
  });
  it('concurrent definite-failure retries consume one committed reservation and send once', async () => {
    const f = fixture(); await reserveDelivery(f.pool, deliveryKey('live', window.startDate, 'chef@example.test'));
    Object.assign(f.events[0].properties, { status: 'failed', retryable: true, attempts: 1, retryAfter: '2026-10-04T00:00:00Z' });
    const send = successfulSend();
    const results = await Promise.all([1,2].map(() => deliverChefReport(f.pool, report(), window, 'live', 'chef@example.test', multiEnv, send, { now: NOW, retry: true })));
    expect(send).toHaveBeenCalledTimes(1); expect(f.events[0].properties.attempts).toBe(2);
    expect(results.map((o) => o.status).sort()).toEqual(['sent', 'skipped']);
  });
  it('preserves cold-soup signal with ordinary role grammar and arbitrary service names', () => {
    for (const feedback of ['La sopa estaba fría. El mesero fue muy atento.', 'La sopa fría, Luis mendoza nos atendió', 'La sopa fría, gracias Luis mendoza', 'La sopa fría, buen servicio Zorbi']) {
      const output = buildChefReport(window, units, [comment(feedback)]);
      expect(output.rows[0].signals).toEqual(['soup_temperature']);
      expect(output.counts).toEqual({ captured: 1, kitchen: 1, unclassified: 0 });
      expect(JSON.stringify(output)).not.toMatch(/\b(?:mendoza|Zorbi|Luis|mesero)\b/);
    }
  });
  it('chef-only bounded continuations and fixed aliases retain flavor/term, overcooking and hard-fragment reports', () => {
    expect(classifyKitchenSignals('El corte estuvo malo. En general. Tanto sabor como término.')).toEqual(['food_quality_concern', 'cut_flavor', 'cut_doneness']);
    expect(classifyKitchenSignals('Pedí un filete y se pasaron de cocido')).toEqual(['filete_overcooked']);
    expect(classifyKitchenSignals('La hamburguesa tenía tres pedacitos de algo muy duro')).toEqual(['burger_hard_fragments']);
    expect(classifyKitchenSignals('El corte malo. El mesero fue grosero. Sabor y término.')).not.toContain('cut_flavor');
    expect(classifyKitchenSignals('El corte malo. La sopa muy rica. Sabor y término.')).not.toContain('cut_flavor');
    expect(classifyKitchenSignals('La sopa fría. La sopa fría.')).toEqual(['soup_temperature']);
  });
  it('chef-only praise and negation rules do not turn food compliments into concerns or service into food praise', () => {
    for (const feedback of ['El asado estuvo en su punto', 'La carne bien cocida', 'El filete no estaba demasiado cocido', 'La sopa no estaba fría', 'No hay nada que mejorar en la comida', 'Las cremas demasiado buenas', 'La hamburguesa no tenía fragmentos duros', 'El salón frío. Buen servicio']) {
      expect(classifyKitchenSignals(feedback).some((id) => KITCHEN_SIGNALS[id].kind === 'concern')).toBe(false);
    }
    expect(classifyKitchenSignals('La sopa. El mesero fue muy atento.')).toEqual([]);
    expect(classifyKitchenSignals('La comida deliciosa')).toEqual(['food_praise']);
    expect(classifyKitchenSignals('No podría agregar algo más, comida deliciosa')).toEqual(['food_praise']);
  });
  it('defers without reservation or SMTP when sweep deadline is exhausted', async () => {
    let ticks = 0; const f = fixture(); const send = successfulSend();
    const result = await runChefReport({ mode: 'live' }, { env: multiEnv, now: NOW, pool: f.pool, send, clock: () => ticks++ ? 44000 : 0 });
    expect(result.outcomes.every((o) => o.code === 'sweep_budget_deferred_no_smtp')).toBe(true);
    expect(f.events).toEqual([]); expect(send).not.toHaveBeenCalled();
  });
  it('manual CLI import needs both privileged flag and audit file, never live SMTP flags', () => {
    expect(parseReportArgs(['--import-manual-sends', '--audit-file', '/protected/proof.json'], NOW)).toEqual({ mode: 'import', auditFile: '/protected/proof.json' });
    for (const args of [['--import-manual-sends'], ['--audit-file', '/protected/proof.json'], ['--import-manual-sends', '--audit-file', '/protected/proof.json', '--send-preview'], ['--import-manual-sends', '--audit-file', '/protected/proof.json', '--dry-run'], ['--import-manual-sends', '--audit-file', '/protected/proof.json', '--week-start', '2026-09-28']]) expect(() => parseReportArgs(args, NOW)).toThrow();
  });
  it('audited import records truthful manual acceptance for both targets, is exactly idempotent and performs NO SMTP', async () => {
    const f = fixture(); const send = successfulSend();
    const evidence = audit(proof(), proof({ to: 'owner@example.test', messageId: '<owner-proof@example.test>' }));
    const result = await runChefReport({ mode: 'import', audit: evidence }, { env: multiEnv, now: NOW, pool: f.pool, send });
    expect(result.imports?.map((o) => o.status)).toEqual(['imported', 'imported']);
    expect((await importManualDeliveries(f.pool, evidence, multiEnv, NOW)).every((o) => o.status === 'already-imported')).toBe(true);
    expect(f.events).toHaveLength(2); expect(send).not.toHaveBeenCalled();
    expect(f.events.every((e) => e.properties.source === 'manual_smtp_import' && e.properties.status === 'sent' && e.properties.attempts === undefined)).toBe(true);
    expect(JSON.stringify(f.events)).not.toMatch(/"to"|owner@example.test"/);
    const live = await runChefReport({ mode: 'live' }, { env: multiEnv, now: NOW, pool: f.pool, send });
    expect(live.outcomes.every((o) => o.status === 'skipped' && o.previousStatus === 'sent')).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it('manual import fails closed on preview/outside/incomplete/invalid proof and all contradictory existing states', async () => {
    for (const override of [{ namespace: 'preview' }, { source: 'automated_smtp' }, { status: 'unknown' }, { to: 'outsider@example.test' }, { weekStart: '2026-10-05' }, { weekStart: '2026-09-29' }, { messageId: '' }, { messageId: 'id\r\n' }, { acceptedAt: '2026-10-06T13:00:00Z' }, { acceptedAt: '2026-09-28T05:00:00Z' }]) {
      const f = fixture(); await expect(importManualDeliveries(f.pool, audit(proof(override)), multiEnv, NOW)).rejects.toThrow(); expect(f.queries).toEqual([]);
    }
    expect(() => validateManualAudit(audit(proof(), proof()), multiEnv, NOW)).toThrow('duplicate_manual');
    for (const status of ['attempted', 'unknown', 'failed', 'sent']) {
      const f = fixture(); await reserveDelivery(f.pool, deliveryKey('live', '2026-09-28', 'chef@example.test')); f.events[0].properties.status = status;
      await expect(importManualDeliveries(f.pool, audit(proof(), proof({ to: 'owner@example.test' })), multiEnv, NOW)).rejects.toThrow('manual_import_conflict');
      expect(f.events).toHaveLength(1); expect(f.events[0].properties.status).toBe(status);
    }
    const f = fixture(); await importManualDeliveries(f.pool, audit(proof()), multiEnv, NOW);
    await expect(importManualDeliveries(f.pool, audit(proof({ messageId: '<different@example.test>' })), multiEnv, NOW)).rejects.toThrow('manual_import_conflict');
    expect(f.events[0].properties.messageId).toBe('<manual-proof@example.test>');
  });
  it('audited archive observation provenance is optional, truthful, exactly idempotent and conflict-bound', async () => {
    const archived = proof({ evidenceSource: 'sent_archive_observation', archiveObservedAt: '2026-10-05T13:00:00Z' });
    const f = fixture();
    await importManualDeliveries(f.pool, audit(archived), multiEnv, NOW);
    expect(f.events[0].properties).toMatchObject({ source: 'manual_smtp_import', evidenceSource: 'sent_archive_observation', archiveObservedAt: '2026-10-05T13:00:00.000Z', acceptedAt: '2026-10-05T13:00:00.000Z' });
    expect((await importManualDeliveries(f.pool, audit(archived), multiEnv, NOW))[0].status).toBe('already-imported');
    await expect(importManualDeliveries(f.pool, audit(proof()), multiEnv, NOW)).rejects.toThrow('chef_manual_import_conflict');
    for (const extra of [{ evidenceSource: 'sent_archive_observation' }, { archiveObservedAt: '2026-10-05T13:00:00Z' }, { evidenceSource: 'inbox_received', archiveObservedAt: '2026-10-05T13:00:00Z' }, { evidenceSource: 'sent_archive_observation', archiveObservedAt: '2026-10-05T13:01:00Z' }]) {
      const invalid = fixture(); await expect(importManualDeliveries(invalid.pool, audit(proof(extra)), multiEnv, NOW)).rejects.toThrow(/^chef_invalid_manual_audit$/); expect(invalid.queries).toEqual([]);
    }
    expect(validateManualAudit(audit(proof()), multiEnv, NOW)[0].evidenceSource).toBeUndefined();
  });
  it('chef wire Message-ID is identical in actual generated MIME, SMTP options, returned ID and ledger', async () => {
    vi.stubEnv('SMTP_USER', 'smtp@example.test'); vi.stubEnv('SMTP_PASS', 'mock-password');
    mocks.smtp.mockImplementationOnce(async (options) => {
      const headers = options.raw.toString('utf8').split('\r\n\r\n')[0];
      expect(headers.match(/^Message-ID: (.+)$/mi)?.[1]).toBe(options.messageId);
      expect(options.messageId).toMatch(/^<[a-f0-9-]+@ratetapmx\.com>$/);
      expect(headers.match(/^Message-ID:/gmi)).toHaveLength(1);
      return { messageId: '<different-response-id@example.test>', accepted: ['chef@example.test'], rejected: [] };
    });
    const f = fixture();
    expect((await deliverChefReport(f.pool, report(), window, 'live', 'chef@example.test', multiEnv, sendEmail)).status).toBe('sent');
    const options = mocks.smtp.mock.calls[0][0];
    expect(f.events[0].properties.messageId).toBe(options.messageId);
    expect(f.events[0].properties.messageId).not.toBe('<different-response-id@example.test>');
    mocks.smtp.mockImplementationOnce(async (next) => ({ messageId: 'provider-id', accepted: [next.to], rejected: [] }));
    const returned = await sendEmail({ to: 'chef@example.test', subject: 'wire test', html: '<p>test</p>', text: 'test', requireRecipientAcceptance: true, smtpTimeoutMs: 8000 });
    expect(returned.data?.id).toBe(mocks.smtp.mock.calls[1][0].messageId);
    expect(returned.data?.id).not.toBe(options.messageId);
  });
  it('chef-only SMTP deadline closes dedicated transport and leaves legacy callers on unchanged transport settings', async () => {
    vi.stubEnv('SMTP_USER', 'smtp@example.test'); vi.stubEnv('SMTP_PASS', 'mock-password');
    mocks.smtp.mockResolvedValueOnce({ messageId: 'legacy', accepted: ['one@example.test'], rejected: [] });
    await sendEmail({ to: 'one@example.test', subject: 'test', html: '<p>test</p>' });
    expect(mocks.close).not.toHaveBeenCalled();
    // MIME correctness uses the real composer in the separate wire-ID test.
    // This test isolates the transport timer, not composer stream scheduling.
    vi.spyOn(MailComposer.prototype, 'compile').mockReturnValue({ build: async () => Buffer.from('deadline fixture') } as unknown as ReturnType<MailComposer['compile']>);
    vi.useFakeTimers(); mocks.smtp.mockImplementationOnce(() => new Promise(() => {}));
    const pending = sendEmail({ to: 'one@example.test', subject: 'test', html: '<p>test</p>', requireRecipientAcceptance: true, smtpTimeoutMs: 8000 });
    const assertion = expect(pending).rejects.toThrow('deadline_unknown');
    await vi.advanceTimersByTimeAsync(8000); await assertion;
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.transport.mock.calls.at(-1)![0]).toMatchObject({ connectionTimeout: 2000, greetingTimeout: 2000, socketTimeout: 4000 });
  });
});
