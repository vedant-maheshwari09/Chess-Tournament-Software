import pg from 'pg';
import dns from 'dns';
const { Client } = pg;

const password = 'c6xNAtFbdqprmcMT';
const projectRef = 'sblqmdhdztcycurmxeuh';

const hosts = [
  'aws-0-us-west-1.pooler.supabase.com',
  'aws-1-us-west-1.pooler.supabase.com',
  'aws-2-us-west-1.pooler.supabase.com',
  'aws-3-us-west-1.pooler.supabase.com',
];

async function resolveHost(host) {
  return new Promise((resolve) => {
    dns.resolve4(host, (err, addresses) => {
      if (err) {
        resolve(null);
      } else {
        resolve(addresses);
      }
    });
  });
}

async function testConnection(host, port, user) {
  const client = new Client({
    host: host,
    port: port,
    user: user,
    password: password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`SUCCESS: ${host}:${port} with user ${user}`);
    const res = await client.query('SELECT NOW()');
    console.log(`Query Result:`, res.rows[0]);
    await client.end();
    return true;
  } catch (err) {
    console.error(`FAILED ${host}:${port} with user ${user} - ${err.message}`);
    return false;
  }
}

async function run() {
  for (const host of hosts) {
    const ips = await resolveHost(host);
    if (!ips) {
      console.log(`Host ${host} does not resolve to IPv4.`);
      continue;
    }
    console.log(`Host ${host} resolves to:`, ips);
    // Try both 6543 (transaction) and 5432 (session)
    await testConnection(host, 6543, `postgres.${projectRef}`);
    await testConnection(host, 5432, `postgres.${projectRef}`);
  }
}

run();
