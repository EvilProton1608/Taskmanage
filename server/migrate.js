require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false } }
  : {
      user: process.env.DB_USER || 'postgres', host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'postgres', password: process.env.DB_PASSWORD || '',
      port: Number(process.env.DB_PORT || 5432), ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
const pool = new Pool(config);

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const existing = await client.query("SELECT to_regclass('public.users') AS users_table");
    if (!existing.rows[0].users_table) {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(__dirname, 'models', 'schema.sql'), 'utf8'));
      await client.query("INSERT INTO schema_migrations(version) VALUES ('001_initial_schema') ON CONFLICT DO NOTHING");
      await client.query('COMMIT');
      console.log('Applied 001_initial_schema');
    } else {
      await client.query("INSERT INTO schema_migrations(version) VALUES ('001_initial_schema') ON CONFLICT DO NOTHING");
    }

    const migrationsDir = path.join(__dirname, 'migrations');
    const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
    for (const file of migrations) {
      const version = path.basename(file, '.sql');
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
      if (applied.rowCount) continue;
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`Applied ${version}`);
    }
    console.log('Database schema is current.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
