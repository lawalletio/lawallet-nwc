import { chmod, cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, '..')
const sourceDir = path.join(packageDir, 'src')
const distDir = path.join(packageDir, 'dist')

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })
await cp(sourceDir, distDir, { recursive: true })
await chmod(path.join(distDir, 'index.js'), 0o755)
