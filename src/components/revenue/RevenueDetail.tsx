'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import {
  ArrowLeft, Loader2, Trash2, Landmark, Search, X, Lock, Unlock, CheckCircle, AlertTriangle, FileText,
} from 'lucide-react'

interface RevenueEntry {
  id: string
  file_name: string | null
  file_path: string | null
  entity_name: string | null
  description: string | null
  date: string | null
  reference: string | null
  source: string
  amount_ht: number | null
  tva_rate: number | null
  tva_amount: number | null
  amount_ttc: number | null
  pcg_code: string | null
  pcg_label: string | null
  journal_code: string | null
  matched_transaction_ids: string[]
  match_locked?: boolean
}

interface BankTx {
  id: string
  statement_id: string
  date: string
  label: string
  amount: number
  type: 'debit' | 'credit'
  match_status: string
  matched_invoice_id?: string | null
  matched_revenue_id?: string | null
  additional_invoice_ids?: string[]
  additional_revenue_ids?: string[]
}

export default function RevenueDetail({ revenueId }: { revenueId: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const authFetch = useAuthFetch()

  const [entry, setEntry] = useState<RevenueEntry | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [matchedTxs, setMatchedTxs] = useState<BankTx[]>([])
  const [showMatch, setShowMatch] = useState(false)
  const [allTxs, setAllTxs] = useState<BankTx[]>([])
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([])
  const [matching, setMatching] = useState(false)
  const [includeMatched, setIncludeMatched] = useState(false)
  const [bankSearch, setBankSearch] = useState('')
  const [allRevenueIds, setAllRevenueIds] = useState<string[]>([])

  useEffect(() => {
    if (user) fetchEntry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueId, user])

  useEffect(() => {
    if (!user) return
    authFetch('/api/revenue').then(r => r.ok ? r.json() : []).then((all: RevenueEntry[]) => {
      if (Array.isArray(all)) {
        const sorted = [...all].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        setAllRevenueIds(sorted.map(e => e.id))
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const fetchEntry = async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/revenue/${revenueId}`)
      if (res.ok) {
        const data = await res.json()
        setEntry(data)
        setFileUrl(data.file_url || null)
        // Load matched transactions
        const txRes = await authFetch('/api/bank-statements/transactions?match_status=matched')
        if (txRes.ok) {
          const txData = await txRes.json()
          const txs = txData.transactions || txData || []
          const matched = txs.filter((tx: BankTx) =>
            tx.matched_revenue_id === revenueId ||
            (Array.isArray(tx.additional_revenue_ids) && tx.additional_revenue_ids.includes(revenueId))
          )
          setMatchedTxs(matched)
        }
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await authFetch(`/api/revenue/${revenueId}`, { method: 'DELETE' })
      if (res.ok) {
        const idx = allRevenueIds.indexOf(revenueId)
        const next = idx >= 0 && idx < allRevenueIds.length - 1 ? allRevenueIds[idx + 1] : null
        if (next) router.push(`/revenue/${next}`)
        else router.push('/revenue')
      }
    } catch (e) { console.error(e) }
    setDeleting(false)
    setShowDeleteConfirm(false)
  }

  const toggleLock = async () => {
    if (!entry) return
    const newState = !entry.match_locked
    try {
      await authFetch(`/api/revenue/${revenueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_locked: newState }),
      })
      setEntry({ ...entry, match_locked: newState })
    } catch (e) { console.error(e) }
  }

  const openMatch = async () => {
    setShowMatch(true)
    setSelectedTxIds([])
    try {
      const url = includeMatched
        ? '/api/bank-statements/transactions'
        : '/api/bank-statements/transactions?match_status=unmatched'
      const res = await authFetch(url)
      if (res.ok) {
        const data = await res.json()
        const txs = (data.transactions || data || []).filter((tx: BankTx) =>
          tx.matched_revenue_id !== revenueId &&
          !(Array.isArray(tx.additional_revenue_ids) && tx.additional_revenue_ids.includes(revenueId))
        )
        setAllTxs(txs)
      }
    } catch (e) { console.error(e) }
  }

  const confirmMatch = async () => {
    if (selectedTxIds.length === 0) return
    setMatching(true)
    try {
      const newlyMatched: BankTx[] = []
      for (const txId of selectedTxIds) {
        const tx = allTxs.find(t => t.id === txId)
        if (!tx) continue
        await authFetch(`/api/bank-statements/${tx.statement_id}/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: txId, revenue_id: revenueId }),
        })
        newlyMatched.push(tx)
      }
      setMatchedTxs(prev => [...prev, ...newlyMatched])
      setShowMatch(false)
      setSelectedTxIds([])
      setAllTxs(prev => prev.filter(t => !selectedTxIds.includes(t.id)))
    } catch (e) { console.error(e) }
    setMatching(false)
  }

  const unmatchTx = async (tx: BankTx) => {
    if (entry?.match_locked) return
    if (!confirm('Annuler ce rapprochement ?')) return
    try {
      await authFetch(`/api/bank-statements/${tx.statement_id}/match`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: tx.id, revenue_id: revenueId }),
      })
      setMatchedTxs(prev => prev.filter(t => t.id !== tx.id))
    } catch (e) { console.error(e) }
  }

  const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-accent-green" /></div>
  }
  if (!entry) {
    return <div className="text-center text-gray-500">Encaissement non trouve</div>
  }

  const txTotal = matchedTxs.reduce((s, t) => s + (Number(t.amount) || 0), 0)
  const invTotal = Math.abs(entry.amount_ttc || 0)
  const diff = Math.abs(txTotal - invTotal)
  const isMatch = diff < 0.01
  const isClose = diff < 1
  const isLocked = entry.match_locked === true
  const currentIdx = allRevenueIds.indexOf(revenueId)
  const prevId = currentIdx > 0 ? allRevenueIds[currentIdx - 1] : null
  const nextId = currentIdx >= 0 && currentIdx < allRevenueIds.length - 1 ? allRevenueIds[currentIdx + 1] : null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button onClick={() => router.push('/revenue')} className="btn-secondary p-2 shrink-0"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => prevId && router.push(`/revenue/${prevId}`)} disabled={!prevId}
              className="rounded-lg border border-dark-border p-2 text-gray-400 hover:text-accent-green disabled:opacity-30">
              ←
            </button>
            <span className="px-2 text-xs font-mono text-gray-500">{currentIdx + 1} / {allRevenueIds.length}</span>
            <button onClick={() => nextId && router.push(`/revenue/${nextId}`)} disabled={!nextId}
              className="rounded-lg border border-dark-border p-2 text-gray-400 hover:text-accent-green disabled:opacity-30">
              →
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-white">{entry.file_name || entry.entity_name || 'Encaissement'}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
              {entry.entity_name && <span>Entite : <span className="text-gray-300">{entry.entity_name}</span></span>}
              {entry.reference && <span className="font-mono">Ref : {entry.reference}</span>}
              <span className="rounded-full bg-accent-green/20 px-2 py-0.5 text-xs font-medium text-accent-green">{entry.source}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-accent-red/30 bg-dark-card px-2.5 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red/10">
            <Trash2 className="h-3.5 w-3.5" />
            Supprimer
          </button>
          <button onClick={openMatch}
            className="flex items-center gap-1.5 rounded-lg border border-accent-green/30 bg-dark-card px-2.5 py-1.5 text-xs font-medium text-accent-green hover:bg-accent-green/10">
            <Landmark className="h-4 w-4" />
            {matchedTxs.length > 0 ? `Rapprocher (${matchedTxs.length}) +` : 'Rapprocher'}
          </button>
        </div>
      </div>

      {/* Matched transactions */}
      {matchedTxs.length > 0 && !showMatch && (
        <div className={`card space-y-3 ${isLocked ? 'border-2 border-accent-green/50' : ''}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isLocked ? <Lock className="h-4 w-4 text-accent-green" /> : <CheckCircle className="h-4 w-4 text-accent-green" />}
              <span className="text-sm font-semibold text-accent-green">
                {matchedTxs.length} transaction(s) rapprochee(s)
              </span>
              {isLocked && <span className="rounded-full bg-accent-green/20 px-2 py-0.5 text-[10px] font-bold uppercase text-accent-green">Verrouille</span>}
            </div>
            <button onClick={toggleLock}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                isLocked ? 'border-accent-orange/50 text-accent-orange hover:bg-accent-orange/10' : 'border-accent-green/50 text-accent-green hover:bg-accent-green/10'
              }`}>
              {isLocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {isLocked ? 'Deverrouiller' : 'Verrouiller'}
            </button>
          </div>

          {/* Total comparison */}
          <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
            isMatch ? 'border-accent-green/40 bg-accent-green/10' : isClose ? 'border-accent-orange/40 bg-accent-orange/10' : 'border-accent-red/40 bg-accent-red/10'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-gray-500">Total rapproche</span>
              <span className={`font-mono text-base font-bold ${isMatch ? 'text-accent-green' : isClose ? 'text-accent-orange' : 'text-accent-red'}`}>{fmt(txTotal)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">vs encaissement :</span>
              <span className="font-mono font-medium text-gray-300">{fmt(invTotal)}</span>
              {isMatch ? (
                <span className="rounded bg-accent-green/20 px-2 py-0.5 font-bold text-accent-green">MATCH</span>
              ) : (
                <span className={`rounded px-2 py-0.5 font-bold ${isClose ? 'bg-accent-orange/20 text-accent-orange' : 'bg-accent-red/20 text-accent-red'}`}>
                  {txTotal > invTotal ? '+' : ''}{fmt(txTotal - invTotal)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            {matchedTxs.map(tx => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-accent-green/20 bg-accent-green/5 px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-gray-400 shrink-0">{tx.date ? new Date(tx.date).toLocaleDateString('fr-FR') : '-'}</span>
                  <span className="text-sm text-gray-200 truncate">{tx.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-mono text-sm font-medium ${tx.type === 'debit' ? 'text-accent-red' : 'text-accent-green'}`}>{fmt(tx.amount || 0)}</span>
                  {!isLocked ? (
                    <button onClick={() => unmatchTx(tx)} className="rounded p-1 text-gray-500 hover:bg-accent-red/10 hover:text-accent-red">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <Lock className="h-3.5 w-3.5 text-accent-green" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match modal */}
      {showMatch && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Rapprocher avec des transactions</h3>
            <button onClick={() => setShowMatch(false)} className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-200"><ArrowLeft className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">Montant recherche :</span>
            <span className="rounded bg-accent-green/10 text-accent-green px-1.5 py-0.5 font-mono">{fmt(entry.amount_ttc || 0)}</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input type="text" value={bankSearch} onChange={e => setBankSearch(e.target.value)}
              placeholder="Rechercher par libelle..." className="input-field w-full pl-9 text-sm" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs">
            <input type="checkbox" checked={includeMatched} onChange={async () => {
              const nv = !includeMatched
              setIncludeMatched(nv)
              try {
                const url = nv ? '/api/bank-statements/transactions' : '/api/bank-statements/transactions?match_status=unmatched'
                const res = await authFetch(url)
                if (res.ok) {
                  const data = await res.json()
                  const txs = (data.transactions || data || []).filter((tx: BankTx) =>
                    tx.matched_revenue_id !== revenueId &&
                    !(Array.isArray(tx.additional_revenue_ids) && tx.additional_revenue_ids.includes(revenueId))
                  )
                  setAllTxs(txs)
                }
              } catch {}
            }} className="h-3.5 w-3.5 rounded border-dark-border bg-dark-input text-accent-orange" />
            <span className="text-gray-400">Inclure les transactions <strong className="text-accent-orange">deja rapprochees a d&apos;autres</strong></span>
          </label>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {allTxs.filter(tx => !bankSearch || (tx.label || '').toLowerCase().includes(bankSearch.toLowerCase())).map(tx => {
              const target = entry.amount_ttc || 0
              const isMatchAmt = Math.abs(tx.amount - target) <= 0.01
              const isSelected = selectedTxIds.includes(tx.id)
              return (
                <label key={tx.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 ${
                    isSelected ? 'border-accent-green/50 bg-accent-green/5' : isMatchAmt ? 'border-accent-green/20 bg-accent-green/5' : 'border-dark-border bg-dark-input'
                  }`}>
                  <input type="checkbox" checked={isSelected}
                    onChange={() => setSelectedTxIds(p => p.includes(tx.id) ? p.filter(i => i !== tx.id) : [...p, tx.id])}
                    className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-green" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-gray-200">{tx.label}</p>
                      {tx.match_status === 'matched' && (
                        <span className="shrink-0 rounded bg-accent-orange/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-orange">Deja liee</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 font-mono">{tx.date ? new Date(tx.date).toLocaleDateString('fr-FR') : '-'}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`font-mono text-sm font-medium ${tx.type === 'debit' ? 'text-accent-red' : 'text-accent-green'}`}>{fmt(tx.amount)}</span>
                    {isMatchAmt && <span className="ml-2 rounded bg-accent-green/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">MATCH</span>}
                  </div>
                </label>
              )
            })}
          </div>
          {selectedTxIds.length > 0 && (
            <div className="flex items-center justify-between border-t border-dark-border pt-3">
              <span className="text-xs text-gray-500">{selectedTxIds.length} selectionnee(s)</span>
              <button onClick={confirmMatch} disabled={matching}
                className="flex items-center gap-1.5 rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50">
                {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Confirmer
              </button>
            </div>
          )}
        </div>
      )}

      {/* PDF + Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-0" style={{ height: '600px' }}>
          {fileUrl ? (
            <iframe src={fileUrl} className="h-full w-full rounded-xl" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-gray-500">
              <FileText className="mb-3 h-12 w-12 text-gray-600" />
              <p className="text-sm">Aucun fichier associe</p>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Resume</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500">Total HT</p>
                <p className="font-mono text-lg font-bold text-gray-200">{fmt(entry.amount_ht || 0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">TVA</p>
                <p className="font-mono text-lg font-bold text-gray-200">{fmt(entry.tva_amount || 0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total TTC</p>
                <p className="font-mono text-lg font-bold text-accent-green">{fmt(entry.amount_ttc || 0)}</p>
              </div>
            </div>
          </div>
          {entry.pcg_code && (
            <div className="card border-2 border-accent-green/20 bg-accent-green/5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-accent-green">Ventilation comptable</h3>
              <div className="flex items-center gap-3 rounded-lg bg-dark-input px-3 py-2">
                <span className="shrink-0 rounded bg-accent-green/20 px-2 py-0.5 text-xs font-mono font-bold text-accent-green">{entry.pcg_code}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-200">{entry.pcg_label || '(libelle manquant)'}</p>
                  <p className="truncate text-xs text-gray-500">{entry.description}</p>
                </div>
                <span className="shrink-0 rounded bg-dark-border px-1.5 py-0.5 text-xs font-mono text-gray-400">Jnl {entry.journal_code || 'BQ'}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowDeleteConfirm(false)}>
          <div className="w-full max-w-md rounded-2xl bg-dark-card border border-dark-border p-6" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-red/10">
                <AlertTriangle className="h-5 w-5 text-accent-red" />
              </div>
              <h3 className="text-lg font-semibold text-gray-200">Supprimer cet encaissement ?</h3>
            </div>
            <p className="mb-6 text-sm text-gray-400">Cette action est irreversible.</p>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="btn-secondary">Annuler</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-2 rounded-lg bg-accent-red px-4 py-2 text-sm font-medium text-white hover:bg-accent-red/90 disabled:opacity-50">
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
