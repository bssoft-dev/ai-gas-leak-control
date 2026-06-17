import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { parse as parseYaml } from 'yaml'

export function loadServiceYaml(importMetaUrl) {
  try {
    const dir = dirname(fileURLToPath(importMetaUrl))
    const serviceRoot = join(dir, '..')
    const yamlPath = join(serviceRoot, 'service.yaml')
    const text = readFileSync(yamlPath, 'utf8')
    const data = parseYaml(text)
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}
