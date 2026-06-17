import { getApiCache, putApiCache } from './db'

function cacheKeyFor(url) {
  return `GET:${url}`
}

export async function pwaFetchJson(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const useCache = method === 'GET'
  const key = cacheKeyFor(url)

  try {
    const res = await fetch(url, options)
    if (!res.ok) {
      throw new Error(res.statusText || 'Request failed')
    }
    const data = await res.json()
    if (useCache) {
      await putApiCache(key, data)
    }
    return { data, fromCache: false }
  } catch (err) {
    if (!useCache) throw err
    const cached = await getApiCache(key)
    if (!cached) throw err
    return { data: cached.data, fromCache: true, cachedAt: cached.updatedAt }
  }
}
