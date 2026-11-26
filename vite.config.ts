import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const formatBuildRevision = (): string => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
}

const buildRevision = formatBuildRevision()

const versionManifestPlugin = (): Plugin => ({
    name: 'version-manifest',
    configureServer(server) {
        server.middlewares.use('/version.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(JSON.stringify({ revision: 'dev' }))
        })
    },
    writeBundle(options) {
        const outDir = options.dir ?? resolve(process.cwd(), 'dist')
        writeFileSync(
            resolve(outDir, 'version.json'),
            `${JSON.stringify({ revision: buildRevision }, null, 4)}\n`,
        )
    },
})

export default defineConfig(({ command }) => ({
    plugins: [react(), versionManifestPlugin()],
    define: {
        'import.meta.env.VITE_APP_REVISION': JSON.stringify(
            command === 'serve' ? 'dev' : buildRevision,
        ),
    },
    build: {
        target: 'esnext',
        cssMinify: false,
    },
}))
