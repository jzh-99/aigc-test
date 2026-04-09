#!/bin/bash
set -e

# Update apps/api/src/lib/credits.ts
sed -i "s/  'gemini':            6,/  'gemini':            5,/g" apps/api/src/lib/credits.ts || echo "Already updated or missing in api credits"
sed -i "s/  'nano-banana-pro':  12,/  'nano-banana-pro':  10,/g" apps/api/src/lib/credits.ts || echo "Missing nano in api credits"
sed -i "s/  'seedream-5.0-lite': 11,/  'seedream-5.0-lite': 10,/g" apps/api/src/lib/credits.ts || echo "Missing 5.0 in api credits"
sed -i "s/  'seedream-4.5':     13,/  'seedream-4.5':     10,/g" apps/api/src/lib/credits.ts || echo "Missing 4.5 in api credits"
sed -i "s/  'seedream-4.0':     10,/  'seedream-4.0':     10,/g" apps/api/src/lib/credits.ts || echo "Missing 4.0 in api credits"

# Update apps/web/src/lib/credits.ts
sed -i "s/  'gemini':            6,/  'gemini':            5,/g" apps/web/src/lib/credits.ts
sed -i "s/  'nano-banana-pro':  12,/  'nano-banana-pro':  10,/g" apps/web/src/lib/credits.ts
sed -i "s/  'seedream-5.0-lite': 11,/  'seedream-5.0-lite': 10,/g" apps/web/src/lib/credits.ts
sed -i "s/  'seedream-4.5':     13,/  'seedream-4.5':     10,/g" apps/web/src/lib/credits.ts
sed -i "s/  'seedream-4.0':     10,/  'seedream-4.0':     10,/g" apps/web/src/lib/credits.ts

# Update DB seed script packages/db/scripts/seed.ts
sed -i "s/credit_cost: 12/credit_cost: 10/g" packages/db/scripts/seed.ts
sed -i "s/credit_cost: 6 }/credit_cost: 5 }/g" packages/db/scripts/seed.ts

# Update DB seed script packages/db/scripts/seed-volcengine.ts
sed -i "s/credit_cost: 11,/credit_cost: 10,/g" packages/db/scripts/seed-volcengine.ts
sed -i "s/credit_cost: 13,/credit_cost: 10,/g" packages/db/scripts/seed-volcengine.ts
# seedream-4.0 is already 10

# Update existing database records
cat << 'SQL' > update_db.ts
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
SQL

npx ts-node update_db.ts

echo "Credits updated successfully!"
