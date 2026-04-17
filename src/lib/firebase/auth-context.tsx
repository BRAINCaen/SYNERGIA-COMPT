'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, User, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { auth } from './client'

interface AuthContextType {
  user: User | null
  loading: boolean
  token: string | null
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  token: null,
})

// Cookie lifetime: 7 days (middleware check only — actual auth is Firebase session)
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7
// Refresh Firebase ID token every 50 min (tokens expire after 1h)
const TOKEN_REFRESH_INTERVAL = 50 * 60 * 1000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Force local persistence (survives browser close)
    setPersistence(auth, browserLocalPersistence).catch(() => {})

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user)
      if (user) {
        const t = await user.getIdToken()
        setToken(t)
        document.cookie = `firebase-auth-token=${t}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
      } else {
        setToken(null)
        document.cookie = 'firebase-auth-token=; path=/; max-age=0'
      }
      setLoading(false)
    })

    // Proactively refresh token every 50 min so the cookie stays valid
    const refreshInterval = setInterval(async () => {
      if (auth.currentUser) {
        try {
          const freshToken = await auth.currentUser.getIdToken(true) // force refresh
          setToken(freshToken)
          document.cookie = `firebase-auth-token=${freshToken}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
        } catch (e) {
          console.error('Token refresh failed:', e)
        }
      }
    }, TOKEN_REFRESH_INTERVAL)

    return () => {
      unsubscribe()
      clearInterval(refreshInterval)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, token }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

export function useAuthFetch() {
  const { user } = useAuth()

  return async (url: string, options: RequestInit = {}) => {
    // Always get a fresh token (Firebase auto-refreshes if expired)
    const freshToken = user ? await user.getIdToken() : null
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${freshToken}`,
      },
    })
  }
}
