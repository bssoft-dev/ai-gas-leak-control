import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import {
  clearMobileAuth,
  getMobileAuth,
  setMobileAuth,
  type MobileAuth,
} from '../../../pwa/mobileStorage'

type MobileAuthContextValue = {
  auth: MobileAuth | null
  loginWithBiometric: () => Promise<void>
  loginWithPin: (userId: string, pin: string) => Promise<void>
  logout: () => void
}

const MobileAuthContext = createContext<MobileAuthContextValue | null>(null)

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<MobileAuth | null>(() => getMobileAuth())

  const loginWithBiometric = useCallback(async () => {
    if (window.PublicKeyCredential) {
      try {
        await navigator.credentials.get({
          publicKey: {
            challenge: new Uint8Array(32),
            timeout: 60000,
            userVerification: 'preferred',
            rpId: window.location.hostname,
          },
        } as CredentialRequestOptions)
      } catch {
        /* 데모: WebAuthn 미지원·취소 시 PIN 없이 로그인 허용 */
      }
    }
    const next: MobileAuth = {
      userId: 'mobile-operator',
      displayName: '현장 운영자',
      loggedInAt: new Date().toISOString(),
      biometric: true,
    }
    setMobileAuth(next)
    setAuthState(next)
  }, [])

  const loginWithPin = useCallback(async (userId: string, pin: string) => {
    if (!userId.trim() || pin.length < 4) {
      throw new Error('아이디와 PIN(4자리 이상)을 입력해 주세요.')
    }
    const next: MobileAuth = {
      userId: userId.trim(),
      displayName: userId.trim(),
      loggedInAt: new Date().toISOString(),
      biometric: false,
    }
    setMobileAuth(next)
    setAuthState(next)
  }, [])

  const logout = useCallback(() => {
    clearMobileAuth()
    setAuthState(null)
  }, [])

  const value = useMemo(
    () => ({ auth, loginWithBiometric, loginWithPin, logout }),
    [auth, loginWithBiometric, loginWithPin, logout],
  )

  return <MobileAuthContext.Provider value={value}>{children}</MobileAuthContext.Provider>
}

export function useMobileAuth() {
  const ctx = useContext(MobileAuthContext)
  if (!ctx) throw new Error('useMobileAuth must be used within MobileAuthProvider')
  return ctx
}
