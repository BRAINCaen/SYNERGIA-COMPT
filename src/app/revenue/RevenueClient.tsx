'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import { useRouter } from 'next/navigation'
import {
  Coins,
  Upload,
  FileText,
  Loader2,
  Trash2,
  Check,
  AlertTriangle,
  Landmark,
  Search,
  X,
  CheckCircle,
  CreditCard,
  Building2,
  Receipt,
  Banknote,
  Ticket,
  Briefcase,
  HandCoins,
  Download,
} from 'lucide-react'
import type { RevenueEntry, RevenueSource } from '@/types'

// ── Revenue extracted data from AI ──────────────────
interface ExtractedRevenue {
  document_type: 'encaissement' | 'subvention'
  source: RevenueSource
  entity_name: string
  date: string
  description: string
  amount_ht: number
  tva_rate: number
  amount_ttc: number
  reference: string | null
  items: { description: string; amount: number }[]
}

// ── Sources config ──────────────────────────────────
const SOURCES: { key: RevenueSource; label: string; color: string; icon: React.ElementType; tab?: string }[] = [
  { key: 'billetterie', label: 'Billetterie', color: 'bg-pink-500/20 text-pink-400 border-pink-500/30', icon: Ticket, tab: 'billetterie' },
  { key: 'virement', label: 'Virements', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Building2, tab: 'virements' },
  { key: 'tpe_virtuel', label: 'TPE Virtuel', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: CreditCard, tab: 'tpe' },
  { key: 'tpe_sur_place', label: 'TPE Sur place', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', icon: CreditCard, tab: 'tpe' },
  { key: 'cheque', label: 'Cheques', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: FileText, tab: 'cheques' },
  { key: 'ancv', label: 'ANCV', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: Receipt, tab: 'ancv' },
  { key: 'especes', label: 'Especes', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: Banknote },
  { key: 'prestation', label: 'Prestations', color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30', icon: Briefcase, tab: 'prestations' },
  { key: 'subvention', label: 'Subventions', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: HandCoins, tab: 'subventions' },
]

const SOURCE_MAP = Object.fromEntries(SOURCES.map((s) => [s.key, s]))

// ── Category tabs ───────────────────────────────────
const TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'billetterie', label: 'Billetterie', sources: ['billetterie'] },
  { key: 'virements', label: 'Virements', sources: ['virement'] },
  { key: 'tpe', label: 'TPE', sources: ['tpe_virtuel', 'tpe_sur_place'] },
  { key: 'cheques', label: 'Cheques', sources: ['cheque'] },
  { key: 'ancv', label: 'ANCV', sources: ['ancv'] },
  { key: 'prestations', label: 'Prestations', sources: ['prestation'] },
  { key: 'subventions', label: 'Subventions', sources: ['subvention'] },
]

// ── Helpers ─────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20AC'

const MONTHS = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
]

function getMonthOptions() {
  const opts = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    opts.push({ value: val, label })
  }
  return opts
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

// ── Uploading file state ────────────────────────────
interface UploadingFile {
  file: File
  status: 'uploading' | 'extracting' | 'extracted' | 'saving' | 'done' | 'error'
  progress: number
  data?: ExtractedRevenue
  error?: string
}

// ── Component ───────────────────────────────────────
export default function RevenueClient() {
  const { user, loading: authLoading } = useAuth()
  const authFetch = useAuthFetch()
  const router = useRouter()

  const monthOptions = getMonthOptions()
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value)
  const [entries, setEntries] = useState<RevenueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)

  // Bank matching state
  const [bankMatchEntryId, setBankMatchEntryId] = useState<string | null>(null)
  const [bankTransactions, setBankTransactions] = useState<any[]>([])
  const [bankSearching, setBankSearching] = useState(false)
  const [bankSearch, setBankSearch] = useState('')
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([])
  const [bankMatchedEntries, setBankMatchedEntries] = useState<Record<string, string[]>>({})
  const [bankMatching, setBankMatching] = useState(false)

  // ── Fetch entries ─────────────────────────────────
  const fetchEntries = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await authFetch(`/api/revenue?month=${selectedMonth}`)
      if (res.ok) {
        const data = await res.json()
        setEntries(Array.isArray(data) ? data : [])
        // Build matched entries map from existing data
        const matched: Record<string, string[]> = {}
        const arr = Array.isArray(data) ? data : []
        arr.forEach((e: RevenueEntry) => {
          if (e.matched_transaction_ids && e.matched_transaction_ids.length > 0) {
            matched[e.id] = e.matched_transaction_ids
          }
        })
        setBankMatchedEntries(matched)
      }
    } catch (e) {
      console.error('Fetch revenue error:', e)
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedMonth])

  useEffect(() => {
    if (!authLoading && user) fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, selectedMonth])

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  // ── Filtered entries ──────────────────────────────
  const filtered = useMemo(() => {
    if (activeTab === 'all') return entries
    const tab = TABS.find((t) => t.key === activeTab)
    if (!tab || !('sources' in tab)) return entries
    return entries.filter((e) => (tab as { sources: string[] }).sources.includes(e.source))
  }, [entries, activeTab])

  // ── Summary computations ──────────────────────────
  const totalEncaissements = useMemo(
    () => entries.filter((e) => e.source !== 'subvention').reduce((sum, e) => sum + e.amount_ttc, 0),
    [entries]
  )
  const totalBilletterieTpe = useMemo(
    () => entries.filter((e) => ['billetterie', 'tpe_virtuel', 'tpe_sur_place'].includes(e.source)).reduce((sum, e) => sum + e.amount_ttc, 0),
    [entries]
  )
  const totalVirements = useMemo(
    () => entries.filter((e) => e.source === 'virement').reduce((sum, e) => sum + e.amount_ttc, 0),
    [entries]
  )
  const totalSubventions = useMemo(
    () => entries.filter((e) => e.source === 'subvention').reduce((sum, e) => sum + e.amount_ttc, 0),
    [entries]
  )

  // ── Upload / AI extraction flow ───────────────────
  const processFile = async (file: File, index: number) => {
    setUploadingFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, status: 'extracting', progress: 30 } : f))
    )

    const extractForm = new FormData()
    extractForm.append('file', file)

    try {
      const extractRes = await authFetch('/api/revenue/extract', {
        method: 'POST',
        body: extractForm,
      })

      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({ error: 'Erreur extraction' }))
        setUploadingFiles((prev) =>
          prev.map((f, i) => (i === index ? { ...f, status: 'error', error: err.error } : f))
        )
        return
      }

      const { data } = (await extractRes.json()) as { data: ExtractedRevenue }
      setUploadingFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'extracted', progress: 70, data } : f))
      )

      // Save to DB
      setUploadingFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'saving', progress: 85 } : f))
      )

      const ht = data.amount_ht || 0
      const tvaRate = data.tva_rate || 0
      const ttc = data.amount_ttc || ht * (1 + tvaRate / 100)

      const saveForm = new FormData()
      saveForm.append('file', file)
      saveForm.append('date', data.date || new Date().toISOString().slice(0, 10))
      saveForm.append('document_type', data.document_type || 'encaissement')
      saveForm.append('source', data.source || 'virement')
      saveForm.append('entity_name', data.entity_name || '')
      saveForm.append('description', data.description || '')
      saveForm.append('reference', data.reference || '')
      saveForm.append('amount_ht', String(ht))
      saveForm.append('tva_rate', String(tvaRate))
      saveForm.append('amount_ttc', String(ttc))
      saveForm.append('items', JSON.stringify(data.items || []))
      saveForm.append('pcg_code', data.source === 'subvention' ? '74100000' : '70610000')
      saveForm.append('pcg_label', data.source === 'subvention' ? "Subventions d'exploitation" : 'Ventes')
      saveForm.append('journal_code', 'VE')

      const saveRes = await authFetch('/api/revenue', { method: 'POST', body: saveForm })

      if (!saveRes.ok) {
        setUploadingFiles((prev) =>
          prev.map((f, i) => (i === index ? { ...f, status: 'error', error: 'Erreur sauvegarde' } : f))
        )
        return
      }

      setUploadingFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'done', progress: 100 } : f))
      )
      fetchEntries()
    } catch {
      setUploadingFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'error', error: 'Erreur inattendue' } : f))
      )
    }
  }

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files)
    const startIdx = uploadingFiles.length
    const newFiles: UploadingFile[] = arr.map((f) => ({
      file: f,
      status: 'uploading' as const,
      progress: 10,
    }))
    setUploadingFiles((prev) => [...prev, ...newFiles])
    // Process sequentially with delay to avoid rate limits
    const processSequentially = async () => {
      for (let i = 0; i < arr.length; i++) {
        await processFile(arr[i], startIdx + i)
        if (i < arr.length - 1) await new Promise(r => setTimeout(r, 2000))
      }
    }
    processSequentially()
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadingFiles.length]
  )

  // ── Delete ────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cet encaissement ?')) return
    try {
      const res = await authFetch(`/api/revenue/${id}`, { method: 'DELETE' })
      if (res.ok) fetchEntries()
    } catch (e) {
      console.error('Delete revenue error:', e)
    }
  }

  // ── Bank matching ─────────────────────────────────
  const openBankMatch = async (entryId: string) => {
    if (bankMatchEntryId === entryId) {
      setBankMatchEntryId(null)
      return
    }
    setBankMatchEntryId(entryId)
    setSelectedTxIds([])
    setBankSearch('')
    setBankSearching(true)
    try {
      const res = await authFetch('/api/bank-statements/transactions?match_status=unmatched')
      if (res.ok) {
        const data = await res.json()
        setBankTransactions(data.transactions || data || [])
      }
    } catch (e) {
      console.error('Fetch bank transactions error:', e)
    }
    setBankSearching(false)
  }

  const handleBankMatch = async (entryId: string) => {
    if (selectedTxIds.length === 0) return
    setBankMatching(true)
    try {
      const res = await authFetch(`/api/revenue/${entryId}/match-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: selectedTxIds }),
      })
      if (res.ok) {
        setBankMatchedEntries((prev) => ({ ...prev, [entryId]: selectedTxIds }))
        setBankMatchEntryId(null)
        setSelectedTxIds([])
      }
    } catch (e) {
      console.error('Match error:', e)
    }
    setBankMatching(false)
  }

  // ── Render ────────────────────────────────────────
  if (authLoading) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-accent-green/10 p-3">
              <Coins className="h-6 w-6 text-accent-green" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Encaissements &amp; Subventions</h1>
              <p className="text-sm text-gray-500">
                Upload de justificatifs — extraction automatique par IA
              </p>
            </div>
          </div>
        </div>

        {/* Month selector */}
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
        >
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-accent-green bg-accent-green/10 text-accent-green'
                  : 'border-dark-border text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Upload zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragOver ? 'border-accent-green bg-accent-green/5' : 'border-dark-border'
          }`}
        >
          <Upload className="mx-auto h-10 w-10 text-gray-500" />
          <p className="mt-2 text-gray-300">
            Glissez-deposez vos justificatifs (PDF) : factures, releves TPE, bordereaux, courriers de subvention...
          </p>
          <p className="text-xs text-gray-500">
            L&apos;IA extrait automatiquement : type, source, montant HT/TTC, TVA, reference, lignes de detail
          </p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90">
            Parcourir les fichiers
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </label>
        </div>

        {/* Upload progress */}
        {uploadingFiles.length > 0 && (
          <div className="space-y-2">
            {uploadingFiles.map((uf, i) => (
              <div key={i} className="rounded-xl border border-dark-border bg-dark-card flex items-center gap-3 p-3">
                <FileText className="h-5 w-5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">{uf.file.name}</p>
                  <p
                    className={`text-xs ${
                      uf.status === 'error'
                        ? 'text-accent-red'
                        : uf.status === 'done'
                          ? 'text-accent-green'
                          : 'text-gray-500'
                    }`}
                  >
                    {uf.status === 'uploading' && 'Upload...'}
                    {uf.status === 'extracting' && 'Extraction IA en cours...'}
                    {uf.status === 'extracted' &&
                      `Extrait : ${uf.data?.entity_name || uf.data?.description || '-'} — ${fmt(uf.data?.amount_ttc || 0)}`}
                    {uf.status === 'saving' && 'Sauvegarde...'}
                    {uf.status === 'done' &&
                      `${uf.data?.source || ''} — ${uf.data?.entity_name || uf.data?.description || ''} — ${fmt(uf.data?.amount_ttc || 0)}`}
                    {uf.status === 'error' && uf.error}
                  </p>
                  {['uploading', 'extracting', 'saving'].includes(uf.status) && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-dark-input">
                      <div
                        className="h-full rounded-full bg-accent-green transition-all"
                        style={{ width: `${uf.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {uf.status === 'done' && <Check className="h-5 w-5 shrink-0 text-accent-green" />}
                {uf.status === 'error' && <AlertTriangle className="h-5 w-5 shrink-0 text-accent-red" />}
                {uf.status === 'extracting' && (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-accent-green" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Total encaissements
            </p>
            <p className="mt-2 text-2xl font-bold font-mono text-accent-green">{fmt(totalEncaissements)}</p>
            <p className="mt-1 text-xs text-gray-500">
              {entries.filter((e) => e.source !== 'subvention').length} encaissement(s)
            </p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-gray-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Billetterie / TPE
              </p>
            </div>
            <p className="mt-2 text-lg font-bold font-mono text-gray-200">{fmt(totalBilletterieTpe)}</p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Virements</p>
            </div>
            <p className="mt-2 text-lg font-bold font-mono text-gray-200">{fmt(totalVirements)}</p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-gray-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Subventions</p>
            </div>
            <p className="mt-2 text-lg font-bold font-mono text-yellow-400">{fmt(totalSubventions)}</p>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent-green" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-gray-500">
              <Coins className="mb-3 h-12 w-12 text-gray-600" />
              <p className="text-sm">Aucun encaissement pour cette periode</p>
              <p className="mt-1 text-xs text-gray-600">Deposez un PDF ci-dessus pour commencer</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border bg-dark-input/50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3 text-right">Montant HT</th>
                    <th className="px-4 py-3 text-right">TVA</th>
                    <th className="px-4 py-3 text-right">TTC</th>
                    <th className="px-4 py-3">Fichier</th>
                    <th className="px-4 py-3">Rapprochement</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => {
                    const src = SOURCE_MAP[entry.source]
                    return (
                      <React.Fragment key={entry.id}>
                        <tr className="border-b border-dark-border/50 hover:bg-dark-hover/30">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-200">
                            {formatDate(entry.date)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${src?.color || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}
                            >
                              {src && <src.icon className="h-3 w-3" />}
                              {src?.label || entry.source}
                            </span>
                          </td>
                          <td className="max-w-[200px] px-4 py-3 text-gray-300">
                            <div className="truncate">{entry.description || '-'}</div>
                            {entry.entity_name && (
                              <div className="truncate text-xs text-gray-500">{entry.entity_name}</div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">
                            {entry.reference || '-'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-gray-200">
                            {fmt(entry.amount_ht)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-gray-400">
                            {entry.tva_rate}%
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-gray-200">
                            {fmt(entry.amount_ttc)}
                          </td>
                          <td className="px-4 py-3">
                            {entry.file_name ? (
                              <span className="inline-flex items-center gap-1 text-xs text-accent-blue">
                                <Download className="h-3.5 w-3.5" />
                                <span className="max-w-[100px] truncate">{entry.file_name}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-gray-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {bankMatchedEntries[entry.id] ? (
                              <span className="flex items-center gap-1 rounded bg-accent-green/10 px-2 py-1 text-[10px] font-medium text-accent-green">
                                <CheckCircle className="h-3 w-3" /> Rapproche
                              </span>
                            ) : (
                              <button
                                onClick={() => openBankMatch(entry.id)}
                                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                  bankMatchEntryId === entry.id
                                    ? 'bg-accent-green/10 text-accent-green'
                                    : 'text-accent-green hover:bg-accent-green/10'
                                }`}
                              >
                                <Landmark className="h-3.5 w-3.5" />
                                Rapprocher
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="rounded p-1 text-gray-500 hover:bg-accent-red/10 hover:text-accent-red"
                              title="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>

                        {/* Bank matching panel */}
                        {bankMatchEntryId === entry.id && (
                          <tr>
                            <td colSpan={10} className="border-b border-dark-border/50 bg-dark-input/30 px-4 py-4">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                    Rapprochement bancaire — {entry.entity_name || entry.description}
                                  </h4>
                                  <button
                                    onClick={() => setBankMatchEntryId(null)}
                                    className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-200"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>

                                {bankSearching ? (
                                  <div className="flex h-16 items-center justify-center">
                                    <Loader2 className="h-5 w-5 animate-spin text-accent-green" />
                                  </div>
                                ) : (() => {
                                  const amounts = [entry.amount_ttc, entry.amount_ht].filter((a) => a > 0)
                                  const matchingTx = bankTransactions
                                    .filter((tx: any) => amounts.some((amt) => Math.abs(tx.amount - amt) <= 1))
                                    .sort((a: any, b: any) => {
                                      const aDist = Math.min(...amounts.map((amt) => Math.abs(a.amount - amt)))
                                      const bDist = Math.min(...amounts.map((amt) => Math.abs(b.amount - amt)))
                                      return aDist - bDist
                                    })
                                  const otherTx = bankTransactions.filter(
                                    (tx: any) => !amounts.some((amt) => Math.abs(tx.amount - amt) <= 1)
                                  )
                                  const allSorted = [...matchingTx, ...otherTx]
                                  const filteredTx = bankSearch
                                    ? allSorted.filter((tx: any) =>
                                        (tx.label || '').toLowerCase().includes(bankSearch.toLowerCase())
                                      )
                                    : allSorted

                                  return (
                                    <>
                                      <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <span>Montants recherches :</span>
                                        <span className="rounded bg-accent-green/10 px-1.5 py-0.5 font-mono text-accent-green">
                                          TTC {fmt(entry.amount_ttc)}
                                        </span>
                                        {entry.amount_ht !== entry.amount_ttc && (
                                          <span className="rounded bg-accent-blue/10 px-1.5 py-0.5 font-mono text-accent-blue">
                                            HT {fmt(entry.amount_ht)}
                                          </span>
                                        )}
                                      </div>

                                      <div className="relative">
                                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                                        <input
                                          type="text"
                                          value={bankSearch}
                                          onChange={(e) => setBankSearch(e.target.value)}
                                          placeholder="Rechercher par libelle..."
                                          className="w-full rounded-lg border border-dark-border bg-dark-input pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                                        />
                                      </div>

                                      <div className="max-h-48 space-y-1 overflow-y-auto">
                                        {filteredTx.length === 0 && (
                                          <p className="py-4 text-center text-sm text-gray-500">
                                            Aucune transaction non rapprochee.
                                          </p>
                                        )}
                                        {filteredTx.map((tx: any) => {
                                          const isAmountMatch = amounts.some(
                                            (amt) => Math.abs(tx.amount - amt) <= 1
                                          )
                                          const isSelected = selectedTxIds.includes(tx.id)
                                          return (
                                            <label
                                              key={tx.id}
                                              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-all hover:border-accent-green/50 ${
                                                isSelected
                                                  ? 'border-accent-green/50 bg-accent-green/5'
                                                  : isAmountMatch
                                                    ? 'border-accent-green/20 bg-accent-green/5'
                                                    : 'border-dark-border bg-dark-card'
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() =>
                                                  setSelectedTxIds((prev) =>
                                                    prev.includes(tx.id)
                                                      ? prev.filter((id) => id !== tx.id)
                                                      : [...prev, tx.id]
                                                  )
                                                }
                                                className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green/50"
                                              />
                                              <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm text-gray-200">{tx.label}</p>
                                                <p className="font-mono text-xs text-gray-500">
                                                  {tx.date
                                                    ? new Date(tx.date).toLocaleDateString('fr-FR')
                                                    : '-'}
                                                </p>
                                              </div>
                                              <div className="shrink-0 text-right">
                                                <span
                                                  className={`font-mono text-sm font-medium ${
                                                    tx.type === 'debit'
                                                      ? 'text-accent-red'
                                                      : 'text-accent-green'
                                                  }`}
                                                >
                                                  {tx.amount.toLocaleString('fr-FR', {
                                                    minimumFractionDigits: 2,
                                                  }) + ' \u20AC'}
                                                </span>
                                                {isAmountMatch && (
                                                  <span className="ml-2 rounded bg-accent-green/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
                                                    MATCH
                                                  </span>
                                                )}
                                              </div>
                                            </label>
                                          )
                                        })}
                                      </div>

                                      {selectedTxIds.length > 0 && (
                                        <div className="flex items-center justify-end gap-2">
                                          <span className="text-xs text-gray-500">
                                            {selectedTxIds.length} transaction(s) selectionnee(s)
                                          </span>
                                          <button
                                            onClick={() => handleBankMatch(entry.id)}
                                            disabled={bankMatching}
                                            className="flex items-center gap-1.5 rounded-lg bg-accent-green px-3 py-1.5 text-xs font-semibold text-dark-bg transition-colors hover:bg-accent-green/90 disabled:opacity-50"
                                          >
                                            {bankMatching ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <Check className="h-3 w-3" />
                                            )}
                                            Confirmer le rapprochement
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )
                                })()}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}

                  {/* Total row */}
                  <tr className="border-t-2 border-dark-border bg-dark-input/30 font-bold">
                    <td className="px-4 py-3 text-gray-300" colSpan={4}>
                      TOTAL ({filtered.length} encaissement{filtered.length !== 1 ? 's' : ''})
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-200">
                      {fmt(filtered.reduce((s, e) => s + e.amount_ht, 0))}
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right font-mono text-accent-green">
                      {fmt(filtered.reduce((s, e) => s + e.amount_ttc, 0))}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
