// Soak-week observability for the dish-variant chip picker shipped in
// 0a50680. Run after ~1 week of real-world hostess usage to decide where
// to set the max-variants cap (or whether to soft-warn vs hard-block).
//
// Usage from platform/:
//   pnpm tsx scripts/audit-variant-usage.ts
//
// Outputs one row per dish-with-variants per quote:
//   quote_id | created_at | dish_id | dish_name | cantidad | personas |
//   variants_picked | per_variant_qty (cantidad / variants_picked)
//
// Decision input:
//   - per_variant_qty < 4 → kitchen prep starts hurting (per Guillermo's gut)
//   - per_variant_qty < 2 → almost certainly bad UX, candidate hard cap
//   - distribution skewed toward "all 8 picked" with low cantidad → strong
//     signal hostesses don't realize the operational cost; ship the warning.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';

type QuoteRow = {
  id: number;
  created_at: string;
  guest_count: number;
  config_json: unknown;
};

type ConfigShape = {
  asado?: {
    cantidades?: Record<string, number>;
    dishVariants?: Record<string, string[]>;
  };
  carta?: {
    cantidades?: Record<string, number>;
    dishVariants?: Record<string, string[]>;
  };
};

// Names hardcoded so we don't pull the full MENU array into a script;
// add to this map if more dishes get `variants` instrumented later.
const DISHES_WITH_VARIANTS: Record<string, string> = {
  e1: 'Empanadas',
  p1: 'Spaguetti',
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // Pull the last 30 days of quotes — wide enough net for a 1-week soak
  // plus catch-up if the script is run a bit late.
  const quotes = (await sql`
    SELECT id, created_at, guest_count, config_json
    FROM quotes
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND config_json IS NOT NULL
    ORDER BY created_at DESC
  `) as QuoteRow[];

  console.log(`─── Audit: ${quotes.length} quotes in last 30 days with config_json ───\n`);

  const rows: Array<{
    quote_id: number;
    created_at: string;
    dish_id: string;
    dish_name: string;
    cantidad: number;
    personas: number;
    variants_picked: number;
    per_variant_qty: number;
    variants_list: string;
  }> = [];

  for (const q of quotes) {
    const cfg = q.config_json as ConfigShape;
    for (const mode of ['asado', 'carta'] as const) {
      const state = cfg[mode];
      if (!state?.dishVariants) continue;
      for (const [dishId, variants] of Object.entries(state.dishVariants)) {
        if (!variants || variants.length === 0) continue;
        const cantidad = state.cantidades?.[dishId] ?? 0;
        if (cantidad <= 0) continue;
        rows.push({
          quote_id: q.id,
          created_at: q.created_at,
          dish_id: dishId,
          dish_name: DISHES_WITH_VARIANTS[dishId] ?? `(unknown: ${dishId})`,
          cantidad,
          personas: q.guest_count,
          variants_picked: variants.length,
          per_variant_qty: +(cantidad / variants.length).toFixed(2),
          variants_list: variants.join(', '),
        });
      }
    }
  }

  if (rows.length === 0) {
    console.log('No quotes with dish variants picked yet. Either nobody has used the picker or it shipped too recently. Re-run in a few days.');
    return;
  }

  console.log('─── Per-quote variant usage ───');
  console.table(rows);

  console.log('\n─── Distribution of per_variant_qty ───');
  const buckets = { '<2': 0, '2-3': 0, '4-5': 0, '6-9': 0, '10+': 0 };
  for (const r of rows) {
    if (r.per_variant_qty < 2) buckets['<2']++;
    else if (r.per_variant_qty < 4) buckets['2-3']++;
    else if (r.per_variant_qty < 6) buckets['4-5']++;
    else if (r.per_variant_qty < 10) buckets['6-9']++;
    else buckets['10+']++;
  }
  console.table(buckets);

  console.log('\n─── Hostess intent summary ───');
  const byDish: Record<string, { uses: number; avgVariants: number; minPerVariant: number }> = {};
  for (const r of rows) {
    const b = (byDish[r.dish_name] ??= { uses: 0, avgVariants: 0, minPerVariant: Infinity });
    b.uses++;
    b.avgVariants = ((b.avgVariants * (b.uses - 1)) + r.variants_picked) / b.uses;
    b.minPerVariant = Math.min(b.minPerVariant, r.per_variant_qty);
  }
  console.table(byDish);

  console.log('\n─── Recommendation thresholds ───');
  console.log(`Quotes where per_variant_qty < 4 (kitchen pain): ${rows.filter((r) => r.per_variant_qty < 4).length} / ${rows.length}`);
  console.log(`Quotes where per_variant_qty < 2 (severe pain): ${rows.filter((r) => r.per_variant_qty < 2).length} / ${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
