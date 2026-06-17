const AUTH_KEY = 'gas_leak_mobile_auth'
const PUSH_KEY = 'gas_leak_mobile_push_enabled'
const PROFILE_KEY = 'gas_leak_mobile_profile'

export type MobileProfile = {
  name: string
  phone: string
  role: string
}

export type MobileAuth = {
  userId: string
  displayName: string
  loggedInAt: string
  biometric: boolean
}

export function getMobileAuth(): MobileAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    return raw ? (JSON.parse(raw) as MobileAuth) : null
  } catch {
    return null
  }
}

export function setMobileAuth(auth: MobileAuth): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
}

export function clearMobileAuth(): void {
  localStorage.removeItem(AUTH_KEY)
}

export function isPushEnabled(): boolean {
  return localStorage.getItem(PUSH_KEY) !== 'false'
}

export function setPushEnabled(enabled: boolean): void {
  localStorage.setItem(PUSH_KEY, enabled ? 'true' : 'false')
}

export function getLocalProfile(): MobileProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return JSON.parse(raw) as MobileProfile
  } catch {
    /* ignore */
  }
  return { name: '', phone: '', role: 'operator' }
}

export function setLocalProfile(profile: MobileProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}
