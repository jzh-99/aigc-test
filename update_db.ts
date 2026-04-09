import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, 'packages/db/../../../.env') });
import { getDb, closeDb } from './packages/db/src/client.js';

async function main() {
  const db = getDb();
  const { sql } = await import('kysely');
  
  console.log('Updating database image model credits...');
  
  await sql`UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-5.0-lite'`.execute(db);
  await sql`UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-4.5'`.execute(db);
  await sql`UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-4.0'`.execute(db);
  await sql`UPDATE provider_models SET credit_cost = 10 WHERE code LIKE 'nano-banana%'`.execute(db);
  await sql`UPDATE provider_models SET credit_cost = 5 WHERE code LIKE 'gemini%'`.execute(db);
  
  await closeDb();
  console.log('Done updating DB.');
}

main().catch(console.error);
