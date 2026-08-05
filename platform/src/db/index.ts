import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { drizzle as drizzleTransaction } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!.replace(/\\n/g, '').trim();
const sql = neon(connectionString);

export const db = drizzle(sql, { schema });

// neon-http intentionally has no callback transaction support. Pilot signup
// uses this WebSocket-backed client for the small atomic provisioning section.
neonConfig.webSocketConstructor = ws;
const transactionPool = new Pool({ connectionString });
export const transactionDb = drizzleTransaction(transactionPool, { schema });
