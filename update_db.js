const path = require('path');
const { config } = require('dotenv');
config({ path: path.resolve(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  console.log('Updating database image model credits...');
  
  await pool.query(`UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-5.0-lite'`);
  await pool.query(`UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-4.5'`);
  await pool.query(`UPDATE provider_models SET credit_cost = 10 WHERE code = 'seedream-4.0'`);
  await pool.query(`UPDATE provider_models SET credit_cost = 10 WHERE code LIKE 'nano-banana%'`);
  await pool.query(`UPDATE provider_models SET credit_cost = 5 WHERE code LIKE 'gemini%'`);
  
  await pool.end();
  console.log('Done updating DB.');
}

main().catch(console.error);
