import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, '..')
const srcDir = path.join(packageDir, 'src')

async function getJavaScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await getJavaScriptFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath)
    }
  }

  return files
}

function runNodeCheck(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], {
      stdio: 'inherit'
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Syntax check failed for ${file}`))
    })
  })
}

const files = await getJavaScriptFiles(srcDir)

for (const file of files) {
  await runNodeCheck(file)
}
