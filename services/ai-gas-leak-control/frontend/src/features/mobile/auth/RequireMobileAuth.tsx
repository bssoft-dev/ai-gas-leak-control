import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useMobileAuth } from './MobileAuthContext'

export function RequireMobileAuth() {
  const { auth } = useMobileAuth()
  const location = useLocation()

  if (!auth) {
    return <Navigate to="/mobile/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
