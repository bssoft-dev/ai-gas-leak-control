const DB_NAME = 'qdg-offline-db'
const DB_VERSION = 1
const API_CACHE_STORE = 'api_cache'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(API_CACHE_STORE)) {
        const store = db.createObjectStore(API_CACHE_STORE, { keyPath: 'key' })
        store.createIndex('updatedAt', 'updatedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putApiCache(key, data) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(API_CACHE_STORE, 'readwrite')
    tx.objectStore(API_CACHE_STORE).put({
      key,
      data,
      updatedAt: Date.now(),
    })
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getApiCache(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(API_CACHE_STORE, 'readonly')
    const req = tx.objectStore(API_CACHE_STORE).get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}
