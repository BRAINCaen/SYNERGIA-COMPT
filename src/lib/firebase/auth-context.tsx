'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user)
      if (user) {
        const t = await user.getIdToken()
        setToken(t)
        // Set cookie for middleware route protection
        document.cookie = `firebase-auth-token=${t}; path=/; max-age=3600; SameSite=Lax`
      } else {
        setToken(null)
        document.cookie = 'firebase-auth-token=; path=/; max-age=0'
      }
      setLoading(false)
    })
    return () => unsubscribe()
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
    // Always get a fresh token to avoid 401 on expired tokens
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
