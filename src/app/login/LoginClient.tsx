'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth'
import { Zap, Loader2 } from 'lucide-react'

export default function LoginClient() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        await createUserWithEmailAndPassword(auth, email, password)
      }
      router.push('/')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Une erreur est survenue'
      if (message.includes('wrong-password') || message.includes('invalid-credential')) {
        setError('Email ou mot de passe incorrect')
      } else if (message.includes('user-not-found')) {
        setError('Aucun compte trouve avec cet email')
      } else if (message.includes('email-already-in-use')) {
        setError('Un compte existe deja avec cet email')
      } else if (message.includes('weak-password')) {
        setError('Le mot de passe doit contenir au moins 6 caracteres')
      } else if (message.includes('invalid-email')) {
        setError('Adresse email invalide')
      } else {
        setError(message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-bg px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-green text-dark-bg">
            <Zap className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold text-white">SYNERGIA-COMPT</h1>
          <p className="mt-1 text-sm text-gray-500">BOEHME — B.R.A.I.N. Escape & Quiz Game</p>
          <p className="mt-2 text-sm text-gray-400">
            Automatisation comptable par IA
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="votre@email.fr"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-300">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-accent-red/10 border border-accent-red/30 p-3 text-sm text-accent-red">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full"
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {mode === 'login' ? 'Se connecter' : 'Creer un compte'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              className="text-sm text-accent-green hover:text-accent-green/80"
            >
              {mode === 'login'
                ? "Pas encore de compte ? S'inscrire"
                : 'Deja un compte ? Se connecter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
