import { config } from 'dotenv';

config({ path: '.env.production.local' });
config({ path: '.env.local' });

const USAGE = `Usage:
  npx tsx scripts/mercadopago-link.ts <slug> [<slug> ...] [--payer-email someone@x.com] [--allow-test]

Options:
  --payer-email <email>  Override each restaurant's manager email
  --allow-test           Allow a MERCADOPAGO_ACCESS_TOKEN beginning with TEST-
  --help                 Show this help`;

type CliOptions = {
  allowTest: boolean;
  help: boolean;
  payerEmail?: string;
  slugs: string[];
};

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { allowTest: false, help: false, slugs: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--allow-test') {
      options.allowTest = true;
    } else if (arg === '--payer-email') {
      const payerEmail = args[index + 1];
      if (!payerEmail || payerEmail.startsWith('--')) {
        throw new Error('--payer-email requires an email address');
      }
      options.payerEmail = payerEmail;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.slugs.push(arg);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (options.slugs.length === 0) {
    throw new Error(`At least one restaurant slug is required.\n\n${USAGE}`);
  }

  const {
    MERCADOPAGO_ACCESS_TOKEN,
    cancelPreapproval,
    computeBillingStartDate,
    createPreapproval,
    getMercadoPagoBaseUrl,
    getPriceBreakdown,
  } = await import('../src/lib/mercadopago');

  if (!MERCADOPAGO_ACCESS_TOKEN) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured');
  }
  if (MERCADOPAGO_ACCESS_TOKEN.startsWith('TEST-') && !options.allowTest) {
    throw new Error(
      'Refusing to create client links with a TEST- Mercado Pago token. Pass --allow-test to override.',
    );
  }

  const [{ db }, { mercadopagoSubscriptions, restaurants }, { and, eq, ne }] =
    await Promise.all([
      import('../src/db'),
      import('../src/db/schema'),
      import('drizzle-orm'),
    ]);

  let created = 0;
  let skippedActive = 0;
  let failed = 0;
  const breakdown = getPriceBreakdown();

  for (const slug of options.slugs) {
    try {
      const restaurantRows = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.slug, slug))
        .limit(1);
      const restaurant = restaurantRows[0];
      if (!restaurant) {
        throw new Error(`Restaurant not found: ${slug}`);
      }

      const payerEmail = options.payerEmail ?? restaurant.managerEmail;
      if (!payerEmail) {
        throw new Error(`No payer email for restaurant: ${slug}`);
      }

      const billingStartsAt = computeBillingStartDate();

      const existing = await db
        .select()
        .from(mercadopagoSubscriptions)
        .where(
          and(
            eq(mercadopagoSubscriptions.restaurantId, restaurant.id),
            ne(mercadopagoSubscriptions.status, 'cancelled'),
          ),
        )
        .limit(1);

      // Never cancel/reissue a live subscription: an authorized row means
      // the customer already authorized and replacing it would silently kill
      // their paid plan. Reissue below only applies to not-yet-authorized
      // (pending) preapprovals.
      if (existing[0]?.status === 'authorized') {
        process.stdout.write(
          `${slug}\tSKIPPED_ACTIVE\tsubscription already authorized (${existing[0].preapprovalId ?? 'no preapproval id'})\n`,
        );
        skippedActive += 1;
        continue;
      }

      // Reissue safety: cancel the previous preapproval BEFORE creating a
      // new one, so a stale link can never be charged on the old start
      // date. Abort this slug if the cancel fails unexpectedly.
      const previousPreapprovalId = existing[0]?.preapprovalId;
      if (previousPreapprovalId) {
        await cancelPreapproval(previousPreapprovalId);
      }

      const preapproval = await createPreapproval({
        reason: 'RateTap Pro',
        externalReference: String(restaurant.id),
        payerEmail,
        amount: breakdown.total,
        backUrl: `${getMercadoPagoBaseUrl()}/settings?billing=mercadopago`,
        startDate: billingStartsAt,
      });

      if (existing[0]) {
        await db
          .update(mercadopagoSubscriptions)
          .set({
            preapprovalId: preapproval.id,
            status: preapproval.status ?? 'pending',
            amount: String(breakdown.total),
            baseAmount: String(breakdown.base),
            processingChargeAmount: String(breakdown.processingCharge),
            taxAmount: String(breakdown.tax),
            totalAmount: String(breakdown.total),
            billingStartsAt,
            payerEmail,
            externalReference: String(restaurant.id),
            updatedAt: new Date(),
          })
          .where(eq(mercadopagoSubscriptions.id, existing[0].id));
      } else {
        await db.insert(mercadopagoSubscriptions).values({
          restaurantId: restaurant.id,
          preapprovalId: preapproval.id,
          externalReference: String(restaurant.id),
          status: preapproval.status ?? 'pending',
          amount: String(breakdown.total),
          baseAmount: String(breakdown.base),
          processingChargeAmount: String(breakdown.processingCharge),
          taxAmount: String(breakdown.tax),
          totalAmount: String(breakdown.total),
          billingStartsAt,
          payerEmail,
        });
      }

      await db
        .update(restaurants)
        .set({ billingProvider: 'mercadopago' })
        .where(eq(restaurants.id, restaurant.id));

      process.stdout.write(`${slug}\t${payerEmail}\t${preapproval.init_point}\n`);
      created += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${slug}\tERROR\t${message}\n`);
      failed += 1;
    }
  }

  process.stdout.write(
    `Summary\tcreated=${created}\tskipped_active=${skippedActive}\tfailed=${failed}\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
