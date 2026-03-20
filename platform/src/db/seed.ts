import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants, staff } from './schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/auth';
import { makeCode } from '../lib/staff-code';

// ── Restaurant definitions with real GM contact info ──────────────────────────

interface StaffMember {
  code: string;
  name: string;
}

interface RestaurantDef {
  name: string;
  slug: string;
  managerEmail?: string;
  managerPhone?: string;
  googleReviewUrl?: string;
  googlePlaceId?: string;
  googleThresholdOverride?: number;
  region?: string;
  staff: (string | StaffMember)[];
}

const allRestaurants: RestaurantDef[] = [
  // ── La Estancia Argentina ──────────────────────────────────────────────────
  {
    name: 'Estancia Angelopolis',
    slug: 'estancia-angelopolis',
    region: 'central',
    googlePlaceId: 'ChIJ_41sFEfHz4UReU4Ibxwt7ZE',
    managerEmail: 'gerencia.ea.angelopolis@grupoestancia.com',
    managerPhone: '+522214256201',
    staff: [
      'JUAN CARLOS',
      'JUAN HUACHINA',
      'LAURO JHOVANNI',
      'ARMANDO REYES',
      'VICTOR ORTIZ',
      'ALEJANDRO ZAYAS',
      'JHONATAN FERNANDO',
      'JALIL ABRAHAM',
      'FERNANDO GARCIA',
      'RICARDO VELEZ',
      'RICARDO SANCHEZ',
      'SALVADOR ROJAS',
      'MARINO CAMARGO',
      'SONIA GABRIELA',
      'MIGUEL ALEJANDRO',
      'ALEJANDRO RIVERA',
      'LUIS ANTONIO',
      'MARIA JOSE',
      'ANGEL HUERTA',
      'NESTOR ISMAEL',
    ],
  },
  {
    name: 'Estancia Juarez',
    slug: 'estancia-juarez',
    region: 'central',
    googlePlaceId: 'ChIJKWIzU9TGz4URvKPuW4Y3vwE',
    managerEmail: 'gerencia.ea.juarez@grupoestancia.com',
    managerPhone: '+522221362868',
    staff: [
      'EDUARDO LOPEZ',
      'LUIS ANGEL',
      'EMMANUEL MORALES',
      'LEONARDO CHICO',
      'ERICK ALEXIS',
      'MARIA DE LOS ANGELES',
      'JEOVANI EMMANUEL',
      'EDUARDO MARTINEZ',
      'FRANCISCO JAVIER',
      'RICARDO ALEXIS',
    ],
  },
  {
    name: 'Estancia Veracruz',
    slug: 'estancia-veracruz',
    region: 'veracruz',
    googlePlaceId: 'ChIJ141TIDBBw4URPqBRbdzo5Vw',
    managerEmail: 'gerencia.ea.veracruz@grupoestancia.com',
    managerPhone: '+522221775746',
    staff: [
      'VICTOR LOPEZ',
      'JOSE ARMANDO',
      'GERARDO SALVADOR',
      'JESUS RAMOS',
      'FILIBERTO ANTONIO',
      'JULIO CESAR',
      'LUIS FELIPE',
      'JOSE LUIS',
      'EDGAR ADAIN',
      'ALFONSO PEÑA',
      'JESUS DAVID',
      'CARLOS ADRIAN',
      'JUAN DE DIOS',
      'IRVING XAVIER',
      'EDUARDO ADALBERTO',
    ],
  },
  {
    name: 'Estancia Xalapa',
    slug: 'estancia-xalapa',
    region: 'veracruz',
    googlePlaceId: 'ChIJaSYEreUz24URIjxXUA0LOF8',
    managerEmail: 'gerencia.ea.xalapa@grupoestancia.com',
    managerPhone: '+524421198779',
    staff: [
      'ERIK ALEXANDER',
      'JORGE ARMANDO',
      'RAUL VAZQUEZ',
      'DENNY URIEL',
      'JOSE ROJAS',
      'ERICK GONZALEZ',
      'GUILLERMO GARCIA',
      'URIEL ARTURO',
      'FILIBERTO ANTONIO',
    ],
  },
  {
    name: 'Estancia Queretaro',
    slug: 'estancia-queretaro',
    region: 'queretaro',
    googlePlaceId: 'ChIJy_ckRy9F04URgrAX2Hqek1o',
    managerEmail: 'esteban.ort@outlook.com',
    managerPhone: '+524426047157',
    staff: [
      'IVAN EDUARDO',
      'ERICK MARTINEZ',
      'ORLANDO ISIDRO',
      'MIGUEL CRUZ',
      'ALEJANDRA CABRERA',
      'CHRISTIAN SALVATORI',
      'RICARDO SAUL',
      'OSCAR LOPEZ',
      'KARLA ARISBETH',
      'IVETT SANCHEZ',
      'SILVIA PAOLA',
    ],
  },
  {
    name: 'Estancia Leon',
    slug: 'estancia-leon',
    region: 'central',
    googlePlaceId: 'ChIJM1x5LlW-K4QRrPy1SMe-04E',
    googleReviewUrl: 'https://g.page/r/Caz8tUjHvtOBEBM/review',
    googleThresholdOverride: 5,
    staff: [
      // Original codes from legacy system — NFC cards already printed
      { code: 'EDUARDO001', name: 'Eduardo' },
      { code: 'PEDROLOPEZ002', name: 'Pedro López' },
      { code: 'PEDROOROCIO003', name: 'Pedro Orocio' },
      { code: 'EMILIANO004', name: 'Emiliano' },
      { code: 'DAVID005', name: 'David' },
      { code: 'LEOGASCA006', name: 'Leo Gasca' },
      { code: 'LEOREYNOSO007', name: 'Leo Reynoso' },
      { code: 'ULISES008', name: 'Ulises' },
      { code: 'GERARDO009', name: 'Gerardo' },
      { code: 'CARLOS010', name: 'Carlos' },
      { code: 'JULIO011', name: 'Julio' },
      { code: 'FERNANDO012', name: 'Fernando' },
      { code: 'ESMERALDA', name: 'Delia Esmeralda' },
    ],
  },

  // ── La Silla ───────────────────────────────────────────────────────────────
  {
    name: 'La Silla Juarez',
    slug: 'la-silla-juarez',
    region: 'central',
    googlePlaceId: 'ChIJ7zN521PHz4URajdI1Mrgjyw',
    managerEmail: 'gerencia.ls.juarez@grupoestancia.com',
    managerPhone: '+525543565534',
    staff: [
      'ZABDIEL SANCHEZ',
      'MARIO BARBAN',
      'FERNANDO RAMOS',
      'MAIRA JERONIMO',
      'DAVID TROCOLI',
      'JOSE CARLOS',
      'JOSE ALFREDO',
      'DANIEL ALEJANDRO',
      'KEVIN ISRAEL',
      'ERIK GONZALEZ',
    ],
  },
  {
    name: 'La Silla Huexotitla',
    slug: 'la-silla-huexotitla',
    region: 'central',
    googlePlaceId: 'ChIJxWZrJMjAz4URKG2NgyfCDzE',
    managerEmail: 'gerencia.ls.huexotitla@grupoestancia.com',
    managerPhone: '+522227875130',
    staff: [
      'SIMON PEREZ',
      'MARCOS MARTINEZ',
      'JESUS EDUARDO',
      'BRYAN SORIANO',
      'LUIS ANGEL',
      'HECTOR REGINO',
      'JOSE ERNESTO',
      'DANA PAOLA',
    ],
  },

  // ── Harbor's ───────────────────────────────────────────────────────────────
  {
    name: "Harbor's Angelopolis",
    slug: 'harbors-angelopolis',
    region: 'central',
    googlePlaceId: 'ChIJZxAQqW_Hz4URXMFcf152QiE',
    managerEmail: 'gerencia.h.angelopolis@grupoestancia.com',
    managerPhone: '+525525319180',
    staff: [
      'JUAN CARLOS',
      'VICTOR HUGO',
      'ISMAEL MENESES',
      'EMMANUEL OLMOS',
      'PEDRO JESUS',
      'ALBERTO LEON',
      'RICARDO PALACIOS',
      'JUAN ARMANDO',
      'RICARDO ALBERTO',
      'MARIA ISABEL',
    ],
  },
  {
    name: "Harbor's Veracruz",
    slug: 'harbors-veracruz',
    region: 'veracruz',
    googlePlaceId: 'ChIJP5xgoflAw4URaJpv0XvfXx8',
    managerEmail: 'gerencia.h.veracruz@grupoestancia.com',
    managerPhone: '+522293935085',
    staff: [
      'JUSTIN ALEXANDRO',
      'EDUARDO ZARATE',
      'AHMED DE JESUS',
      'JAIR GOMEZ',
      'SAMUEL BARRAGAN',
      'FATIMA LUNA',
      'JOSHUA LUNA',
      'VANESSA MARICELA',
      'FERNANDO JOSE',
    ],
  },

  // ── Steak Company ──────────────────────────────────────────────────────────
  {
    name: 'SteakCompany Queretaro',
    slug: 'steakcompany-queretaro',
    region: 'queretaro',
    googlePlaceId: 'ChIJT7EE0gBa04URvcdg-PTV4F4',
    managerEmail: 'ricardoc3@gmail.com',
    managerPhone: '+522221099111',
    staff: [
      'OMAR PEREZ',
      'JUAN PABLO',
      'ROCIO RAMIREZ',
      'LAURA COLOME',
      'ULISES AVILES',
      'TANIA PEREZ',
      'SANDRA VENTURA',
      'JAVIER BALLESTEROS',
      'JOSE LUNA',
      'HUGO HERRERA',
      'FIDEL CARRILLO',
      'ERICK RUIZ',
    ],
  },

  // ── Regio Norte ────────────────────────────────────────────────────────────
  {
    name: 'Regio Norte',
    slug: 'regio-norte',
    region: 'central',
    googlePlaceId: 'ChIJp_TjY77Hz4UROpI4_OVO14w',
    managerEmail: 'gerencia@regionorte.mx',
    managerPhone: '+522227875130',
    staff: [
      'EDGAR CELSO',
      'JOSE GERARDO',
      'ALDO AXEL',
      'JAZMIN GOMEZ',
      'FABIOLA MICHELL',
      'JAVIER HDZ',
      'MOISES RENDON',
      'JOSE FRANCISCO',
      'DANIEL PEREZ',
    ],
  },
];

// Owner account — can see all locations
const ownerAccount = {
  name: 'Grupo Estancia',
  slug: 'owner',
  isOwner: true,
};

// Regional manager accounts — each sees only their assigned restaurants
const regionalAccounts = [
  { name: 'Regional Querétaro', slug: 'regional-queretaro', region: 'queretaro' },
  { name: 'Regional Veracruz', slug: 'regional-veracruz', region: 'veracruz' },
  { name: 'Regional Central', slug: 'regional-central', region: 'central' },
];

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const defaultPasswordHash = await hashPassword('ratetap2024');
  console.log(`Seeding ${allRestaurants.length} restaurants with real staff data...\n`);

  let totalStaff = 0;

  for (const r of allRestaurants) {
    const threshold = r.googleThresholdOverride ?? 4;
    const [restaurant] = await db
      .insert(restaurants)
      .values({
        name: r.name,
        slug: r.slug,
        googleThreshold: threshold,
        googleReviewUrl: r.googleReviewUrl ?? null,
        googlePlaceId: r.googlePlaceId ?? null,
        adminPasswordHash: defaultPasswordHash,
        managerEmail: r.managerEmail ?? 'lawrencebrennan@gmail.com',
        managerPhone: r.managerPhone ?? null,
        alertPreference: 'all',
        region: r.region ?? null,
      })
      .onConflictDoUpdate({
        target: restaurants.slug,
        set: {
          name: r.name,
          googleThreshold: threshold,
          googleReviewUrl: r.googleReviewUrl ?? null,
          googlePlaceId: r.googlePlaceId ?? null,
          adminPasswordHash: defaultPasswordHash,
          managerEmail: r.managerEmail ?? 'lawrencebrennan@gmail.com',
          managerPhone: r.managerPhone ?? null,
          alertPreference: 'all',
          region: r.region ?? null,
        },
      })
      .returning();

    // Upsert staff (don't delete — onDelete:'set null' would orphan review links)
    const usedCodes = new Set<string>();
    for (const member of r.staff) {
      let code: string;
      let name: string;
      if (typeof member === 'string') {
        name = member;
        code = makeCode(member, usedCodes);
      } else {
        name = member.name;
        code = member.code;
        usedCodes.add(code);
      }
      await db
        .insert(staff)
        .values({ restaurantId: restaurant.id, code, name })
        .onConflictDoUpdate({
          target: [staff.restaurantId, staff.code],
          set: { name },
        });
    }

    totalStaff += r.staff.length;
    console.log(`  ${restaurant.name} (id=${restaurant.id}) — ${r.staff.length} staff`);
  }

  // Seed owner account
  const [owner] = await db
    .insert(restaurants)
    .values({
      name: ownerAccount.name,
      slug: ownerAccount.slug,
      googleThreshold: 4,
      adminPasswordHash: defaultPasswordHash,
      isOwner: true,
      managerEmail: 'lawrencebrennan@gmail.com',
      alertPreference: 'all',
    })
    .onConflictDoUpdate({
      target: restaurants.slug,
      set: {
        name: ownerAccount.name,
        adminPasswordHash: defaultPasswordHash,
        isOwner: true,
        managerEmail: 'lawrencebrennan@gmail.com',
        alertPreference: 'all',
      },
    })
    .returning();
  console.log(`  Owner: ${owner.name} (id=${owner.id})`);

  // Seed regional manager accounts
  for (const r of regionalAccounts) {
    const [regional] = await db
      .insert(restaurants)
      .values({
        name: r.name,
        slug: r.slug,
        googleThreshold: 4,
        adminPasswordHash: defaultPasswordHash,
        isRegional: true,
        region: r.region,
        managerEmail: 'lawrencebrennan@gmail.com',
        alertPreference: 'all',
      })
      .onConflictDoUpdate({
        target: restaurants.slug,
        set: {
          name: r.name,
          adminPasswordHash: defaultPasswordHash,
          isRegional: true,
          region: r.region,
          managerEmail: 'lawrencebrennan@gmail.com',
          alertPreference: 'all',
        },
      })
      .returning();
    console.log(`  Regional: ${regional.name} (id=${regional.id}, region=${r.region})`);
  }

  console.log(`\nSeeded ${allRestaurants.length} restaurants + 1 owner + ${regionalAccounts.length} regional managers with ${totalStaff} total staff.`);
  console.log('Done!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
