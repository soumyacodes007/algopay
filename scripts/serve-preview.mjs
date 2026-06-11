import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const host = '127.0.0.1'
const port = Number(process.env.PREVIEW_PORT || 4173)

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png']
])

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${host}:${port}`)
    const requestedPath = decodeURIComponent(url.pathname)
    const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[\\/])+/, '')
    const filePath = path.join(
      rootDir,
      normalizedPath === '/' ? 'sandbox/preview/onramp-preview.html' : normalizedPath
    )

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    const file = await readFile(filePath)
    const contentType =
      mimeTypes.get(path.extname(filePath).toLowerCase()) ||
      'application/octet-stream'

    res.writeHead(200, { 'Content-Type': contentType })
    res.end(file)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(message)
  }
})

server.listen(port, host, () => {
  console.log(`Preview server listening at http://${host}:${port}`)
})
