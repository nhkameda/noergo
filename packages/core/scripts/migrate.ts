import { fileURLToPath } from 'node:url';
import { migrate } from '../src/db/migrate';

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  console.error('DATABASE_MIGRATOR_URL is not set (the noergo_migrator role, never the app role).');
  process.exit(1);
}
const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const applied = await migrate(url, dir);
console.info(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
