import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'players'
    `);
    console.log("PLAYERS COLUMNS:");
    console.log(res.rows.map(r => `${r.column_name}: ${r.data_type}`).join('\n'));

    const res2 = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'player_registrations'
    `);
    console.log("\nREGISTRATIONS COLUMNS:");
    console.log(res2.rows.map(r => `${r.column_name}: ${r.data_type}`).join('\n'));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
