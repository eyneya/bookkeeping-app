const { Pool } = require('pg');

// DATABASE_URL comes from your Postgres provider (e.g. Supabase connection string).
// Supabase's free tier is the recommended economical starting point.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
