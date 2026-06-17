import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { parse as parseYaml } from 'yaml'

/**
 * 이 파일·vite.config.js 기준 상위(`document-writer/`)의 `service.yaml`을 파싱합니다.
 * @param {string} importMetaUrl `import.meta.url` (호출 측 config 파일)
 */
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
