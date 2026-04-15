import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.production.local' });
config({ path: '.env.local' });

const client = neon(process.env.DATABASE_URL!);

(async () => {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='restaurants'
       AND column_name IN ('contact_name','city','stripe_customer_id','stripe_subscription_id','subscription_status','trial_ends_at','shipping_address','nfc_cards_shipped_at')
     ORDER BY column_name;`
  );
  console.log('restaurants new cols:', cols.map((c) => c.column_name));
  const tbl = await client.query(
    `SELECT to_regclass('processed_stripe_events') AS t;`
  );
  console.log('processed_stripe_events:', tbl[0].t);
})();
