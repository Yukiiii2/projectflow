import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const backendPackage = JSON.parse(await readFile(path.join(root, 'backend', 'package.json'), 'utf8'))
const requiredArtifacts = [
  path.join(root, 'dist', 'index.html'),
  path.join(root, 'backend', 'dist', 'server.js'),
]
const forbiddenBackendMarkers = ['PROJECTFLOW_TEST_EMAIL_CAPTURE']

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await javascriptFiles(target))
    else if (entry.name.endsWith('.js')) results.push(target)
  }
  return results
}

if (rootPackage.scripts?.start !== 'npm --prefix backend start') {
  throw new Error('Root start script must delegate to the backend package')
}

const match = /^node\s+(.+)$/.exec(backendPackage.scripts?.start ?? '')
if (!match) throw new Error('Backend start script must execute a compiled Node entry point')

const configuredEntry = path.resolve(root, 'backend', match[1])
if (configuredEntry !== requiredArtifacts[1]) {
  throw new Error(`Backend start entry does not match the required build artifact: ${path.relative(root, configuredEntry)}`)
}

for (const artifact of requiredArtifacts) {
  try {
    await access(artifact)
  } catch {
    throw new Error(`Required Render build artifact is missing: ${path.relative(root, artifact)}`)
  }
}

const backendDist = path.join(root, 'backend', 'dist')
for (const file of await javascriptFiles(backendDist)) {
  const contents = await readFile(file, 'utf8')
  for (const marker of forbiddenBackendMarkers) {
    if (contents.includes(marker)) {
      throw new Error(`Production backend contains test-only email capture code: ${path.relative(root, file)}`)
    }
  }
}

console.log('Render build verification passed: frontend and compiled Express entry point are present and aligned with the start command.')
