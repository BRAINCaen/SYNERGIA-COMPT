'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import {
  Coins,
  Plus,
  Check,
  Trash2,
  Pencil,
  Upload,
  FileText,
  Download,
  CreditCard,
  Banknote,
  Building2,
  Receipt,
  Loader2,
  X,
} from 'lucide-react'
import type { RevenueEntry, RevenueSource, RevenueStatus } from '@/types'

// ── Revenue sources ─────────────────────────────────
const SOURCES: { key: RevenueSource; label: string; color: string; icon: React.ElementType }[] = [
  { key: 'tpe_virtuel', label: 'TPE Virtuel', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: CreditCard },
  { key: 'virement', label: 'Virement', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: Building2 },
  { key: 'tpe_sur_place', label: 'TPE Sur place', color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', icon: CreditCard },
  { key: 'cheque', label: 'Cheque', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: FileText },
  { key: 'ancv', label: 'ANCV', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: Receipt },
  { key: 'especes', label: 'Especes', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: Banknote },
]

const SOURCE_MAP = Object.fromEntries(SOURCES.map((s) => [s.key, s]))

// ── PCG revenue accounts ────────────────────────────
const PCG_ACCOUNTS = [
  { code: '70610000', label: 'Ventes escape game' },
  { code: '70620000', label: 'Ventes quiz game' },
  { code: '70630000', label: 'Ventes team building' },
  { code: '70640000', label: 'Ventes bons cadeaux' },
  { code: '70710000', label: 'Ventes marchandises' },
  { code: '70800000', label: 'Produits annexes' },
  { code: '74100000', label: "Subventions d'exploitation" },
]

const TVA_RATES = [0, 5.5, 10, 20]

const STATUS_STYLES: Record<RevenueStatus, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  validated: 'bg-green-500/20 text-green-400 border-green-500/30',
  exported: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}
const STATUS_LABELS: Record<RevenueStatus, string> = {
  draft: 'Brouillon',
  validated: 'Valide',
  exported: 'Exporte',
}

// ── Helpers ──────────────────────────────────────────
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function generateMonths(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function formatAmount(amount: number | null): string {
  if (amount == null) return '-'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

// ── Form defaults ───────────────────────────────────
interface FormData {
  date: string
  source: RevenueSource
  description: string
  amount_ht: string
  tva_rate: number
  pcg_code: string
  file: File | null
}

const emptyForm: FormData = {
  date: new Date().toISOString().slice(0, 10),
  source: 'tpe_virtuel',
  description: '',
  amount_ht: '',
  tva_rate: 20,
  pcg_code: '70610000',
  file: null,
}

// ── Component ───────────────────────────────────────
export default function RevenueClient() {
  const authFetch = useAuthFetch()
  const [entries, setEntries] = useState<RevenueEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth)
  const [sourceFilter, setSourceFilter] = useState<RevenueSource | 'all'>('all')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [saving, setSaving] = useState(false)

  // Fetch entries whenever month changes
  useEffect(() => {
    fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  const fetchEntries = async () => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/revenue?month=${month}`)
      if (res.ok) {
        const data = await res.json()
        setEntries(data)
      }
    } catch (e) {
      console.error('Fetch revenue error:', e)
    }
    setLoading(false)
  }

  // Computed TTC
  const computedTTC = useMemo(() => {
    const ht = parseFloat(form.amount_ht) || 0
    return ht * (1 + form.tva_rate / 100)
  }, [form.amount_ht, form.tva_rate])

  // Filtered entries
  const filtered = useMemo(() => {
    if (sourceFilter === 'all') return entries
    return entries.filter((e) => e.source === sourceFilter)
  }, [entries, sourceFilter])

  // Summary
  const totalMonth = useMemo(() => entries.reduce((sum, e) => sum + e.amount_ttc, 0), [entries])
  const bySource = useMemo(() => {
    const map: Record<string, number> = {}
    entries.forEach((e) => {
      map[e.source] = (map[e.source] || 0) + e.amount_ttc
    })
    return map
  }, [entries])

  // ── Form handlers ─────────────────────────────────
  const openAdd = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (entry: RevenueEntry) => {
    setEditingId(entry.id)
    setForm({
      date: entry.date.slice(0, 10),
      source: entry.source,
      description: entry.description,
      amount_ht: String(entry.amount_ht),
      tva_rate: entry.tva_rate,
      pcg_code: entry.pcg_code,
      file: null,
    })
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const ht = parseFloat(form.amount_ht) || 0
      const tvaAmount = ht * (form.tva_rate / 100)
      const ttc = ht + tvaAmount
      const pcg = PCG_ACCOUNTS.find((a) => a.code === form.pcg_code)

      const body = new FormData()
      body.append('date', form.date)
      body.append('source', form.source)
      body.append('description', form.description)
      body.append('amount_ht', String(ht))
      body.append('tva_rate', String(form.tva_rate))
      body.append('tva_amount', String(tvaAmount))
      body.append('amount_ttc', String(ttc))
      body.append('pcg_code', form.pcg_code)
      body.append('pcg_label', pcg?.label || '')
      body.append('journal_code', 'VE')
      if (form.file) body.append('file', form.file)

      const url = editingId ? `/api/revenue/${editingId}` : '/api/revenue'
      const method = editingId ? 'PUT' : 'POST'

      const res = await authFetch(url, { method, body })
      if (res.ok) {
        closeForm()
        await fetchEntries()
      }
    } catch (e) {
      console.error('Save revenue error:', e)
    }
    setSaving(false)
  }

  const handleValidate = async (id: string) => {
    try {
      const res = await authFetch(`/api/revenue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'validated' }),
      })
      if (res.ok) await fetchEntries()
    } catch (e) {
      console.error('Validate revenue error:', e)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette recette ?')) return
    try {
      const res = await authFetch(`/api/revenue/${id}`, { method: 'DELETE' })
      if (res.ok) await fetchEntries()
    } catch (e) {
      console.error('Delete revenue error:', e)
    }
  }

  // ── Render ────────────────────────────────────────
  return (
    <AppLayout>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-green/10">
            <Coins className="h-5 w-5 text-accent-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Recettes</h1>
            <p className="text-sm text-gray-500">Suivi des recettes mensuelles</p>
          </div>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Ajouter une recette
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
        >
          {generateMonths().map((m) => (
            <option key={m} value={m}>
              {new Date(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSourceFilter('all')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              sourceFilter === 'all'
                ? 'border-accent-green bg-accent-green/10 text-accent-green'
                : 'border-dark-border text-gray-400 hover:border-gray-500 hover:text-gray-300'
            }`}
          >
            Tous
          </button>
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSourceFilter(s.key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                sourceFilter === s.key
                  ? `border ${s.color}`
                  : 'border-dark-border text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-dark-border bg-dark-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total recettes du mois</p>
          <p className="mt-2 text-2xl font-bold font-mono text-accent-green">{formatAmount(totalMonth)}</p>
          <p className="mt-1 text-xs text-gray-500">{entries.length} entree{entries.length !== 1 ? 's' : ''}</p>
        </div>
        {SOURCES.filter((s) => bySource[s.key]).map((s) => (
          <div key={s.key} className="rounded-xl border border-dark-border bg-dark-card p-4">
            <div className="flex items-center gap-2">
              <s.icon className="h-4 w-4 text-gray-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{s.label}</p>
            </div>
            <p className="mt-2 text-lg font-bold font-mono text-gray-200">{formatAmount(bySource[s.key])}</p>
          </div>
        ))}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="rounded-xl border border-dark-border bg-dark-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">
              {editingId ? 'Modifier la recette' : 'Nouvelle recette'}
            </h2>
            <button onClick={closeForm} className="text-gray-500 hover:text-gray-300">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Date */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
              />
            </div>

            {/* Source */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Source</label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value as RevenueSource })}
                className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
              >
                {SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ex: Escape game groupe 6 pers."
                className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
              />
            </div>

            {/* Amount HT */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Montant HT</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount_ht}
                onChange={(e) => setForm({ ...form, amount_ht: e.target.value })}
                placeholder="0.00"
                className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
              />
            </div>

            {/* TVA Rate */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Taux TVA</label>
              <select
                value={form.tva_rate}
                onChange={(e) => setForm({ ...form, tva_rate: parseFloat(e.target.value) })}
                className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
              >
                {TVA_RATES.map((r) => (
                  <option key={r} value={r}>{r}%</option>
                ))}
              </select>
            </div>

            {/* Amount TTC (auto) */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Montant TTC</label>
              <div className="flex h-[38px] items-center rounded-lg border border-dark-border bg-dark-input/50 px-3 text-sm font-mono text-accent-green">
                {formatAmount(computedTTC)}
              </div>
            </div>

            {/* PCG Account */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-400">Compte PCG</label>
              <select
                value={form.pcg_code}
                onChange={(e) => setForm({ ...form, pcg_code: e.target.value })}
                className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
              >
                {PCG_ACCOUNTS.map((a) => (
                  <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
                ))}
              </select>
            </div>

            {/* File upload */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">Justificatif (optionnel)</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-400 transition-colors hover:border-gray-500">
                <Upload className="h-4 w-4" />
                {form.file ? form.file.name : 'Choisir un fichier'}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
                />
              </label>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !form.description || !form.amount_ht}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editingId ? 'Mettre a jour' : 'Enregistrer'}
            </button>
            <button onClick={closeForm} className="btn-secondary">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Revenue table */}
      <div className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <Coins className="mb-3 h-12 w-12 text-gray-600" />
            <p className="text-sm">Aucune recette pour cette periode</p>
            <button onClick={openAdd} className="mt-3 text-sm text-accent-green hover:underline">
              Ajouter une recette
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">HT</th>
                  <th className="px-4 py-3 text-right">TTC</th>
                  <th className="px-4 py-3">Compte PCG</th>
                  <th className="px-4 py-3">Justificatif</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border">
                {filtered.map((entry) => {
                  const src = SOURCE_MAP[entry.source]
                  return (
                    <tr key={entry.id} className="transition-colors hover:bg-dark-hover">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-200">
                        {formatDate(entry.date)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${src?.color || ''}`}>
                          {src && <src.icon className="h-3 w-3" />}
                          {src?.label || entry.source}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-gray-300">
                        {entry.description}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-gray-200">
                        {formatAmount(entry.amount_ht)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-gray-200">
                        {formatAmount(entry.amount_ttc)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-400">
                        <span className="font-mono text-xs">{entry.pcg_code}</span>
                        <span className="ml-1.5 text-xs text-gray-500">{entry.pcg_label}</span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.supporting_doc_path ? (
                          <a
                            href={entry.supporting_doc_path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {entry.supporting_doc_name || 'Telecharger'}
                          </a>
                        ) : (
                          <span className="text-xs text-accent-orange">Manquant</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[entry.status]}`}>
                          {STATUS_LABELS[entry.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {entry.status === 'draft' && (
                            <>
                              <button
                                onClick={() => openEdit(entry)}
                                title="Modifier"
                                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-dark-hover hover:text-gray-300"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleValidate(entry.id)}
                                title="Valider"
                                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-accent-green/10 hover:text-accent-green"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(entry.id)}
                                title="Supprimer"
                                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-accent-red/10 hover:text-accent-red"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {entry.status === 'validated' && (
                            <span className="text-xs text-gray-500">Valide</span>
                          )}
                          {entry.status === 'exported' && (
                            <span className="text-xs text-gray-500">Exporte</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </AppLayout>
  )
}
