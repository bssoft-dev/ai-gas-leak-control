<script>
  /** @type {string} */
  export let apiBase = '/api'

  function buildUrl(path) {
    const base = apiBase.trim().replace(/\/+$/, '')
    return `${base}${path}`
  }

  /** 가상 이벤트 프리셋 (event_id 생략 → 서버가 UUID 부여) */
  const presets = [
    {
      label: 'UI 클릭',
      body: {
        service_id: 'gateway_console',
        source_id: 'svelte_ui',
        session_id: 'sess-demo-001',
        event_type: 'ui.click',
        payload: { target: 'submit', route: '/events' },
        metadata: { client: 'EventTester' }
      }
    },
    {
      label: '허브 헬스 확인',
      body: {
        service_id: 'gateway_console',
        source_id: 'probe',
        session_id: 'sess-demo-001',
        event_type: 'system.ping',
        payload: { check: 'hub_alive' }
      }
    },
    {
      label: '모듈 진행 알림(가상)',
      body: {
        service_id: 'code_gen_service',
        source_id: 'llm_module',
        session_id: 'sess-pipeline-42',
        task_id: '00000000-0000-0000-0000-000000000000',
        event_type: 'module.progress',
        payload: { step: 'llm', percent: 37 },
        metadata: { simulated: true }
      }
    },
    {
      label: '에러 보고(가상)',
      body: {
        service_id: 'code_gen_service',
        source_id: 'git_module',
        session_id: 'sess-pipeline-42',
        event_type: 'module.error',
        payload: { code: 'GIT_TIMEOUT', retry: true },
        metadata: { level: 'warn' }
      }
    },
    {
      label: '감사 로그',
      body: {
        service_id: 'audit',
        source_id: 'gateway',
        session_id: 'sess-audit-9',
        event_type: 'audit.event_received',
        payload: { action: 'ingest', ok: true },
        metadata: { schema: 'bs_message_hub' }
      }
    },
    {
      label: '대용량 payload (작게)',
      body: {
        service_id: 'stress_test',
        source_id: 'generator',
        session_id: 'sess-bulk',
        event_type: 'bulk.sample',
        payload: {
          items: Array.from({ length: 12 }, (_, i) => ({ i, tag: `t${i}` }))
        }
      }
    }
  ]

  let customText = JSON.stringify(presets[0].body, null, 2)
  let loading = false
  let error = ''
  /** @type {{ at: string, ok: boolean, summary: string, raw?: unknown }[]} */
  let log = []

  function pushLog(ok, summary, raw = undefined) {
    const at = new Date().toISOString()
    log = [{ at, ok, summary, raw }, ...log].slice(0, 30)
  }

  async function postEvent(body) {
    const res = await fetch(buildUrl('/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = data.detail
      const msg = Array.isArray(detail)
        ? detail.map((d) => d.msg || JSON.stringify(d)).join('; ')
        : detail || `HTTP ${res.status}`
      throw new Error(msg)
    }
    return data
  }

  async function sendBody(body) {
    loading = true
    error = ''
    try {
      const data = await postEvent(body)
      const ev = data.event
      const id = ev?.event_id || ev?.id || '?'
      pushLog(true, `저장됨 event_id=${id}`, data)
    } catch (e) {
      const msg = e.message || String(e)
      error = msg
      pushLog(false, msg)
    } finally {
      loading = false
    }
  }

  async function sendPreset(p) {
    await sendBody(p.body)
  }

  async function sendCustom() {
    let body
    try {
      body = JSON.parse(customText || '{}')
    } catch {
      error = '커스텀 JSON 파싱 실패'
      pushLog(false, 'JSON parse error')
      return
    }
    if (!body.service_id || !body.source_id) {
      error = 'service_id, source_id 는 필수입니다.'
      pushLog(false, 'validation: service_id, source_id required')
      return
    }
    await sendBody(body)
  }

  async function sendAllSequential() {
    loading = true
    error = ''
    for (const p of presets) {
      try {
        const data = await postEvent(p.body)
        const ev = data.event
        const id = ev?.event_id || ev?.id || '?'
        pushLog(true, `[일괄] ${p.label} → ${id}`, data)
      } catch (e) {
        const msg = e.message || String(e)
        error = msg
        pushLog(false, `[일괄 실패] ${p.label}: ${msg}`)
        break
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    loading = false
  }

  async function sendRandom() {
    const p = presets[Math.floor(Math.random() * presets.length)]
    await sendPreset(p)
  }

  function loadPresetIntoEditor(p) {
    customText = JSON.stringify(p.body, null, 2)
  }
</script>

<div class="event-tester">
  <h2>이벤트 엔드포인트 테스트</h2>
  <p class="meta">`POST /events` → Supabase <code>bs_message_hub.events</code></p>

  <div class="row">
    <span class="muted">현재 Base: <strong>{apiBase || '(empty)'}</strong> — 경로 <code>/events</code></span>
  </div>

  <h3>가상 데이터 프리셋</h3>
  <ul class="preset-list">
    {#each presets as p}
      <li>
        <button type="button" on:click={() => sendPreset(p)} disabled={loading}>전송</button>
        <button type="button" class="secondary" on:click={() => loadPresetIntoEditor(p)} disabled={loading}>
          편집기로
        </button>
        <span>{p.label}</span>
      </li>
    {/each}
  </ul>

  <div class="row actions">
    <button type="button" on:click={sendRandom} disabled={loading}>랜덤 1건 전송</button>
    <button type="button" on:click={sendAllSequential} disabled={loading}>프리셋 전체 순차 전송</button>
  </div>

  <h3>커스텀 JSON</h3>
  <div class="row">
    <label for="evCustom">본문 (service_id, source_id 필수)</label>
    <textarea id="evCustom" bind:value={customText} rows="12"></textarea>
  </div>
  <button type="button" on:click={sendCustom} disabled={loading}>커스텀 전송</button>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <h3>결과 로그</h3>
  {#if log.length === 0}
    <p class="muted">전송하면 여기에 쌓입니다.</p>
  {:else}
    <ul class="log-list">
      {#each log as row}
        <li class:ok={row.ok} class:fail={!row.ok}>
          <span class="time">{row.at}</span>
          <span class="msg">{row.summary}</span>
          {#if row.raw}
            <pre class="raw">{JSON.stringify(row.raw, null, 2)}</pre>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .event-tester h3 {
    margin: 16px 0 8px;
    font-size: 15px;
    color: #374151;
  }
  .preset-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .preset-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .preset-list button.secondary {
    background: #fff;
    color: #111827;
    border: 1px solid #d1d5db;
  }
  .actions {
    margin-top: 8px;
  }
  .log-list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 420px;
    overflow: auto;
  }
  .log-list li {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 8px;
    background: #fafafa;
  }
  .log-list li.ok {
    border-color: #bbf7d0;
  }
  .log-list li.fail {
    border-color: #fecaca;
  }
  .time {
    display: block;
    font-size: 11px;
    color: #6b7280;
  }
  .msg {
    font-size: 13px;
  }
  pre.raw {
    margin-top: 8px;
    font-size: 11px;
    max-height: 180px;
  }
  code {
    font-size: 12px;
    background: #f3f4f6;
    padding: 2px 6px;
    border-radius: 4px;
  }
</style>
