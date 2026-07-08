import pg from 'pg';
import 'dotenv/config';

async function run() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  const res = await client.query('SELECT id, name FROM tournaments;');
  console.log("Tournaments in DB:", res.rows);
  await client.end();
}
run().catch(console.error);
