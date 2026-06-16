'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import {
  ArrowLeft, Loader2, Trash2, Landmark, Search, X, Lock, Unlock, CheckCircle, AlertTriangle, FileText,
  Pencil, Save, Lightbulb, Download,
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
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  type EditForm = {
    file_name: string
    entity_name: string
    description: string
    reference: string
    date: string
    amount_ht: string
    tva_rate: string
    amount_ttc: string
    pcg_code: string
    pcg_label: string
    journal_code: string
  }
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [alternatives, setAlternatives] = useState<Array<{ pcg_code: string; pcg_label: string; journal_code: string; confidence: number; reasoning: string }>>([])
  const [showAlternatives, setShowAlternatives] = useState(false)
  const [loadingAlternatives, setLoadingAlternatives] = useState(false)
  const [altUserContext, setAltUserContext] = useState('')
  const [excelRows, setExcelRows] = useState<string[][] | null>(null)
  const [excelSheetNames, setExcelSheetNames] = useState<string[]>([])
  const [activeSheetIdx, setActiveSheetIdx] = useState(0)

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

  const startEdit = () => {
    if (!entry) return
    setEditForm({
      file_name: entry.file_name || '',
      entity_name: entry.entity_name || '',
      description: entry.description || '',
      reference: entry.reference || '',
      date: entry.date || '',
      amount_ht: (entry.amount_ht ?? '').toString(),
      tva_rate: (entry.tva_rate ?? '').toString(),
      amount_ttc: (entry.amount_ttc ?? '').toString(),
      pcg_code: entry.pcg_code || '',
      pcg_label: entry.pcg_label || '',
      journal_code: entry.journal_code || 'VE',
    })
    setEditing(true)
    setShowAlternatives(false)
  }

  const cancelEdit = () => {
    setEditing(false)
    setEditForm(null)
    setShowAlternatives(false)
    setAlternatives([])
  }

  const saveEdit = async () => {
    if (!editForm || !entry) return
    setSaving(true)
    try {
      const parseNum = (s: string) => {
        if (!s.trim()) return null
        const v = parseFloat(s.replace(',', '.'))
        return isNaN(v) ? null : Math.round(v * 100) / 100
      }
      const payload: Record<string, unknown> = {
        file_name: editForm.file_name || null,
        entity_name: editForm.entity_name || null,
        description: editForm.description || null,
        reference: editForm.reference || null,
        date: editForm.date || null,
        amount_ht: parseNum(editForm.amount_ht),
        tva_rate: parseNum(editForm.tva_rate),
        amount_ttc: parseNum(editForm.amount_ttc),
        pcg_code: editForm.pcg_code || null,
        pcg_label: editForm.pcg_label || null,
        journal_code: editForm.journal_code || null,
      }
      const res = await authFetch(`/api/revenue/${revenueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const updated = await res.json()
        setEntry((prev) => prev ? { ...prev, ...updated } : updated)
        setEditing(false)
        setEditForm(null)
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`Erreur : ${err.error || 'Sauvegarde echouee'}`)
      }
    } catch (e) {
      console.error('Save edit error:', e)
      alert('Erreur reseau')
    }
    setSaving(false)
  }

  const requestAlternatives = async () => {
    if (!entry) return
    setLoadingAlternatives(true)
    setShowAlternatives(true)
    try {
      const res = await authFetch('/api/invoices/suggest-alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: entry.description || entry.entity_name || 'Encaissement',
          supplier_name: entry.entity_name || '',
          total_ht: entry.amount_ht || entry.amount_ttc || 0,
          current_pcg_code: entry.pcg_code || '',
          document_type: 'revenue',
          user_context: altUserContext || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setAlternatives(data.alternatives || [])
      } else {
        setAlternatives([])
      }
    } catch (e) {
      console.error('Alternatives error:', e)
      setAlternatives([])
    }
    setLoadingAlternatives(false)
  }

  const applyAlternative = (alt: { pcg_code: string; pcg_label: string; journal_code: string }) => {
    if (!editForm) {
      // Switch to editing mode and apply
      startEdit()
      setTimeout(() => {
        setEditForm((prev) => prev ? { ...prev, pcg_code: alt.pcg_code, pcg_label: alt.pcg_label, journal_code: alt.journal_code } : prev)
      }, 0)
    } else {
      setEditForm({ ...editForm, pcg_code: alt.pcg_code, pcg_label: alt.pcg_label, journal_code: alt.journal_code })
    }
    setShowAlternatives(false)
  }

  // Load Excel content client-side for inline preview
  useEffect(() => {
    if (!entry || !fileUrl) return
    const name = (entry.file_name || '').toLowerCase()
    if (!/\.(xlsx?|xls)$/.test(name)) {
      setExcelRows(null)
      setExcelSheetNames([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [{ default: XLSX }, blob] = await Promise.all([
          import('xlsx'),
          fetch(fileUrl).then(r => r.arrayBuffer()),
        ])
        if (cancelled) return
        const wb = XLSX.read(new Uint8Array(blob), { type: 'array' })
        setExcelSheetNames(wb.SheetNames)
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: '' })
        setExcelRows(rows as string[][])
        setActiveSheetIdx(0)
      } catch (e) {
        console.error('Excel preview error:', e)
        setExcelRows(null)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, entry?.file_name])

  const switchSheet = async (idx: number) => {
    if (!fileUrl) return
    try {
      const [{ default: XLSX }, blob] = await Promise.all([
        import('xlsx'),
        fetch(fileUrl).then(r => r.arrayBuffer()),
      ])
      const wb = XLSX.read(new Uint8Array(blob), { type: 'array' })
      const sheet = wb.Sheets[wb.SheetNames[idx]]
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: '' })
      setExcelRows(rows as string[][])
      setActiveSheetIdx(idx)
    } catch { /* */ }
  }

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
          {!editing ? (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 rounded-lg border border-accent-blue/30 bg-dark-card px-2.5 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/10">
              <Pencil className="h-3.5 w-3.5" />
              Modifier
            </button>
          ) : (
            <>
              <button onClick={cancelEdit} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg border border-dark-border bg-dark-card px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:bg-dark-hover">
                <X className="h-3.5 w-3.5" />
                Annuler
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-accent-green px-3 py-1.5 text-xs font-semibold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Sauvegarder
              </button>
            </>
          )}
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
          {selectedTxIds.length > 0 && (() => {
            const selectedTotal = selectedTxIds.reduce((sum, id) => {
              const tx = allTxs.find(t => t.id === id)
              return sum + (tx?.amount || 0)
            }, 0)
            const target = entry.amount_ttc || 0
            const currentTotal = matchedTxs.reduce((s, t) => s + (Number(t.amount) || 0), 0)
            const finalTotal = currentTotal + selectedTotal
            const diffSel = Math.abs(selectedTotal - target)
            const isSelMatch = diffSel < 0.01
            const diffFinal = Math.abs(finalTotal - target)
            const isFinalMatch = diffFinal < 0.01
            const isFinalClose = diffFinal < 1
            return (
            <div className="space-y-2 border-t border-dark-border pt-3">
              <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                isSelMatch ? 'border-accent-green/40 bg-accent-green/10' :
                'border-dark-border bg-dark-input'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-gray-500">Total selection</span>
                  <span className={`font-mono text-base font-bold ${isSelMatch ? 'text-accent-green' : 'text-gray-200'}`}>
                    {fmt(selectedTotal)}
                  </span>
                  <span className="text-xs text-gray-500">({selectedTxIds.length} lignes)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">vs cible :</span>
                  <span className="font-mono font-medium text-gray-300">{fmt(target)}</span>
                  {isSelMatch ? (
                    <span className="rounded bg-accent-green/20 px-2 py-0.5 font-bold text-accent-green">MATCH</span>
                  ) : (
                    <span className="rounded bg-dark-border px-2 py-0.5 font-mono text-gray-400">
                      {selectedTotal > target ? '+' : ''}{fmt(selectedTotal - target)}
                    </span>
                  )}
                </div>
              </div>
              {matchedTxs.length > 0 && (
                <div className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs ${
                  isFinalMatch ? 'border-accent-green/40 bg-accent-green/5' :
                  isFinalClose ? 'border-accent-orange/40 bg-accent-orange/5' :
                  'border-accent-red/40 bg-accent-red/5'
                }`}>
                  <span className="text-gray-500">
                    Total final apres rapprochement :
                    <span className={`ml-2 font-mono font-bold ${isFinalMatch ? 'text-accent-green' : isFinalClose ? 'text-accent-orange' : 'text-accent-red'}`}>
                      {fmt(finalTotal)}
                    </span>
                    <span className="ml-2 text-gray-600">({matchedTxs.length} deja + {selectedTxIds.length} nouveaux)</span>
                  </span>
                  {isFinalMatch && <span className="rounded bg-accent-green/20 px-2 py-0.5 font-bold text-accent-green">MATCH FINAL</span>}
                </div>
              )}
              <div className="flex items-center justify-end">
                <button onClick={confirmMatch} disabled={matching}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50">
                  {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Confirmer le rapprochement
                </button>
              </div>
            </div>
            )
          })()}
        </div>
      )}

      {/* Document viewer + edit/summary panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Document viewer */}
        <div className="card p-0 overflow-hidden" style={{ height: '600px' }}>
          {fileUrl ? (
            excelRows ? (
              <div className="flex h-full flex-col">
                {excelSheetNames.length > 1 && (
                  <div className="flex items-center gap-1 border-b border-dark-border bg-dark-input px-2 py-1.5 overflow-x-auto">
                    {excelSheetNames.map((name, i) => (
                      <button key={name} onClick={() => switchSheet(i)}
                        className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                          i === activeSheetIdx ? 'bg-accent-green/20 text-accent-green' : 'text-gray-400 hover:bg-dark-hover'
                        }`}>
                        {name}
                      </button>
                    ))}
                    <a href={fileUrl} download className="ml-auto shrink-0 flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:bg-dark-hover">
                      <Download className="h-3 w-3" /> Telecharger
                    </a>
                  </div>
                )}
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {excelRows.slice(0, 500).map((row, ri) => (
                        <tr key={ri} className={ri === 0 ? 'bg-dark-input font-semibold text-gray-300' : 'border-b border-dark-border/50'}>
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1 whitespace-nowrap text-gray-300">{String(cell ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {excelRows.length > 500 && (
                    <p className="px-3 py-2 text-xs text-gray-500 italic">+ {excelRows.length - 500} lignes supplementaires...</p>
                  )}
                </div>
              </div>
            ) : (
              <iframe src={fileUrl} className="h-full w-full rounded-xl" />
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-gray-500">
              <FileText className="mb-3 h-12 w-12 text-gray-600" />
              <p className="text-sm">Aucun fichier associe</p>
            </div>
          )}
        </div>

        {/* Edit / Summary panel */}
        <div className="space-y-4">
          {/* Edit form */}
          {editing && editForm && (
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-accent-blue">Modification</h3>

              <div>
                <label className="text-xs text-gray-500">Nom du fichier</label>
                <input type="text" value={editForm.file_name}
                  onChange={e => setEditForm({ ...editForm, file_name: e.target.value })}
                  className="input-field w-full text-sm font-mono" placeholder="nom-fichier.pdf" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Entite / Client</label>
                  <input type="text" value={editForm.entity_name}
                    onChange={e => setEditForm({ ...editForm, entity_name: e.target.value })}
                    className="input-field w-full text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Reference</label>
                  <input type="text" value={editForm.reference}
                    onChange={e => setEditForm({ ...editForm, reference: e.target.value })}
                    className="input-field w-full text-sm font-mono" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500">Description</label>
                <input type="text" value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  className="input-field w-full text-sm" />
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Date</label>
                  <input type="date" value={editForm.date}
                    onChange={e => setEditForm({ ...editForm, date: e.target.value })}
                    className="input-field w-full text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Total HT</label>
                  <input type="text" inputMode="decimal" value={editForm.amount_ht}
                    onChange={e => setEditForm({ ...editForm, amount_ht: e.target.value })}
                    className="input-field w-full text-sm font-mono text-right" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">TVA %</label>
                  <input type="text" inputMode="decimal" value={editForm.tva_rate}
                    onChange={e => setEditForm({ ...editForm, tva_rate: e.target.value })}
                    className="input-field w-full text-sm font-mono text-right" placeholder="20" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Total TTC</label>
                  <input type="text" inputMode="decimal" value={editForm.amount_ttc}
                    onChange={e => setEditForm({ ...editForm, amount_ttc: e.target.value })}
                    className="input-field w-full text-sm font-mono text-right" />
                </div>
              </div>

              <div className="border-t border-dark-border pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500">Code comptable</label>
                  <button onClick={requestAlternatives} disabled={loadingAlternatives}
                    className="flex items-center gap-1 rounded border border-accent-orange/40 px-2 py-0.5 text-xs text-accent-orange hover:bg-accent-orange/10 disabled:opacity-50">
                    {loadingAlternatives ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                    Suggerer (IA)
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input type="text" value={editForm.pcg_code}
                    onChange={e => setEditForm({ ...editForm, pcg_code: e.target.value })}
                    className="input-field text-sm font-mono" placeholder="70610000" />
                  <input type="text" value={editForm.pcg_label}
                    onChange={e => setEditForm({ ...editForm, pcg_label: e.target.value })}
                    className="input-field text-sm col-span-2" placeholder="Libelle PCG" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Journal</label>
                  <input type="text" value={editForm.journal_code}
                    onChange={e => setEditForm({ ...editForm, journal_code: e.target.value.toUpperCase() })}
                    className="input-field w-24 text-sm font-mono uppercase" placeholder="VE" maxLength={4} />
                </div>
              </div>
            </div>
          )}

          {/* Alternatives panel */}
          {showAlternatives && (
            <div className="card border border-accent-orange/30 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-accent-orange">
                  <Lightbulb className="h-4 w-4" /> Alternatives IA
                </h3>
                <button onClick={() => setShowAlternatives(false)} className="rounded p-1 text-gray-500 hover:bg-dark-hover">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Contexte additionnel (optionnel)</label>
                <input type="text" value={altUserContext}
                  onChange={e => setAltUserContext(e.target.value)}
                  placeholder="Ex: ventes de billetterie escape game"
                  className="input-field w-full text-sm" />
                <button onClick={requestAlternatives} disabled={loadingAlternatives}
                  className="rounded bg-accent-orange/20 px-3 py-1 text-xs font-medium text-accent-orange hover:bg-accent-orange/30 disabled:opacity-50">
                  {loadingAlternatives ? 'Recherche...' : 'Re-suggerer'}
                </button>
              </div>
              {loadingAlternatives ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-accent-orange" />
                </div>
              ) : alternatives.length === 0 ? (
                <p className="text-center text-sm text-gray-500 py-4">Aucune alternative trouvee.</p>
              ) : (
                <div className="space-y-2">
                  {alternatives.map((alt, i) => (
                    <button key={i} onClick={() => applyAlternative(alt)}
                      className="w-full text-left rounded-lg border border-dark-border bg-dark-input px-3 py-2 hover:border-accent-orange/50 hover:bg-accent-orange/5 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-accent-orange/20 px-2 py-0.5 text-xs font-mono font-bold text-accent-orange">{alt.pcg_code}</span>
                          <span className="text-sm font-medium text-gray-200">{alt.pcg_label}</span>
                        </div>
                        <span className="text-xs text-gray-500">{Math.round(alt.confidence * 100)}% · Jnl {alt.journal_code}</span>
                      </div>
                      <p className="text-xs text-gray-500 italic">{alt.reasoning}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Read-only summary (when not editing) */}
          {!editing && (
            <>
              <div className="card space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Resume</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-500">Total HT</p>
                    <p className="font-mono text-lg font-bold text-gray-200">{fmt(entry.amount_ht || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">TVA {entry.tva_rate != null ? `(${entry.tva_rate}%)` : ''}</p>
                    <p className="font-mono text-lg font-bold text-gray-200">{fmt(entry.tva_amount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total TTC</p>
                    <p className="font-mono text-lg font-bold text-accent-green">{fmt(entry.amount_ttc || 0)}</p>
                  </div>
                </div>
              </div>
              {entry.pcg_code ? (
                <div className="card border-2 border-accent-green/20 bg-accent-green/5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-accent-green">Ventilation comptable</h3>
                    <button onClick={requestAlternatives} disabled={loadingAlternatives}
                      className="flex items-center gap-1 rounded border border-accent-orange/40 px-2 py-0.5 text-xs text-accent-orange hover:bg-accent-orange/10 disabled:opacity-50">
                      {loadingAlternatives ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lightbulb className="h-3 w-3" />}
                      Pas d&apos;accord ?
                    </button>
                  </div>
                  <div className="flex items-center gap-3 rounded-lg bg-dark-input px-3 py-2">
                    <span className="shrink-0 rounded bg-accent-green/20 px-2 py-0.5 text-xs font-mono font-bold text-accent-green">{entry.pcg_code}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-200">{entry.pcg_label || '(libelle manquant)'}</p>
                      <p className="truncate text-xs text-gray-500">{entry.description}</p>
                    </div>
                    <span className="shrink-0 rounded bg-dark-border px-1.5 py-0.5 text-xs font-mono text-gray-400">Jnl {entry.journal_code || 'BQ'}</span>
                  </div>
                </div>
              ) : (
                <div className="card border border-accent-orange/30 bg-accent-orange/5">
                  <p className="text-sm text-accent-orange mb-2">Aucun code comptable defini</p>
                  <button onClick={startEdit} className="rounded bg-accent-orange/20 px-3 py-1 text-xs font-medium text-accent-orange hover:bg-accent-orange/30">
                    Definir manuellement
                  </button>
                </div>
              )}
            </>
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
