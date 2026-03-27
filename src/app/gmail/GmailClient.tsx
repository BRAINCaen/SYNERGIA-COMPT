'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import {
  Mail,
  Search,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Unlink,
  FileText,
  Calendar,
  User,
  RefreshCw,
  Filter,
} from 'lucide-react'

interface Attachment {
  filename: string
  size: number
  attachmentId: string
}

interface GmailEmail {
  messageId: string
  subject: string
  from: string
  date: string
  attachments: Attachment[]
}

interface ImportStatus {
  [key: string]: 'idle' | 'importing' | 'done' | 'error'
}

interface ImportErrors {
  [key: string]: string
}

export default function GmailClient() {
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const authFetch = useAuthFetch()

  const [connected, setConnected] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Scan parameters
  const [days, setDays] = useState(30)
  const [sender, setSender] = useState('')

  // Results
  const [emails, setEmails] = useState<GmailEmail[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importStatus, setImportStatus] = useState<ImportStatus>({})
  const [importErrors, setImportErrors] = useState<ImportErrors>({})

  // Check connection status
  const checkStatus = async () => {
    try {
      const res = await authFetch('/api/gmail/status')
      if (res.ok) {
        const data = await res.json()
        setConnected(data.connected)
        setEmail(data.email)
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) checkStatus()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Handle callback params
  useEffect(() => {
    const gmailParam = searchParams.get('gmail')
    const errorParam = searchParams.get('error')

    if (gmailParam === 'connected') {
      setSuccessMsg('Gmail connecte avec succes !')
      setConnected(true)
      // Re-check status to get email
      checkStatus()
      // Clean URL
      window.history.replaceState({}, '', '/gmail')
    }

    if (errorParam) {
      const errorMessages: Record<string, string> = {
        oauth_denied: 'Autorisation refusee par Google.',
        missing_params: 'Parametres manquants dans le retour Google.',
        invalid_state: 'Etat invalide. Veuillez reessayer.',
        config_missing: 'Configuration serveur manquante.',
        no_token: "Aucun token recu de Google.",
        callback_failed: 'Erreur lors du retour Google. Veuillez reessayer.',
      }
      setError(errorMessages[errorParam] || `Erreur: ${errorParam}`)
      window.history.replaceState({}, '', '/gmail')
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Connect Gmail
  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const res = await authFetch('/api/gmail/auth')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erreur')
      }
      const { url } = await res.json()
      // Redirect to Google consent screen
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion')
      setConnecting(false)
    }
  }

  // Disconnect Gmail
  const handleDisconnect = async () => {
    if (!confirm('Deconnecter Gmail ? Les tokens seront supprimes.')) return
    setDisconnecting(true)
    setError(null)
    try {
      const res = await authFetch('/api/gmail/disconnect', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Erreur')
      }
      setConnected(false)
      setEmail(null)
      setEmails([])
      setSelected(new Set())
      setImportStatus({})
      setSuccessMsg('Gmail deconnecte.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de deconnexion')
    } finally {
      setDisconnecting(false)
    }
  }

  // Scan Gmail
  const handleScan = async () => {
    setScanning(true)
    setError(null)
    setEmails([])
    setSelected(new Set())
    setImportStatus({})
    setImportErrors({})

    try {
      const res = await authFetch('/api/gmail/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, sender: sender.trim() || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        if (data.reconnect) {
          setConnected(false)
          setEmail(null)
        }
        throw new Error(data.error || 'Erreur de scan')
      }

      const data = await res.json()
      setEmails(data.emails)

      if (data.emails.length === 0) {
        setSuccessMsg('Aucun email avec PDF trouve pour cette periode.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du scan')
    } finally {
      setScanning(false)
    }
  }

  // Toggle selection
  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (selected.size === getAllKeys().length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(getAllKeys()))
    }
  }

  // Get all selectable keys
  const getAllKeys = () => {
    const keys: string[] = []
    for (const email of emails) {
      for (const att of email.attachments) {
        const key = `${email.messageId}:${att.attachmentId}`
        if (importStatus[key] !== 'done') {
          keys.push(key)
        }
      }
    }
    return keys
  }

  // Import selected
  const handleImportSelected = async () => {
    const toImport = Array.from(selected).filter((k) => importStatus[k] !== 'done')
    if (toImport.length === 0) return

    setError(null)

    for (const key of toImport) {
      const [messageId, attachmentId] = key.split(':')
      // Find the filename
      let filename = 'document.pdf'
      for (const e of emails) {
        if (e.messageId === messageId) {
          const att = e.attachments.find((a) => a.attachmentId === attachmentId)
          if (att) filename = att.filename
          break
        }
      }

      setImportStatus((prev) => ({ ...prev, [key]: 'importing' }))

      try {
        const res = await authFetch('/api/gmail/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message_id: messageId,
            attachment_id: attachmentId,
            filename,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          if (data.reconnect) {
            setConnected(false)
            setEmail(null)
            setError('Session Gmail expiree. Veuillez vous reconnecter.')
            return
          }
          throw new Error(data.error || 'Erreur import')
        }

        setImportStatus((prev) => ({ ...prev, [key]: 'done' }))
      } catch (err) {
        setImportStatus((prev) => ({ ...prev, [key]: 'error' }))
        setImportErrors((prev) => ({
          ...prev,
          [key]: err instanceof Error ? err.message : 'Erreur',
        }))
      }
    }

    const doneCount = toImport.filter(
      (k) =>
        importStatus[k] === 'done' ||
        // Will be set by the time we check, so also check via the latest state
        true
    ).length
    setSuccessMsg(`Import termine.`)
  }

  // Format date nicely
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  // Format sender: "Name <email>" -> show nicely
  const formatSender = (from: string) => {
    const match = from.match(/^"?(.+?)"?\s*<(.+)>$/)
    if (match) {
      return { name: match[1], email: match[2] }
    }
    return { name: from, email: '' }
  }

  // Count done imports
  const doneCount = Object.values(importStatus).filter((s) => s === 'done').length
  const importingCount = Object.values(importStatus).filter((s) => s === 'importing').length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Scanner Gmail</h1>
          <p className="mt-1 text-sm text-gray-500">
            Scannez votre boite mail pour importer automatiquement les factures PDF
          </p>
        </div>
        {connected && (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 rounded-lg border border-dark-border px-4 py-2 text-sm text-gray-400 transition-colors hover:border-accent-red/50 hover:text-accent-red"
          >
            {disconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
            Deconnecter Gmail
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-accent-red" />
          <p className="text-sm text-accent-red">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-accent-red/60 hover:text-accent-red">
            &times;
          </button>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-3 rounded-lg border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle className="h-5 w-5 shrink-0 text-accent-green" />
          <p className="text-sm text-accent-green">{successMsg}</p>
          <button onClick={() => setSuccessMsg(null)} className="ml-auto text-accent-green/60 hover:text-accent-green">
            &times;
          </button>
        </div>
      )}

      {/* Not connected */}
      {!connected && (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-dark-border bg-dark-card p-16">
          <Mail className="mb-4 h-16 w-16 text-gray-500" />
          <h2 className="mb-2 text-lg font-medium text-gray-300">
            Connectez votre compte Gmail
          </h2>
          <p className="mb-6 max-w-md text-center text-sm text-gray-500">
            Autorisez l&apos;acces en lecture seule a votre boite mail pour scanner et importer
            automatiquement les factures PDF recues.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2 rounded-lg bg-accent-green px-6 py-3 font-medium text-dark-bg transition-colors hover:bg-accent-green/90"
          >
            {connecting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mail className="h-5 w-5" />
            )}
            Connecter Gmail
          </button>
          <p className="mt-4 text-xs text-gray-600">
            Scope : lecture seule (gmail.readonly). Aucun email ne sera modifie ou supprime.
          </p>
        </div>
      )}

      {/* Connected - scan controls */}
      {connected && (
        <>
          {/* Connection info */}
          <div className="flex items-center gap-3 rounded-lg border border-accent-green/30 bg-accent-green/5 p-4">
            <CheckCircle className="h-5 w-5 text-accent-green" />
            <div>
              <p className="text-sm font-medium text-accent-green">Gmail connecte</p>
              {email && <p className="text-xs text-gray-500">{email}</p>}
            </div>
          </div>

          {/* Scan controls */}
          <div className="rounded-xl border border-dark-border bg-dark-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Filter className="h-4 w-4" />
              Parametres de scan
            </h3>

            <div className="flex flex-wrap items-end gap-4">
              {/* Date range */}
              <div>
                <label className="mb-1 block text-xs text-gray-500">Periode</label>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
                >
                  <option value={7}>7 derniers jours</option>
                  <option value={30}>30 derniers jours</option>
                  <option value={90}>90 derniers jours</option>
                  <option value={180}>6 mois</option>
                  <option value={365}>1 an</option>
                </select>
              </div>

              {/* Sender filter */}
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1 block text-xs text-gray-500">
                  Expediteur (optionnel)
                </label>
                <input
                  type="text"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  placeholder="ex: comptabilite@fournisseur.fr"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>

              {/* Scan button */}
              <button
                onClick={handleScan}
                disabled={scanning}
                className="flex items-center gap-2 rounded-lg bg-accent-green px-6 py-2 font-medium text-dark-bg transition-colors hover:bg-accent-green/90 disabled:opacity-50"
              >
                {scanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {scanning ? 'Scan en cours...' : 'Scanner ma boite mail'}
              </button>
            </div>
          </div>

          {/* Results */}
          {emails.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400">
                  {emails.length} email{emails.length > 1 ? 's' : ''} avec PDF trouves
                  {doneCount > 0 && (
                    <span className="ml-2 text-accent-green">
                      ({doneCount} importe{doneCount > 1 ? 's' : ''})
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleSelectAll}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {selected.size === getAllKeys().length
                      ? 'Tout deselectionner'
                      : 'Tout selectionner'}
                  </button>
                  {selected.size > 0 && (
                    <button
                      onClick={handleImportSelected}
                      disabled={importingCount > 0}
                      className="flex items-center gap-2 rounded-lg bg-accent-green px-4 py-2 text-sm font-medium text-dark-bg transition-colors hover:bg-accent-green/90 disabled:opacity-50"
                    >
                      {importingCount > 0 ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      Importer la selection ({selected.size})
                    </button>
                  )}
                </div>
              </div>

              {/* Email list */}
              <div className="space-y-3">
                {emails.map((email) => {
                  const senderInfo = formatSender(email.from)
                  return (
                    <div
                      key={email.messageId}
                      className="rounded-lg border border-dark-border bg-dark-card overflow-hidden"
                    >
                      {/* Email header */}
                      <div className="border-b border-dark-border px-4 py-3">
                        <div className="flex items-start gap-3">
                          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-200">
                              {email.subject}
                            </p>
                            <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {senderInfo.name}
                                {senderInfo.email && (
                                  <span className="text-gray-600">
                                    &lt;{senderInfo.email}&gt;
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(email.date)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Attachments */}
                      <div className="divide-y divide-dark-border">
                        {email.attachments.map((att) => {
                          const key = `${email.messageId}:${att.attachmentId}`
                          const status = importStatus[key] || 'idle'
                          const isSelected = selected.has(key)
                          const isDone = status === 'done'
                          const isImporting = status === 'importing'
                          const isError = status === 'error'

                          return (
                            <div
                              key={att.attachmentId}
                              className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                                isDone
                                  ? 'bg-accent-green/5'
                                  : isError
                                  ? 'bg-accent-red/5'
                                  : isSelected
                                  ? 'bg-accent-green/5'
                                  : 'hover:bg-dark-hover'
                              }`}
                            >
                              {/* Checkbox */}
                              {!isDone ? (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSelect(key)}
                                  disabled={isImporting}
                                  className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green"
                                />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-accent-green" />
                              )}

                              {/* File icon */}
                              <FileText className="h-5 w-5 shrink-0 text-accent-red" />

                              {/* File info */}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-gray-300">{att.filename}</p>
                                <p className="text-xs text-gray-600">
                                  {(att.size / 1024).toFixed(0)} Ko
                                </p>
                              </div>

                              {/* Status */}
                              {isImporting && (
                                <Loader2 className="h-4 w-4 animate-spin text-accent-green" />
                              )}
                              {isDone && (
                                <span className="text-xs font-medium text-accent-green">
                                  Importe
                                </span>
                              )}
                              {isError && (
                                <span className="text-xs font-medium text-accent-red" title={importErrors[key]}>
                                  Erreur
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state after scan */}
          {!scanning && emails.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dark-border bg-dark-card p-12 text-center">
              <Search className="mb-3 h-10 w-10 text-gray-600" />
              <p className="text-sm text-gray-500">
                Cliquez sur &quot;Scanner ma boite mail&quot; pour rechercher les factures PDF
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
