import Database from 'better-sqlite3';

const db = new Database('./sqlite.db');
const rows = db.prepare('SELECT * FROM verification_attempts ORDER BY id DESC LIMIT 2;').all();
console.log(JSON.stringify(rows, null, 2));
