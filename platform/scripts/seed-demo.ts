/**
 * Synthetic demo data for product screenshots (SQ-144 / US-11).
 *
 * Brand "Casa Demo": 1 group owner + 3 locations, 8 servers each, ~600 reviews
 * over 8 weeks plus 16 live-feed reviews from the last 6 hours, ~120 guests,
 * 1 WhatsApp campaign, 6 event leads, 2 quotes,
 * Google rating snapshots 4.5 -> 4.7 and product_events.
 *
 * Safety:
 * - Refuses to run unless DATABASE_URL points at localhost / 127.0.0.1.
 * - Wipes every public table before seeding (idempotent, deterministic).
 * - Fake data only: @example.com emails, +52 55 0000 xxxx phones, invented names.
 * - Passwords come from DEMO_SEED_PASSWORD (never committed).
 *
 * Usage (from platform/, against a LOCAL database only):
 *   node --env-file=.env.demo.local node_modules/tsx/dist/cli.mjs scripts/seed-demo.ts
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import {
  campaignContacts,
  eventCampaigns,
  eventLeads,
  googleRatingSnapshots,
  guestVisits,
  guests,
  productEvents,
  quotes,
  restaurants,
  reviews,
  staff,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/auth';
import { emptyConfig } from '../src/lib/quote-data';

const BRAND = 'casa-demo';
const WINDOW_START = Date.UTC(2026, 7, 14, 6, 0, 0); // 2026-08-14 00:00 Mexico City (UTC-6)
const WINDOW_DAYS = 56;
const MX_OFFSET_H = 6;

// --- guards -----------------------------------------------------------------

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL ?? '';
  if (!raw) throw new Error('seed-demo: DATABASE_URL is not set');
  const host = new URL(raw).hostname;
  // Remote demo databases (e.g. a Neon branch) must be named explicitly, so a
  // production URL can never be wiped by accident.
  const named = process.env.DEMO_DATABASE_HOST ?? '';
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal && (!named || named !== host)) {
    throw new Error(`seed-demo: refusing to wipe host "${host}"; set DEMO_DATABASE_HOST to this exact host to allow a remote demo branch`);
  }
  if (!process.env.DEMO_SEED_PASSWORD) {
    throw new Error('seed-demo: DEMO_SEED_PASSWORD is not set');
  }
}

// --- deterministic randomness ------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(144);
const chance = (p: number) => rng() < p;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const weighted = <T,>(items: readonly T[], weights: readonly number[]): T => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
};

/** A timestamp inside the 8-week window, weighted toward lunch and dinner. */
function randomMomentInWindow(): Date {
  const day = between(0, WINDOW_DAYS - 1);
  const localHour = weighted([12, 13, 14, 15, 19, 20, 21, 22], [1, 2, 1, 1, 3, 4, 3, 2]);
  const minute = between(0, 59);
  return new Date(WINDOW_START + day * 86_400_000 + (localHour + MX_OFFSET_H) * 3_600_000 + minute * 60_000);
}

const hoursAfter = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
const phone = (n: number) => `+52 55 0000 ${String(n).padStart(4, '0')}`;

// --- fake people and copy -----------------------------------------------------

const FIRST_NAMES = [
  'Ana', 'Sofía', 'Valeria', 'Mariana', 'Fernanda', 'Daniela', 'Paola', 'Regina',
  'Camila', 'Andrea', 'Diego', 'Jorge', 'Luis', 'Iker', 'Emiliano', 'Santiago',
  'Ricardo', 'Carlos', 'Alejandro', 'Hugo',
];
const LAST_NAMES = ['Mendoza', 'Salinas', 'Ortega', 'Villanueva', 'Cordero', 'Lara', 'Pacheco', 'Rentería', 'Olvera', 'Nava'];
const GM_NAMES = ['Gerente Demo Polanco', 'Gerente Demo Roma', 'Gerente Demo Condesa'];

const COMPLAINTS = [
  'La comida llegó fría y tardaron mucho en traerla.',
  'Nos cobraron un platillo que no pedimos.',
  'El mesero no se acercó en toda la comida.',
  'La mesa estaba sucia cuando llegamos.',
  'El vino llegó a temperatura incorrecta.',
  'Esperamos una hora para pedir la cuenta.',
  'El ruido de la barra no nos dejó hablar.',
];
const PRIVATE_POSITIVE = [
  'Todo muy bien, el mesero fue muy atento.',
  'La carne estaba en su punto. Volveremos.',
  'Buen servicio, aunque la música estaba un poco alta.',
  'Excelente atención en la terraza.',
];
const RESOLUTIONS = [
  'guest_recovered', 'guest_recovered', 'compensation_given', 'compensation_given',
  'not_an_issue', 'could_not_resolve', 'guest_already_left',
] as const;

const LOCATIONS = [
  { slug: 'casa-demo-polanco', name: 'Casa Demo Polanco', city: 'Ciudad de México' },
  { slug: 'casa-demo-roma', name: 'Casa Demo Roma', city: 'Ciudad de México' },
  { slug: 'casa-demo-condesa', name: 'Casa Demo Condesa', city: 'Ciudad de México' },
] as const;

// --- seed ---------------------------------------------------------------------

async function wipe(): Promise<void> {
  const rows = await db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const list: { tablename: string }[] = Array.isArray(rows) ? rows : (rows as { rows: { tablename: string }[] }).rows;
  if (list.length === 0) return;
  const names = list.map((r) => `"${r.tablename}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${names} RESTART IDENTITY CASCADE`));
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const password = process.env.DEMO_SEED_PASSWORD as string;
  const passwordHash = await hashPassword(password);

  await wipe();

  // Group owner (no staff, no reviews of its own) and three locations.
  await db.insert(restaurants).values({
    name: 'Casa Demo Grupo',
    slug: 'casa-demo-grupo',
    brand: BRAND,
    isOwner: true,
    managerEmail: 'dueno@example.com',
    contactName: 'Dueño Demo',
    city: 'Ciudad de México',
    adminPasswordHash: passwordHash,
    subscriptionStatus: 'active',
  });

  const locationRows = await db
    .insert(restaurants)
    .values(
      LOCATIONS.map((loc, i) => ({
        name: loc.name,
        slug: loc.slug,
        brand: BRAND,
        city: loc.city,
        managerEmail: `gerente${i + 1}@example.com`,
        contactName: GM_NAMES[i],
        googleReviewUrl: `https://example.com/review/${loc.slug}`,
        googlePlaceId: `demo-place-${loc.slug}`,
        googleRating: '4.7',
        googleReviewCount: 470,
        googleRatingUpdatedAt: new Date(WINDOW_START + WINDOW_DAYS * 86_400_000),
        googleThreshold: 4,
        adminPasswordHash: passwordHash,
        subscriptionStatus: 'active',
        pilot: false,
      })),
    )
    .returning({ id: restaurants.id, slug: restaurants.slug });

  // 8 servers per location, codes 101-108 / 201-208 / 301-308.
  const staffRows: { id: number; restaurantId: number; code: string; name: string }[] = [];
  for (const [i, loc] of locationRows.entries()) {
    const names = [...FIRST_NAMES].sort(() => rng() - 0.5).slice(0, 8);
    const values = names.map((name, j) => ({
      restaurantId: loc.id,
      code: String((i + 1) * 100 + j + 1),
      name,
      active: true,
    }));
    const inserted = await db.insert(staff).values(values).returning({ id: staff.id, restaurantId: staff.restaurantId, code: staff.code, name: staff.name });
    staffRows.push(...inserted);
  }
  const staffFor = (restaurantId: number) => staffRows.filter((s) => s.restaurantId === restaurantId);
  const SERVER_WEIGHTS = [22, 17, 15, 13, 11, 9, 7, 6];

  // ~600 reviews, 200 per location, spread over 8 weeks.
  const reviewValues: (typeof reviews.$inferInsert)[] = [];
  for (const loc of locationRows) {
    const team = staffFor(loc.id);
    for (let n = 0; n < 200; n++) {
      const server = team[weighted(team.map((_, k) => k), SERVER_WEIGHTS)];
      const createdAt = randomMomentInWindow();
      const roll = rng();
      const rating = roll < 0.64 ? 5 : roll < 0.84 ? 4 : roll < 0.91 ? 3 : roll < 0.96 ? 2 : 1;
      const base = {
        restaurantId: loc.id,
        staffId: server.id,
        staffCode: server.code,
        staffName: server.name,
        rating,
        createdAt,
      };

      if (rating >= 4) {
        const toGoogle = chance(0.7);
        reviewValues.push({
          ...base,
          sentToGoogle: toGoogle,
          feedback: toGoogle ? null : pick(PRIVATE_POSITIVE),
          status: 'reviewed',
        });
        continue;
      }

      if (rating === 3) {
        reviewValues.push({ ...base, sentToGoogle: false, feedback: pick(COMPLAINTS), status: 'reviewed' });
        continue;
      }

      // Complaints (rating 1-2): older ones carry an outcome, the last 4 days stay open.
      const ageDays = (WINDOW_START + WINDOW_DAYS * 86_400_000 - createdAt.getTime()) / 86_400_000;
      const feedback = pick(COMPLAINTS);
      if (ageDays > 4) {
        const reviewedAt = hoursAfter(createdAt, between(1, 3));
        reviewValues.push({
          ...base,
          sentToGoogle: false,
          feedback,
          status: 'resolved',
          reviewedAt,
          reviewedVia: chance(0.7) ? 'inbox' : 'push_action',
          escalatedAt: chance(0.2) ? hoursAfter(createdAt, 3) : null,
          resolvedAt: hoursAfter(createdAt, between(4, 20)),
          resolution: pick(RESOLUTIONS),
        });
      } else {
        reviewValues.push({
          ...base,
          sentToGoogle: false,
          feedback,
          status: chance(0.6) ? 'new' : 'reviewed',
        });
      }
    }
  }
  // Live feed: 16 reviews in the 2-6 hours before this run, at the captured location (Polanco),
  // from the first four servers. One private 3-star note stays open; the rest are 4-5 stars, a
  // third sent to Google. Own RNG stream and wall-clock times, so the 600-review history above is unchanged.
  const live = locationRows[0];
  const liveTeam = staffFor(live.id).slice(0, 4);
  const liveRng = mulberry32(2144);
  for (let n = 0; n < 16; n++) {
    const server = liveTeam[Math.floor(liveRng() * liveTeam.length)];
    const createdAt = new Date(Date.now() - (2 + liveRng() * 4) * 3_600_000);
    const base = { restaurantId: live.id, staffId: server.id, staffCode: server.code, staffName: server.name, createdAt };
    if (n === 0) {
      reviewValues.push({ ...base, rating: 3, sentToGoogle: false, feedback: 'La sopa llegó tibia y tardaron en cambiarla.', status: 'new' });
      continue;
    }
    const rating = liveRng() < 0.6 ? 5 : 4;
    const toGoogle = n % 3 === 1;
    const note = PRIVATE_POSITIVE[Math.floor(liveRng() * PRIVATE_POSITIVE.length)];
    reviewValues.push({ ...base, rating, sentToGoogle: toGoogle, feedback: toGoogle ? null : note, status: 'reviewed' });
  }

  for (let i = 0; i < reviewValues.length; i += 150) {
    await db.insert(reviews).values(reviewValues.slice(i, i + 150));
  }

  // Google rating snapshots, weekly, trending 4.5 -> 4.7.
  const trend = ['4.5', '4.5', '4.6', '4.6', '4.6', '4.6', '4.7', '4.7'];
  for (const loc of locationRows) {
    await db.insert(googleRatingSnapshots).values(
      trend.map((rating, w) => ({
        restaurantId: loc.id,
        rating,
        reviewCount: 380 + w * 12 + between(0, 3),
        capturedAt: new Date(WINDOW_START + (w * 7 + 6) * 86_400_000),
      })),
    );
  }

  // ~120 guests; 25 VIPs with 5+ visits; ~75% marketing consent.
  const guestValues: (typeof guests.$inferInsert)[] = [];
  const visitPlan: { guestIndex: number; visits: number }[] = [];
  for (let g = 0; g < 120; g++) {
    const loc = locationRows[g % 3];
    const visits = g < 25 ? between(5, 9) : g < 75 ? between(2, 4) : between(0, 1);
    const birthdayThisWeek = g < 18;
    const mmdd = birthdayThisWeek
      ? `10${String(10 + (g % 7)).padStart(2, '0')}`
      : `${String(between(1, 12)).padStart(2, '0')}${String(between(1, 28)).padStart(2, '0')}`;
    const statusRoll = rng();
    const status: 'validated' | 'pending_validation' | 'expired' =
      statusRoll < 0.75 ? 'validated' : statusRoll < 0.9 ? 'pending_validation' : 'expired';
    guestValues.push({
      restaurantId: loc.id,
      brand: BRAND,
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      whatsapp: phone(1000 + g),
      birthdayMmdd: mmdd,
      preferences: chance(0.4) ? [pick(['vino tinto', 'mesa en terraza', 'sin gluten', 'vegetariano'])] : [],
      marketingConsent: chance(0.75),
      status,
      validatedAt: status === 'validated' ? randomMomentInWindow() : null,
      capturedAt: randomMomentInWindow(),
    });
    visitPlan.push({ guestIndex: g, visits });
  }
  const insertedGuests = [];
  for (let i = 0; i < guestValues.length; i += 60) {
    insertedGuests.push(...(await db.insert(guests).values(guestValues.slice(i, i + 60)).returning({ id: guests.id, restaurantId: guests.restaurantId, marketingConsent: guests.marketingConsent })));
  }

  const visitValues: (typeof guestVisits.$inferInsert)[] = [];
  for (const plan of visitPlan) {
    const guest = insertedGuests[plan.guestIndex];
    const team = staffFor(guest.restaurantId);
    for (let v = 0; v < plan.visits; v++) {
      visitValues.push({
        guestId: guest.id,
        restaurantId: guest.restaurantId,
        visitDate: randomMomentInWindow(),
        loggedBy: pick(team).id,
      });
    }
  }
  for (let i = 0; i < visitValues.length; i += 200) {
    await db.insert(guestVisits).values(visitValues.slice(i, i + 200));
  }

  // Event leads across stages, two quotes, one WhatsApp campaign (Polanco).
  const polanco = locationRows[0];
  const leadStages = ['new', 'contacted', 'quoted', 'won', 'lost', 'contacted'] as const;
  const leadEvents = ['Cumpleaños', 'Reunión de empresa', 'Boda íntima', 'Cena de aniversario', 'Despedida', 'Evento privado'];
  const leadValues = leadStages.map((status, i) => ({
    restaurantId: polanco.id,
    source: 'whatsapp',
    phone: phone(9001 + i),
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    tipoEvento: leadEvents[i],
    pax: between(12, 60),
    fechaTentativa: `2026-11-${String(between(5, 28)).padStart(2, '0')}`,
    presupuestoPp: String(pick([650, 800, 950, 1200])),
    prioridad: i < 2 ? 'alta' : 'media',
    urgente: i === 0,
    status,
    createdAt: hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -(i + 1) * 30),
  }));
  const insertedLeads = await db.insert(eventLeads).values(leadValues).returning({ id: eventLeads.id, status: eventLeads.status });

  const quoteLeads = insertedLeads.filter((l) => l.status === 'quoted' || l.status === 'won');
  await db.insert(quotes).values(
    quoteLeads.map((lead, i) => ({
      restaurantId: polanco.id,
      quoteNumber: `COT-DEMO-${String(i + 1).padStart(3, '0')}`,
      status: lead.status === 'won' ? 'won' : 'sent',
      clientName: `Cliente Demo ${i + 1}`,
      clientPhone: phone(9101 + i),
      clientEmail: `cliente${i + 1}@example.com`,
      eventDate: `2026-11-${String(14 + i * 7).padStart(2, '0')}`,
      eventType: 'Cena privada',
      guestCount: 40 + i * 10,
      packageName: 'Menú de opciones',
      configJson: emptyConfig('opciones'),
      leadId: lead.id,
      publicToken: `demo-token-${i + 1}`,
      sentAt: hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -48 + i * 12),
      outcomeAmountMxn: lead.status === 'won' ? 58000 : null,
      outcomeAt: lead.status === 'won' ? hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -6) : null,
    })),
  );

  const [campaign] = await db
    .insert(eventCampaigns)
    .values({
      restaurantId: polanco.id,
      slug: 'noche-de-vino-demo',
      name: 'Noche de vino tinto',
      campaignType: 'house_event',
      audienceRule: 'all_consented',
      status: 'launched',
      eventDate: '2026-10-16',
      eventTime: '19:30',
      offerName: 'Noche de vino tinto',
      messageText: 'Hola {nombre}, este jueves tenemos una noche de vino tinto en Casa Demo Polanco. ¿Te apartamos mesa?',
      pricePerPerson: '650.00',
      capacity: 40,
      minimumSeats: 10,
      launchedAt: hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -72),
    })
    .returning({ id: eventCampaigns.id });

  const consentedAtPolanco = insertedGuests.filter((g) => g.restaurantId === polanco.id && g.marketingConsent).slice(0, 30);
  await db.insert(campaignContacts).values(
    consentedAtPolanco.map((g, i) => {
      const status = i < 18 ? 'replied' : i < 26 ? 'sent' : i < 29 ? 'queued' : 'opted_out';
      return {
        campaignId: campaign.id,
        restaurantId: polanco.id,
        guestId: g.id,
        segment: i < 10 ? 'vip' : 'regular',
        priority: i,
        status,
        sentAt: status === 'queued' ? null : hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -70),
        repliedAt: status === 'replied' ? hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -60) : null,
        optedOutAt: status === 'opted_out' ? hoursAfter(new Date(WINDOW_START + WINDOW_DAYS * 86_400_000), -60) : null,
      };
    }),
  );

  // product_events for the owner and GM dashboards (behavioural history).
  const eventNames = ['review_page_open', 'staff_scoreboard_open', 'guest_profile_opened', 'guest_filter_changed', 'guest_capture_page_open', 'push_notification_click'] as const;
  const eventValues: (typeof productEvents.$inferInsert)[] = [];
  for (let n = 0; n < 900; n++) {
    const loc = pick(locationRows);
    eventValues.push({
      eventName: pick(eventNames),
      restaurantId: loc.id,
      role: chance(0.2) ? 'owner' : 'gm',
      sessionId: `demo-session-${between(1, 240)}`,
      path: '/dashboard',
      displayMode: 'browser',
      properties: {},
      createdAt: randomMomentInWindow(),
    });
  }
  for (let i = 0; i < eventValues.length; i += 300) {
    await db.insert(productEvents).values(eventValues.slice(i, i + 300));
  }

  console.log(
    JSON.stringify({
      locations: locationRows.length,
      staff: staffRows.length,
      reviews: reviewValues.length,
      guests: insertedGuests.length,
      guestVisits: visitValues.length,
      eventLeads: insertedLeads.length,
      quotes: quoteLeads.length,
      campaigns: 1,
      campaignContacts: consentedAtPolanco.length,
      productEvents: eventValues.length,
    }),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
