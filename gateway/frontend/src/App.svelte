<script>
  import EventTester from './lib/EventTester.svelte'

  const defaultApi = '/api'

  let apiBase = defaultApi
  let loading = false
  let error = ''

  let servicesResult = null
  let modulesResult = null
  let supabaseConfig = null
  let supabaseStatus = null

  let configToken = ''
  let configInput = {
    supabase_url: '',
    supabase_service_role_key: '',
    supabase_anon_key: ''
  }

  let startServiceName = ''
  let startPayloadText = '{"input":"hello"}'
  let startedTask = null

  let queryServiceName = ''
  let queryTaskId = ''
  let queriedTask = null

  function buildUrl(path) {
    const base = apiBase.trim().replace(/\/+$/, '')
    return `${base}${path}`
  }

  async function apiGet(path) {
    const res = await fetch(buildUrl(path))
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return data
  }

  async function apiPost(path, body, withAuth = false) {
    const headers = { 'Content-Type': 'application/json' }
    if (withAuth && configToken.trim()) {
      headers.Authorization = `Bearer ${configToken.trim()}`
    }
    const res = await fetch(buildUrl(path), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.detail || `HTTP ${res.status}`)
    }
    return data
  }

  async function refreshBasics() {
    loading = true
    error = ''
    try {
      const [services, modules, config] = await Promise.all([
        apiGet('/services'),
        apiGet('/modules'),
        apiGet('/supabase/config')
      ])
      servicesResult = services
      modulesResult = modules
      supabaseConfig = config.supabase || null
    } catch (e) {
      error = e.message || String(e)
    } finally {
      loading = false
    }
  }

  async function checkSupabaseStatus() {
    loading = true
    error = ''
    try {
      supabaseStatus = await apiGet('/supabase/status')
    } catch (e) {
      error = e.message || String(e)
    } finally {
      loading = false
    }
  }

  async function saveSupabaseConfig() {
    loading = true
    error = ''
    try {
      const payload = {}
      if (configInput.supabase_url !== '') payload.supabase_url = configInput.supabase_url
      if (configInput.supabase_service_role_key !== '')
        payload.supabase_service_role_key = configInput.supabase_service_role_key
      if (configInput.supabase_anon_key !== '') payload.supabase_anon_key = configInput.supabase_anon_key
      const data = await apiPost('/supabase/config', payload, true)
      supabaseConfig = data.supabase || null
      configInput = { supabase_url: '', supabase_service_role_key: '', supabase_anon_key: '' }
    } catch (e) {
      error = e.message || String(e)
    } finally {
      loading = false
    }
  }

  async function startService() {
    loading = true
    error = ''
    try {
      if (!startServiceName.trim()) {
        throw new Error('service_name 을 입력하세요.')
      }
      let payloadObj = {}
      try {
        payloadObj = JSON.parse(startPayloadText || '{}')
      } catch {
        throw new Error('Payload JSON 형식이 올바르지 않습니다.')
      }
      startedTask = await apiPost(`/start/${startServiceName.trim()}`, payloadObj)
      queryServiceName = startServiceName.trim()
      queryTaskId = startedTask.task_id || ''
    } catch (e) {
      error = e.message || String(e)
    } finally {
      loading = false
    }
  }

  async function fetchTask() {
    loading = true
    error = ''
    queriedTask = null
    try {
      if (!queryServiceName.trim() || !queryTaskId.trim()) {
        throw new Error('service_name 과 task_id 를 모두 입력하세요.')
      }
      queriedTask = await apiGet(`/tasks/${queryServiceName.trim()}/${queryTaskId.trim()}`)
    } catch (e) {
      error = e.message || String(e)
    } finally {
      loading = false
    }
  }
</script>

<main class="container">
  <header class="header">
    <h1>Gateway Hub Console</h1>
    <p>SagoHub Orchestrator API 관리 UI (Vite + Svelte)</p>
  </header>

  <section class="card">
    <h2>API 연결</h2>
    <div class="row">
      <label for="apiBase">Hub Base URL (Vite dev proxy: /api)</label>
      <input id="apiBase" bind:value={apiBase} placeholder="/api 또는 http://localhost:26100" />
      <button on:click={refreshBasics} disabled={loading}>기본 조회</button>
      <button on:click={checkSupabaseStatus} disabled={loading}>Supabase 상태</button>
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </section>

  <section class="grid">
    <article class="card">
      <h2>서비스 목록</h2>
      <p class="meta">`GET /services`</p>
      {#if servicesResult}
        <p>총 {servicesResult.count}개 (root: {servicesResult.services_root})</p>
        <ul>
          {#each servicesResult.services as svc}
            <li>
              <strong>{svc.id}</strong>
              {#if svc.has_service_yaml}<span class="tag ok">service.yaml</span>{/if}
              {#if svc.hub_recipe}<span class="tag">recipe: {svc.hub_recipe.join(' -> ')}</span>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">기본 조회를 눌러 목록을 불러오세요.</p>
      {/if}
    </article>

    <article class="card">
      <h2>모듈 목록</h2>
      <p class="meta">`GET /modules`</p>
      {#if modulesResult}
        <p>총 {modulesResult.count}개</p>
        <ul>
          {#each modulesResult.modules as mod}
            <li>
              <strong>{mod.module_name}</strong>
              <span class="muted">{mod.event_url}</span>
              {#if mod.used_in_any_recipe}<span class="tag ok">used</span>{/if}
            </li>
          {/each}
        </ul>
        {#if modulesResult.missing_module_addrs_for_recipe_steps?.length}
          <p class="error">
            주소 누락: {modulesResult.missing_module_addrs_for_recipe_steps.join(', ')}
          </p>
        {/if}
      {:else}
        <p class="muted">기본 조회를 눌러 목록을 불러오세요.</p>
      {/if}
    </article>
  </section>

  <section class="grid">
    <article class="card">
      <h2>Supabase 설정 조회/입력</h2>
      <p class="meta">`GET/POST /supabase/config`</p>
      <div class="row">
        <label for="cfgToken">Config Token (optional)</label>
        <input id="cfgToken" bind:value={configToken} placeholder="HUB_CONFIG_SECRET" />
      </div>
      <div class="row">
        <label for="cfgUrl">supabase_url</label>
        <input id="cfgUrl" bind:value={configInput.supabase_url} placeholder="https://..." />
      </div>
      <div class="row">
        <label for="cfgSr">service_role_key</label>
        <input id="cfgSr" bind:value={configInput.supabase_service_role_key} placeholder="..." />
      </div>
      <div class="row">
        <label for="cfgAnon">anon_key</label>
        <input id="cfgAnon" bind:value={configInput.supabase_anon_key} placeholder="..." />
      </div>
      <button on:click={saveSupabaseConfig} disabled={loading}>설정 저장</button>

      {#if supabaseConfig}
        <pre>{JSON.stringify(supabaseConfig, null, 2)}</pre>
      {/if}
    </article>

    <article class="card">
      <h2>Supabase 상태 체크</h2>
      <p class="meta">`GET /supabase/status`</p>
      {#if supabaseStatus}
        <pre>{JSON.stringify(supabaseStatus, null, 2)}</pre>
      {:else}
        <p class="muted">Supabase 상태 버튼으로 확인하세요.</p>
      {/if}
    </article>
  </section>

  <section class="grid">
    <article class="card">
      <h2>서비스 시작</h2>
      <p class="meta">`POST /start/{'{service_name}'}`</p>
      <div class="row">
        <label for="startServiceName">service_name</label>
        <input id="startServiceName" bind:value={startServiceName} placeholder="code_gen_service" />
      </div>
      <div class="row">
        <label for="startPayload">payload(JSON)</label>
        <textarea id="startPayload" bind:value={startPayloadText} rows="6"></textarea>
      </div>
      <button on:click={startService} disabled={loading}>실행</button>
      {#if startedTask}
        <pre>{JSON.stringify(startedTask, null, 2)}</pre>
      {/if}
    </article>

    <article class="card">
      <h2>태스크 조회</h2>
      <p class="meta">`GET /tasks/{'{service_name}'}/{'{task_id}'}`</p>
      <div class="row">
        <label for="qService">service_name</label>
        <input id="qService" bind:value={queryServiceName} />
      </div>
      <div class="row">
        <label for="qTaskId">task_id</label>
        <input id="qTaskId" bind:value={queryTaskId} />
      </div>
      <button on:click={fetchTask} disabled={loading}>조회</button>
      {#if queriedTask}
        <pre>{JSON.stringify(queriedTask, null, 2)}</pre>
      {/if}
    </article>
  </section>

  <section class="card event-tester-wrap">
    <EventTester apiBase={apiBase} />
  </section>
</main>
