import { readFileSync, watch as fsWatch } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/**
 * Vite `/api` 프록시용 UI 서버 포트.
 * - 환경변수 UI_SERVER_PORT 또는 SAGOHUB_UI_SERVER_PORT 가 있으면 최우선.
 * - 서비스 루트의 `.ui-server-port` (ui_server가 바인딩 후 기록, 포트 충돌로 번호가 바뀐 경우).
 * - 없으면 service.yaml 의 ui_server.external_port, 없으면 port.
 *
 * @param {string} viteConfigImportMetaUrl 호출 측 vite.config.js 의 import.meta.url
 * @param {string} fallbackPort YAML/환경변수 실패 시 사용할 포트
 */
export function resolveUiServerPort(viteConfigImportMetaUrl, fallbackPort = '8080') {
  const fromEnv = (
    process.env.UI_SERVER_PORT ||
    process.env.SAGOHUB_UI_SERVER_PORT ||
    ''
  ).trim()
  if (fromEnv) return fromEnv

  try {
    const dir = dirname(fileURLToPath(viteConfigImportMetaUrl))
    const serviceRoot = join(dir, '..')
    const runtimePortPath = join(serviceRoot, '.ui-server-port')
    try {
      const rt = readFileSync(runtimePortPath, 'utf8').trim()
      if (/^\d+$/.test(rt)) return rt
    } catch {
      /* 파일 없음 */
    }

    const yamlPath = join(serviceRoot, 'service.yaml')
    const text = readFileSync(yamlPath, 'utf8')
    const ext = text.match(/^\s+external_port:\s*(\d+)\s*$/m)
    if (ext) return ext[1]
    const inner = text.match(/^\s+port:\s*(\d+)\s*$/m)
    if (inner) return inner[1]
  } catch {
    /* ignore */
  }
  return fallbackPort
}

/** 프록시 target 문자열 (로컬 UI 서버) */
export function resolveUiServerProxyTarget(viteConfigImportMetaUrl, fallbackPort = '8080') {
  return `http://0.0.0.0:${resolveUiServerPort(viteConfigImportMetaUrl, fallbackPort)}`
}

/**
 * `service.yaml` (또는 런타임에서 생성되는 `.ui-server-port`) 변경 시
 * Vite dev 서버를 자동 재시작(full reload)하도록 만드는 플러그인입니다.
 *
 * 이유: Vite `server.proxy.target`은 `vite.config.js`가 로딩되는 시점에만 고정되므로,
 * 포트 값만 바뀌어도 자동으로 프록시 target이 갱신되지는 않습니다.
 */
export function watchUiServerPortChanges(viteConfigImportMetaUrl, fallbackPort = '8080') {
  return {
    name: 'watch-ui-server-port',
    configureServer(server) {
      let lastPort = resolveUiServerPort(viteConfigImportMetaUrl, fallbackPort)

      let restartTimer = null
      const scheduleRestart = () => {
        if (restartTimer) clearTimeout(restartTimer)
        restartTimer = setTimeout(async () => {
          const nextPort = resolveUiServerPort(viteConfigImportMetaUrl, fallbackPort)
          if (String(nextPort) === String(lastPort)) return

          lastPort = nextPort
          try {
            console.log(`[vite] ui_server port changed -> ${lastPort}. restarting dev server...`)
            await server.restart(false)
          } finally {
            // restart가 곧바로 브라우저 전체 리로드를 트리거하지 않는 경우를 대비
            if (server.ws?.send) server.ws.send('full-reload')
          }
        }, 250)
      }

      try {
        const dir = dirname(fileURLToPath(viteConfigImportMetaUrl))
        const serviceRoot = join(dir, '..')
        const serviceYamlPath = join(serviceRoot, 'service.yaml')
        const runtimePortPath = join(serviceRoot, '.ui-server-port')

        if (serviceYamlPath) fsWatch(serviceYamlPath, { persistent: false }, () => scheduleRestart())
        if (runtimePortPath) fsWatch(runtimePortPath, { persistent: false }, () => scheduleRestart())
      } catch {
        // watch 설정 실패는 치명적이지 않습니다.
      }
    },
  }
}
