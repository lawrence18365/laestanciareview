import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants, staff } from './schema';
import { hashPassword } from '../lib/auth';

// All restaurants grouped by brand + location
const allRestaurants = [
  // Estancia
  { name: 'Estancia Angelopolis', slug: 'estancia-angelopolis' },
  { name: 'Estancia Juarez', slug: 'estancia-juarez' },
  { name: 'Estancia Queretaro', slug: 'estancia-queretaro' },
  { name: 'Estancia Leon', slug: 'estancia-leon' },
  { name: 'Estancia Veracruz', slug: 'estancia-veracruz' },
  { name: 'Estancia Xalapa', slug: 'estancia-xalapa' },

  // Harbor's
  { name: "Harbor's Angelopolis", slug: 'harbors-angelopolis' },
  { name: "Harbor's Veracruz", slug: 'harbors-veracruz' },

  // La Silla
  { name: 'La Silla Juarez', slug: 'la-silla-juarez' },
  { name: 'La Silla Huexotitla', slug: 'la-silla-huexotitla' },

  // SteakCompany
  { name: 'SteakCompany Queretaro', slug: 'steakcompany-queretaro' },

  // Regio Norte
  { name: 'Regio Norte', slug: 'regio-norte' },
];

// Owner account — can see all locations
const ownerAccount = {
  name: 'Grupo Estancia',
  slug: 'owner',
  isOwner: true,
};

// Default staff for each restaurant (can be updated per-restaurant later)
const defaultStaff = [
  { code: 'EDUARDO001', name: 'Eduardo' },
  { code: 'MARIA001', name: 'Maria' },
  { code: 'CARLOS001', name: 'Carlos' },
  { code: 'ANA001', name: 'Ana' },
  { code: 'MIGUEL001', name: 'Miguel' },
  { code: 'SOFIA001', name: 'Sofia' },
  { code: 'DIEGO001', name: 'Diego' },
  { code: 'VALENTINA001', name: 'Valentina' },
  { code: 'ANDRES001', name: 'Andres' },
  { code: 'CAMILA001', name: 'Camila' },
  { code: 'JAVIER001', name: 'Javier' },
  { code: 'ISABELLA001', name: 'Isabella' },
];

async function seed() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const defaultPasswordHash = await hashPassword('ratetap2024');
  console.log(`Seeding ${allRestaurants.length} restaurants with default admin password...`);

  for (const r of allRestaurants) {
    const [restaurant] = await db
      .insert(restaurants)
      .values({
        name: r.name,
        slug: r.slug,
        googleThreshold: 4,
        adminPasswordHash: defaultPasswordHash,
        managerEmail: 'lawrencebrennan@gmail.com',
        alertPreference: 'all',
      })
      .onConflictDoUpdate({
        target: restaurants.slug,
        set: { name: r.name, adminPasswordHash: defaultPasswordHash, managerEmail: 'lawrencebrennan@gmail.com', alertPreference: 'all' },
      })
      .returning();

    console.log(`  ${restaurant.name} (id=${restaurant.id})`);

    for (const member of defaultStaff) {
      await db
        .insert(staff)
        .values({
          restaurantId: restaurant.id,
          code: member.code,
          name: member.name,
        })
        .onConflictDoNothing();
    }
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
      set: { name: ownerAccount.name, adminPasswordHash: defaultPasswordHash, isOwner: true, managerEmail: 'lawrencebrennan@gmail.com', alertPreference: 'all' },
    })
    .returning();
  console.log(`  Owner: ${owner.name} (id=${owner.id})`);

  console.log(`\nSeeded ${allRestaurants.length} restaurants + 1 owner with ${defaultStaff.length} staff each.`);
  console.log('Done!');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
