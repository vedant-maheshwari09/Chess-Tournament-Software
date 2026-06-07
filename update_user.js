import { config } from 'dotenv';
config();
import pg from 'pg';
const client = new pg.Client();
await client.connect();
const res = await client.query('UPDATE users SET is_tournament_director = true WHERE email = $1', ['mathbymoves@gmail.com']);
console.log(res.rowCount + ' row(s) updated');
await client.end();
