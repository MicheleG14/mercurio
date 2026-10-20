// Lets the API role log in with the password from POSTGRES_APP_PASSWORD, and checks that the
// role cannot bypass Row-Level Security. Runs after `prisma migrate deploy` (which creates the
// role) with the owner connection, in development, CI and the production `migrate` container.
//
// Usage: DATABASE_ADMIN_URL=... POSTGRES_APP_PASSWORD=... node scripts/provision-app-role.mjs
import pg from 'pg';

const ROLE = 'mercurio_app';
const adminUrl = process.env.DATABASE_ADMIN_URL;
const password = process.env.POSTGRES_APP_PASSWORD;

if (!adminUrl) fail('DATABASE_ADMIN_URL is not set');
if (!password || password.length < 16) fail('POSTGRES_APP_PASSWORD must be at least 16 characters');

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  const { rows } = await client.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    [ROLE],
  );
  if (rows.length === 0) fail(`role ${ROLE} does not exist: run the migrations first`);
  if (rows[0].rolsuper || rows[0].rolbypassrls) {
    fail(`role ${ROLE} can bypass Row-Level Security: refusing to enable its login`);
  }
  // ALTER ROLE takes no bind parameters: the password is escaped as a SQL literal.
  await client.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  console.log(`Role ${ROLE} ready`);
} finally {
  await client.end();
}

function fail(message) {
  console.error(`provision-app-role: ${message}`);
  process.exit(1);
}
