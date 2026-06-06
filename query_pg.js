const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  const res = await client.query('SELECT * FROM video_analysis_logs ORDER BY id DESC LIMIT 20;');
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run();
