// Read-only report: this script never modifies access; enforcement is a manual decision for the first billing cycle.
import { config } from 'dotenv';

process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: '.env.production.local' });
config({ path: '.env.local' });

const USAGE = `Usage:
  npx tsx scripts/billing-report.ts [--json]

Options:
  --json  Print one JSON object instead of tab-separated rows
  --help  Show this help`;

const BUCKETS = [
  'AUTHORIZED_PAID',
  'AUTHORIZED_UNPAID',
  'PENDING_AUTHORIZATION',
  'NEVER_AUTHORIZED',
] as const;

const EXCLUDED_SLUGS = [
  'owner',
  'regional-queretaro',
  'regional-veracruz',
  'regional-central',
] as const;

type Bucket = (typeof BUCKETS)[number];

type ReportRow = {
  bucket: Bucket;
  slug: string;
  subscription_status: string;
  mp_status: string | null;
  last_payment_status: string | null;
  next_payment_date: string | null;
};

function parseArgs(args: string[]) {
  let json = false;
  let help = false;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { help, json };
}

function bucketFor(
  mpStatus: string | null,
  lastPaymentStatus: string | null,
): Bucket {
  if (mpStatus === 'authorized') {
    return lastPaymentStatus === 'approved'
      ? 'AUTHORIZED_PAID'
      : 'AUTHORIZED_UNPAID';
  }
  if (mpStatus === 'pending') return 'PENDING_AUTHORIZATION';
  return 'NEVER_AUTHORIZED';
}

function tsvValue(value: string | null): string {
  return value ?? '';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const [
    { db },
    { mercadopagoSubscriptions, restaurants },
    { asc, desc, eq, notInArray },
  ] = await Promise.all([
    import('../src/db'),
    import('../src/db/schema'),
    import('drizzle-orm'),
  ]);

  const joinedRows = await db
    .select({
      restaurantId: restaurants.id,
      slug: restaurants.slug,
      subscriptionStatus: restaurants.subscriptionStatus,
      mpStatus: mercadopagoSubscriptions.status,
      lastPaymentStatus: mercadopagoSubscriptions.lastPaymentStatus,
      nextPaymentDate: mercadopagoSubscriptions.nextPaymentDate,
    })
    .from(restaurants)
    .leftJoin(
      mercadopagoSubscriptions,
      eq(restaurants.id, mercadopagoSubscriptions.restaurantId),
    )
    .where(notInArray(restaurants.slug, [...EXCLUDED_SLUGS]))
    .orderBy(
      asc(restaurants.slug),
      desc(mercadopagoSubscriptions.updatedAt),
      desc(mercadopagoSubscriptions.createdAt),
      desc(mercadopagoSubscriptions.id),
    );

  // A restaurant can have historical MP rows. The query orders the current
  // (most recently updated) row first, and this map keeps exactly that one.
  const currentByRestaurant = new Map<number, (typeof joinedRows)[number]>();
  for (const row of joinedRows) {
    if (!currentByRestaurant.has(row.restaurantId)) {
      currentByRestaurant.set(row.restaurantId, row);
    }
  }

  const reportRows: ReportRow[] = [...currentByRestaurant.values()]
    .map((row) => ({
      bucket: bucketFor(row.mpStatus, row.lastPaymentStatus),
      slug: row.slug,
      subscription_status: row.subscriptionStatus,
      mp_status: row.mpStatus,
      last_payment_status: row.lastPaymentStatus,
      next_payment_date: row.nextPaymentDate?.toISOString() ?? null,
    }))
    .sort((a, b) => {
      const bucketDifference = BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket);
      return bucketDifference || a.slug.localeCompare(b.slug);
    });

  const counts = Object.fromEntries(
    BUCKETS.map((bucket) => [
      bucket,
      reportRows.filter((row) => row.bucket === bucket).length,
    ]),
  ) as Record<Bucket, number>;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ restaurants: reportRows, counts })}\n`);
    return;
  }

  for (const row of reportRows) {
    process.stdout.write(
      [
        row.bucket,
        row.slug,
        row.subscription_status,
        tsvValue(row.mp_status),
        tsvValue(row.last_payment_status),
        tsvValue(row.next_payment_date),
      ].join('\t') + '\n',
    );
  }
  process.stdout.write(
    ['SUMMARY', ...BUCKETS.map((bucket) => `${bucket}=${counts[bucket]}`)].join(
      '\t',
    ) + '\n',
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 0;
});
