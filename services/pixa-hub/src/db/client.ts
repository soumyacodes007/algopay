import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../core/env.js'
import * as schema from './schema.js'

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  // Neon can take a few extra seconds on a cold connection; avoid false 500s.
  connectionTimeoutMillis: 15000
})

export const db = drizzle(pool, { schema })

export { pool }
