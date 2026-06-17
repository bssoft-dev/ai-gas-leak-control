import { OpenAPI } from '../../../api/core/OpenAPI'
import { DefaultService } from '../../../api/services/DefaultService'
import { getLocalProfile, isPushEnabled, setLocalProfile, setPushEnabled, type MobileProfile } from '../../../pwa/mobileStorage'

export async function publishGasEvent(type: string, payload: Record<string, unknown> = {}) {
  await DefaultService.publishEventApiEventsPublishPost({ type, payload })
}

export async function fetchMobileManifest() {
  const res = await fetch(`${OpenAPI.BASE}/api/gas-leak/mobile/manifest`)
  if (!res.ok) throw new Error('manifest load failed')
  return res.json()
}

export async function fetchServerProfile(): Promise<MobileProfile | null> {
  try {
    const res = await fetch(`${OpenAPI.BASE}/api/gas-leak/mobile/profile`)
    if (!res.ok) return null
    return (await res.json()) as MobileProfile
  } catch {
    return null
  }
}

export async function saveServerProfile(profile: MobileProfile) {
  setLocalProfile(profile)
  await fetch(`${OpenAPI.BASE}/api/gas-leak/mobile/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
}

export async function syncPushSettings() {
  const enabled = isPushEnabled()
  await fetch(`${OpenAPI.BASE}/api/gas-leak/mobile/push-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  setPushEnabled(enabled)
}

export async function fetchAlarmHistory(limit = 30) {
  const res = await fetch(`${OpenAPI.BASE}/api/gas-leak/alarm-history?limit=${limit}`)
  if (!res.ok) return []
  return res.json()
}
