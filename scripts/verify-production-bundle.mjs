import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('dist')
const forbidden = [
  'http://localhost:4000',
  'http://localhost:5173',
  'Prototype controls',
  'Dashboard preview state',
  '.preview-control',
  '.preview-tabs',
  'postgresql://',
  'RESEND_API_KEY',
  'SMTP_PASSWORD',
]

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) results.push(...await files(target))
    else if (/\.(?:css|html|js)$/i.test(entry.name)) results.push(target)
  }
  return results
}

const violations = []
for (const file of await files(root)) {
  const contents = await readFile(file, 'utf8')
  for (const value of forbidden) {
    if (contents.includes(value)) violations.push(`${path.relative(root, file)}: ${value}`)
  }
}

if (violations.length) {
  console.error('Production bundle contains forbidden development or secret markers:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Production bundle verification passed: no localhost API URLs, development-only controls, or secret markers.')
