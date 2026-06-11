import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { pathToFileURL } from 'url'
import { adminCreditHandler } from './api/admin-credit.js'
import { adminOpsHandler } from './api/admin-ops.js'
import { healthHandler } from './api/health.js'
import { payHandler } from './api/pay.js'
import { env } from './core/env.js'

export const app = new Hono()

app.use('*', logger())
app.use('*', cors({ origin: '*' }))

app.get('/health', healthHandler)
app.post('/api/pay', payHandler)

app.post('/admin/credit', async c => {
  const secret = c.req.header('x-pixa-admin-secret')
  if (!secret || secret !== env.PIXA_ADMIN_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return adminCreditHandler(c)
})

app.get('/admin/ops', async c => {
  const secret = c.req.header('x-pixa-admin-secret')
  if (!secret || secret !== env.PIXA_ADMIN_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return adminOpsHandler(c)
})

app.notFound(c => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error('[unhandled error]', err)
  return c.json({ error: 'Internal server error' }, 500)
})

const port = env.PORT

function isMainModule(): boolean {
  return (
    !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
  )
}

if (isMainModule()) {
  console.log(`Pixa Hub running on port ${port} [${env.NETWORK}]`)
  serve({
    fetch: app.fetch,
    port
  })
}

export default {
  port,
  fetch: app.fetch
}
