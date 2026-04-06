'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import { convertToEur } from '@/lib/currency'
import { StatusBadge } from '@/components/ui/Badge'
import { FileText, Search, Filter, ChevronDown, ChevronRight, Calendar, Trash2, X, CheckSquare, Landmark, RefreshCw, Loader2 } from 'lucide-react'
import type { Invoice, InvoiceStatus } from '@/types'

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: 'pending', label: 'En attente' },
  { value: 'processing', label: 'Traitement' },
  { value: 'classified', label: 'Classifié' },
  { value: 'validated', label: 'Validé' },
  { value: 'exported', label: 'Exporté' },
  { value: 'error', label: 'Erreur' },
]

export default function InvoiceList() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null) // null = bulk, string = single id
  const [bulkStatusValue, setBulkStatusValue] = useState<InvoiceStatus | ''>('')
  const [actionLoading, setActionLoading] = useState(false)
  const [matchedInvoiceIds, setMatchedInvoiceIds] = useState<Set<string>>(new Set())
  const [rescanningIds, setRescanningIds] = useState<Set<string>>(new Set())
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameResult, setRenameResult] = useState<string | null>(null)
  const [batchScanning, setBatchScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const [deduplicating, setDeduplicating] = useState(false)
  const [dedupeResult, setDedupeResult] = useState<string | null>(null)
  const { user } = useAuth()
  const authFetch = useAuthFetch()

  const rescanInvoice = async (invoiceId: string) => {
    setRescanningIds(prev => new Set(prev).add(invoiceId))
    try {
      // Get invoice to get file_path
      const invRes = await authFetch(`/api/invoices/${invoiceId}`)
      if (!invRes.ok) throw new Error('Facture non trouvée')
      const invData = await invRes.json()

      if (!invData.file_url && !invData.file_path) {
        throw new Error('Pas de fichier associé')
      }

      // Download the PDF via proxy
      const pdfRes = await authFetch(`/api/proxy-pdf?path=${encodeURIComponent(invData.file_path)}`)
      if (!pdfRes.ok) throw new Error('Téléchargement échoué')
      const pdfBlob = await pdfRes.blob()

      // Send to extract
      const extractForm = new FormData()
      extractForm.append('file', new File([pdfBlob], invData.file_name || 'document.pdf', { type: 'application/pdf' }))
      const extractRes = await authFetch('/api/invoices/extract', { method: 'POST', body: extractForm })
      if (!extractRes.ok) throw new Error('Erreur extraction')
      const { data: extraction } = await extractRes.json()

      // Update invoice with extracted data
      const newFileName = extraction.supplier?.name && extraction.totals?.total_ttc
        ? `${extraction.supplier.name.toUpperCase()}-${extraction.totals.total_ttc.toFixed(2).replace('.', ',')}€.pdf`
        : invData.file_name

      // Currency conversion if not EUR
      const currency = extraction.invoice?.currency || 'EUR'
      let totalTtcEur = null
      let totalHtEur = null
      let exchangeRate = null
      if (currency !== 'EUR' && extraction.totals?.total_ttc && extraction.invoice?.date) {
        const converted = await convertToEur(extraction.totals.total_ttc, currency, extraction.invoice.date)
        if (converted) {
          totalTtcEur = converted.amountEur
          exchangeRate = converted.rate
          if (extraction.totals?.total_ht) totalHtEur = Math.round(extraction.totals.total_ht * converted.rate * 100) / 100
        }
      }

      await authFetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: newFileName,
          document_type: extraction.document_type || 'expense',
          is_credit_note: extraction.is_credit_note || false,
          supplier_name: extraction.supplier?.name,
          supplier_siret: extraction.supplier?.siret || null,
          invoice_number: extraction.invoice?.number || null,
          invoice_date: extraction.invoice?.date || null,
          due_date: extraction.invoice?.due_date || null,
          currency,
          total_ht: extraction.totals?.total_ht || null,
          total_tva: extraction.totals?.total_tva || null,
          total_ttc: extraction.totals?.total_ttc || null,
          total_ht_eur: totalHtEur,
          total_ttc_eur: totalTtcEur,
          exchange_rate: exchangeRate,
          raw_extraction: extraction,
          status: 'processing',
        }),
      })

      // Now classify
      const classifyRes = await authFetch('/api/invoices/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: extraction.lines || [],
          supplier_name: extraction.supplier?.name || 'Inconnu',
        }),
      })

      if (classifyRes.ok) {
        const classifyData = await classifyRes.json()
        if (classifyData.classifications) {
          const lines = (extraction.lines || []).map((line: any, i: number) => {
            const c = classifyData.classifications?.find((cl: any) => cl.line_index === i)
            return {
              description: line.description || '',
              quantity: line.quantity || 1,
              unit_price: line.unit_price || line.total_ht,
              total_ht: line.total_ht || 0,
              tva_rate: line.tva_rate || null,
              tva_amount: line.tva_amount || null,
              total_ttc: line.total_ttc || null,
              pcg_code: c?.pcg_code || null,
              pcg_label: c?.pcg_label || null,
              confidence_score: c?.confidence || null,
              manually_corrected: false,
              journal_code: c?.journal_code || 'AC',
              reasoning: c?.reasoning || null,
              is_immobilization: c?.is_immobilization || false,
              amortization_rate: c?.amortization_rate || null,
              classification_method: c?.classification_method || 'ai',
            }
          })

          // Save lines to Firestore
          if (lines.length > 0) {
            await authFetch(`/api/invoices/${invoiceId}/lines`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lines }),
            })
          }

          await authFetch(`/api/invoices/${invoiceId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'classified' }),
          })
        }
      }

      fetchInvoices()
    } catch (e) {
      console.error('Rescan error:', e)
    }
    setRescanningIds(prev => { const next = new Set(prev); next.delete(invoiceId); return next })
  }

  useEffect(() => {
    if (user) fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter])

  // Load matched IDs separately (non-blocking)
  useEffect(() => {
    if (!user) return
    const loadMatched = async () => {
      try {
        const res = await authFetch('/api/bank-statements/transactions?match_status=matched')
        if (res.ok) {
          const data = await res.json()
          const txs = data.transactions || data || []
          const ids = new Set<string>(txs.map((tx: any) => tx.matched_invoice_id).filter(Boolean))
          setMatchedInvoiceIds(ids)
        }
      } catch { /* non-blocking */ }
    }
    loadMatched()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const url = statusFilter === 'all'
        ? '/api/invoices'
        : `/api/invoices?status=${statusFilter}`
      const res = await authFetch(url)
      if (res.ok) {
        const data = await res.json()
        setInvoices(data)
      }
    } catch (e) {
      console.error('Fetch invoices error:', e)
    }
    setLoading(false)
  }

  // Filter by search
  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      // Search filter
      if (search) {
        const q = search.toLowerCase()
        const matches = inv.file_name.toLowerCase().includes(q) ||
          inv.supplier_name?.toLowerCase().includes(q) ||
          inv.invoice_number?.toLowerCase().includes(q)
        if (!matches) return false
      }
      // Unmatched only filter
      if (showUnmatchedOnly) {
        if (matchedInvoiceIds.has(inv.id)) return false
      }
      return true
    })
  }, [invoices, search, showUnmatchedOnly, matchedInvoiceIds])

  // Get available years
  const years = useMemo(() => {
    const yearSet = new Set<number>()
    filtered.forEach((inv) => {
      const date = inv.invoice_date || inv.created_at
      if (date) {
        yearSet.add(new Date(date).getFullYear())
      }
    })
    return Array.from(yearSet).sort((a, b) => b - a)
  }, [filtered])

  // Auto-select current year or most recent
  useEffect(() => {
    if (years.length > 0 && selectedYear === null) {
      const currentYear = new Date().getFullYear()
      setSelectedYear(years.includes(currentYear) ? currentYear : years[0])
    }
  }, [years, selectedYear])

  // Group invoices by month for selected year
  const invoicesByMonth = useMemo(() => {
    const grouped: Record<number, Invoice[]> = {}
    filtered.forEach((inv) => {
      const date = inv.invoice_date || inv.created_at
      if (!date) return
      const d = new Date(date)
      if (d.getFullYear() !== selectedYear) return
      const month = d.getMonth()
      if (!grouped[month]) grouped[month] = []
      grouped[month].push(inv)
    })
    Object.values(grouped).forEach(monthInvoices => {
      monthInvoices.sort((a, b) => {
        const da = new Date(a.invoice_date || a.created_at).getTime()
        const db = new Date(b.invoice_date || b.created_at).getTime()
        return db - da
      })
    })
    return grouped
  }, [filtered, selectedYear])

  // Available months (sorted descending)
  const months = useMemo(() => {
    return Object.keys(invoicesByMonth)
      .map(Number)
      .sort((a, b) => b - a)
  }, [invoicesByMonth])

  // Auto-expand current month
  useEffect(() => {
    const currentMonth = new Date().getMonth()
    if (months.includes(currentMonth)) {
      setExpandedMonths(new Set([currentMonth]))
    } else if (months.length > 0) {
      setExpandedMonths(new Set([months[0]]))
    }
  }, [selectedYear, months])

  // All visible invoice IDs (for select all)
  const allVisibleIds = useMemo(() => {
    if (search.length > 0) return filtered.map((inv) => inv.id)
    const ids: string[] = []
    months.forEach((month) => {
      if (expandedMonths.has(month)) {
        (invoicesByMonth[month] || []).forEach((inv) => ids.push(inv.id))
      }
    })
    return ids
  }, [filtered, search, months, expandedMonths, invoicesByMonth])

  const toggleMonth = (month: number) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(month)) {
        next.delete(month)
      } else {
        next.add(month)
      }
      return next
    })
  }

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('fr-FR')
  }

  const formatAmount = (amount: number | null) => {
    if (amount == null) return '-'
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
  }

  const getMonthTotal = (monthInvoices: Invoice[]) => {
    const total = monthInvoices.reduce((sum, inv) => sum + (inv.total_ttc || 0), 0)
    return formatAmount(total)
  }

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = allVisibleIds.every((id) => prev.has(id))
      if (allSelected) {
        return new Set()
      }
      return new Set(allVisibleIds)
    })
  }, [allVisibleIds])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Delete handlers
  const confirmDelete = (id?: string) => {
    setDeleteTarget(id || null)
    setShowDeleteConfirm(true)
  }

  const cancelDelete = () => {
    setShowDeleteConfirm(false)
    setDeleteTarget(null)
  }

  const executeDelete = async () => {
    setActionLoading(true)
    try {
      if (deleteTarget) {
        // Single delete
        const res = await authFetch(`/api/invoices/${deleteTarget}`, { method: 'DELETE' })
        if (res.ok) {
          setInvoices((prev) => prev.filter((inv) => inv.id !== deleteTarget))
          setSelectedIds((prev) => {
            const next = new Set(prev)
            next.delete(deleteTarget)
            return next
          })
        }
      } else {
        // Bulk delete
        const ids = Array.from(selectedIds)
        const res = await authFetch('/api/invoices/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', invoice_ids: ids }),
        })
        if (res.ok) {
          setInvoices((prev) => prev.filter((inv) => !selectedIds.has(inv.id)))
          setSelectedIds(new Set())
        }
      }
    } catch (e) {
      console.error('Delete error:', e)
    }
    setActionLoading(false)
    setShowDeleteConfirm(false)
    setDeleteTarget(null)
  }

  // Bulk status change
  const executeBulkStatusChange = async (status: InvoiceStatus) => {
    if (selectedIds.size === 0) return
    setActionLoading(true)
    try {
      const ids = Array.from(selectedIds)
      const res = await authFetch('/api/invoices/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_status', invoice_ids: ids, status }),
      })
      if (res.ok) {
        setInvoices((prev) =>
          prev.map((inv) => (selectedIds.has(inv.id) ? { ...inv, status } : inv))
        )
        setSelectedIds(new Set())
        setBulkStatusValue('')
      }
    } catch (e) {
      console.error('Bulk status change error:', e)
    }
    setActionLoading(false)
  }

  const isSearching = search.length > 0
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id))

  return (
    <div className="space-y-4">
      {/* Search + Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par fournisseur, fichier, n° facture..."
            className="input-field pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
            className="input-field w-auto"
          >
            <option value="all">Tous les statuts</option>
            <option value="pending">En attente</option>
            <option value="processing">Traitement</option>
            <option value="classified">Classifié</option>
            <option value="validated">Validé</option>
            <option value="exported">Exporté</option>
            <option value="error">Erreur</option>
          </select>
          <label className="flex items-center gap-2 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={showUnmatchedOnly}
              onChange={() => setShowUnmatchedOnly(!showUnmatchedOnly)}
              className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-orange focus:ring-accent-orange/50"
            />
            <span className="text-xs text-gray-400">Non rapprochees</span>
            <Landmark className="h-3.5 w-3.5 text-accent-orange" />
          </label>
          <button
            onClick={async () => {
              setRenaming(true)
              setRenameResult(null)
              try {
                const res = await authFetch('/api/invoices/batch-rename', { method: 'POST' })
                if (res.ok) {
                  const data = await res.json()
                  const msg = data.renamed > 0
                    ? `${data.renamed} renommee(s) sur ${data.total}`
                    : `0 renommee (${data.noData || 0} sans donnees, ${data.skipped || 0} deja ok)`
                  setRenameResult(msg)
                  if (data.renamed > 0) fetchInvoices()
                } else {
                  const err = await res.json().catch(() => ({ error: res.status }))
                  setRenameResult(`Erreur: ${err.error}`)
                }
              } catch { setRenameResult('Erreur') }
              setRenaming(false)
            }}
            disabled={renaming}
            className="flex items-center gap-1.5 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-gray-400 hover:border-accent-green/50 hover:text-accent-green transition-colors disabled:opacity-50"
            title="Renommer toutes les factures au format FOURNISSEUR-MONTANT-DATE"
          >
            {renaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Renommer tout
          </button>
          <button
            onClick={async () => {
              setBatchScanning(true)
              setScanProgress('Demarrage...')
              const pendingInvoices = invoices.filter((inv) =>
                (inv.status === 'pending' || inv.status === 'error') && !inv.supplier_name
              )
              if (pendingInvoices.length === 0) {
                setScanProgress('Aucune facture en attente a scanner')
                setBatchScanning(false)
                return
              }
              let done = 0
              let errors = 0
              for (const inv of pendingInvoices) {
                setScanProgress(`Scan ${done + 1}/${pendingInvoices.length}...`)
                try {
                  await rescanInvoice(inv.id)
                  done++
                } catch {
                  errors++
                }
                // Delay to avoid rate limits
                if (done < pendingInvoices.length) {
                  await new Promise((r) => setTimeout(r, 3000))
                }
              }
              setScanProgress(`${done} scannee(s)${errors > 0 ? `, ${errors} erreur(s)` : ''}`)
              fetchInvoices()
              // Auto-rename after scan
              try {
                await authFetch('/api/invoices/batch-rename', { method: 'POST' })
                fetchInvoices()
              } catch {}
              setBatchScanning(false)
            }}
            disabled={batchScanning || renaming}
            className="flex items-center gap-1.5 rounded-lg border border-accent-orange/50 px-3 py-1.5 text-xs text-accent-orange hover:bg-accent-orange/10 transition-colors disabled:opacity-50"
            title="Scanner toutes les factures en attente avec l'IA"
          >
            {batchScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Scanner en attente
          </button>
          <button
            onClick={async () => {
              if (!confirm('Supprimer les factures en double (meme fournisseur + montant + numero) ?')) return
              setDeduplicating(true)
              setDedupeResult(null)
              try {
                const res = await authFetch('/api/invoices/deduplicate', { method: 'POST' })
                if (res.ok) {
                  const data = await res.json()
                  setDedupeResult(data.deleted > 0 ? `${data.deleted} doublon(s) supprime(s)` : 'Aucun doublon')
                  if (data.deleted > 0) fetchInvoices()
                }
              } catch { setDedupeResult('Erreur') }
              setDeduplicating(false)
            }}
            disabled={deduplicating || batchScanning}
            className="flex items-center gap-1.5 rounded-lg border border-accent-red/50 px-3 py-1.5 text-xs text-accent-red hover:bg-accent-red/10 transition-colors disabled:opacity-50"
            title="Supprimer les factures en double"
          >
            {deduplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Doublons
          </button>
          {renameResult && (
            <span className="text-xs text-accent-green">{renameResult}</span>
          )}
          {scanProgress && (
            <span className="text-xs text-accent-orange">{scanProgress}</span>
          )}
          {dedupeResult && (
            <span className="text-xs text-accent-red">{dedupeResult}</span>
          )}
        </div>
      </div>

      {/* Floating action bar when items selected */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 flex items-center gap-3 rounded-xl border border-accent-green/30 bg-accent-green/10 px-4 py-3 shadow-lg">
          <CheckSquare className="h-5 w-5 text-accent-green" />
          <span className="text-sm font-semibold text-accent-green">
            {selectedIds.size} facture{selectedIds.size > 1 ? 's' : ''} sélectionnée{selectedIds.size > 1 ? 's' : ''}
          </span>
          <div className="mx-2 h-5 w-px bg-primary-200" />
          <button
            onClick={async () => {
              const ids = Array.from(selectedIds)
              setBatchScanning(true)
              setScanProgress('Demarrage rescan...')
              let done = 0
              let errors = 0
              for (const id of ids) {
                setScanProgress(`Rescan ${done + 1}/${ids.length}...`)
                try {
                  await rescanInvoice(id)
                  done++
                } catch { errors++ }
                if (done + errors < ids.length) {
                  await new Promise((r) => setTimeout(r, 3000))
                }
              }
              setScanProgress(`${done} rescannee(s)${errors > 0 ? `, ${errors} erreur(s)` : ''}`)
              // Auto-rename after rescan
              try {
                await authFetch('/api/invoices/batch-rename', { method: 'POST' })
              } catch {}
              fetchInvoices()
              setSelectedIds(new Set())
              setBatchScanning(false)
            }}
            disabled={batchScanning || actionLoading}
            className="flex items-center gap-1.5 rounded-lg bg-accent-orange px-3 py-1.5 text-sm font-medium text-dark-bg hover:bg-accent-orange/90 transition-colors disabled:opacity-50"
          >
            {batchScanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Rescanner ({selectedIds.size})
          </button>
          <button
            onClick={() => confirmDelete()}
            disabled={actionLoading}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Supprimer
          </button>
          <div className="flex items-center gap-2">
            <select
              value={bulkStatusValue}
              onChange={(e) => setBulkStatusValue(e.target.value as InvoiceStatus | '')}
              disabled={actionLoading}
              className="input-field w-auto text-sm py-1.5"
            >
              <option value="">Changer le statut...</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {bulkStatusValue && (
              <button
                onClick={() => executeBulkStatusChange(bulkStatusValue as InvoiceStatus)}
                disabled={actionLoading}
                className="flex items-center gap-1.5 rounded-lg bg-accent-green px-4 py-1.5 text-sm font-bold text-dark-bg hover:bg-accent-green/90 transition-colors disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckSquare className="h-3.5 w-3.5" />
                )}
                Appliquer
              </button>
            )}
          </div>
          <div className="flex-1" />
          <button
            onClick={clearSelection}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-accent-green hover:bg-accent-green/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Désélectionner
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        </div>
      ) : isSearching ? (
        /* Flat search results */
        <div className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-gray-500">
              <Search className="mb-3 h-12 w-12 text-gray-300" />
              <p className="text-sm">Aucun résultat pour &quot;{search}&quot;</p>
            </div>
          ) : (
            <>
              <div className="border-b border-dark-border bg-dark-input px-4 py-2">
                <p className="text-xs text-gray-500">{filtered.length} résultat{filtered.length > 1 ? 's' : ''}</p>
              </div>
              <InvoiceTable
                invoices={filtered}
                formatDate={formatDate}
                formatAmount={formatAmount}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                allSelected={allVisibleSelected}
                onDeleteSingle={confirmDelete}
                matchedInvoiceIds={matchedInvoiceIds}
                onRescan={rescanInvoice}
                rescanningIds={rescanningIds}
              />
            </>
          )}
        </div>
      ) : (
        /* Year/Month view */
        <div className="space-y-4">
          {/* Year buttons */}
          {years.length > 0 && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              {years.map((year) => (
                <button
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    selectedYear === year
                      ? 'bg-accent-green text-dark-bg shadow-sm'
                      : 'bg-dark-card text-gray-300 border border-dark-border hover:bg-dark-hover'
                  }`}
                >
                  {year}
                </button>
              ))}
            </div>
          )}

          {/* Months accordion */}
          {months.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dark-border bg-dark-card p-12 text-gray-500">
              <FileText className="mb-3 h-12 w-12 text-gray-300" />
              <p className="text-sm">Aucune facture pour {selectedYear}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {months.map((month) => {
                const monthInvoices = invoicesByMonth[month] || []
                const isExpanded = expandedMonths.has(month)
                const validatedCount = monthInvoices.filter(i => i.status === 'validated' || i.status === 'exported').length

                return (
                  <div key={month} className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
                    {/* Month header */}
                    <button
                      onClick={() => toggleMonth(month)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-dark-hover transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        )}
                        <span className="text-sm font-semibold text-gray-200">{MONTH_NAMES[month]}</span>
                        <span className="rounded-full bg-dark-border px-2 py-0.5 text-xs font-medium text-gray-400">
                          {monthInvoices.length} facture{monthInvoices.length > 1 ? 's' : ''}
                        </span>
                        {validatedCount > 0 && (
                          <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-xs font-medium text-accent-green">
                            {validatedCount} validée{validatedCount > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-gray-400">{getMonthTotal(monthInvoices)}</span>
                    </button>

                    {/* Month invoices */}
                    {isExpanded && (
                      <InvoiceTable
                        invoices={monthInvoices}
                        formatDate={formatDate}
                        formatAmount={formatAmount}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                        onToggleSelectAll={() => {
                          const monthIds = monthInvoices.map((inv) => inv.id)
                          setSelectedIds((prev) => {
                            const allMonthSelected = monthIds.every((id) => prev.has(id))
                            const next = new Set(prev)
                            if (allMonthSelected) {
                              monthIds.forEach((id) => next.delete(id))
                            } else {
                              monthIds.forEach((id) => next.add(id))
                            }
                            return next
                          })
                        }}
                        allSelected={monthInvoices.every((inv) => selectedIds.has(inv.id))}
                        onDeleteSingle={confirmDelete}
                        matchedInvoiceIds={matchedInvoiceIds}
                        onRescan={rescanInvoice}
                        rescanningIds={rescanningIds}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={cancelDelete}>
          <div
            className="w-full max-w-md rounded-2xl bg-dark-card border border-dark-border p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-red/10">
                <Trash2 className="h-5 w-5 text-accent-red" />
              </div>
              <h3 className="text-lg font-semibold text-gray-200">Confirmer la suppression</h3>
            </div>
            <p className="text-sm text-gray-400 mb-6">
              {deleteTarget
                ? 'Voulez-vous vraiment supprimer cette facture ? Cette action est irréversible.'
                : `Voulez-vous vraiment supprimer ${selectedIds.size} facture${selectedIds.size > 1 ? 's' : ''} ? Cette action est irréversible.`}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={cancelDelete}
                disabled={actionLoading}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={executeDelete}
                disabled={actionLoading}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionLoading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InvoiceTable({
  invoices,
  formatDate,
  formatAmount,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  onDeleteSingle,
  matchedInvoiceIds,
  onRescan,
  rescanningIds,
}: {
  invoices: Invoice[]
  formatDate: (d: string | null) => string
  formatAmount: (a: number | null) => string
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  allSelected: boolean
  onDeleteSingle: (id: string) => void
  matchedInvoiceIds: Set<string>
  onRescan: (id: string) => void
  rescanningIds: Set<string>
}) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-dark-border bg-dark-input">
          <th className="w-10 px-3 py-2">
            <input
              type="checkbox"
              checked={allSelected && invoices.length > 0}
              onChange={onToggleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-accent-green focus:ring-primary-500 cursor-pointer"
            />
          </th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fichier</th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fournisseur</th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">N° Facture</th>
          <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Date</th>
          <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Montant TTC</th>
          <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Statut</th>
          <th className="w-10 px-2 py-2"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-dark-border">
        {invoices.map((invoice) => {
          const isSelected = selectedIds.has(invoice.id)
          return (
            <tr key={invoice.id} className={`transition-colors hover:bg-dark-hover ${isSelected ? 'bg-primary-50' : ''}`}>
              <td className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(invoice.id)}
                  className="h-4 w-4 rounded border-gray-300 text-accent-green focus:ring-primary-500 cursor-pointer"
                />
              </td>
              <td className="px-4 py-3">
                <Link href={`/invoices/${invoice.id}`} className="flex items-center gap-2 text-sm font-medium text-accent-green hover:text-accent-green">
                  <FileText className="h-4 w-4 flex-shrink-0" />
                  <span className="max-w-[200px] truncate">{invoice.file_name}</span>
                </Link>
              </td>
              <td className="px-4 py-3 text-sm text-gray-400">{invoice.supplier_name || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-400">{invoice.invoice_number || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(invoice.invoice_date)}</td>
              <td className="px-4 py-3 text-right text-sm font-medium text-gray-200">{formatAmount(invoice.total_ttc)}</td>
              <td className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <StatusBadge status={invoice.status} />
                  {matchedInvoiceIds && matchedInvoiceIds.has(invoice.id) ? (
                    <span title="Rapprochee avec le releve bancaire" className="inline-flex items-center rounded bg-accent-green/10 p-0.5">
                      <Landmark className="h-3 w-3 text-accent-green" />
                    </span>
                  ) : (invoice.status === 'validated' || invoice.status === 'exported') ? (
                    <span title="Non rapprochee" className="inline-flex items-center rounded bg-accent-orange/10 p-0.5">
                      <Landmark className="h-3 w-3 text-accent-orange" />
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="w-16 px-2 py-3">
                <div className="flex items-center gap-1">
                {(invoice.status === 'pending' || invoice.status === 'error' || (!invoice.supplier_name && !invoice.total_ttc)) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRescan(invoice.id) }}
                    disabled={rescanningIds.has(invoice.id)}
                    className="rounded p-1 text-accent-orange hover:bg-accent-orange/10 disabled:opacity-50"
                    title="Relancer le scan IA"
                  >
                    {rescanningIds.has(invoice.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSingle(invoice.id)
                  }}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-accent-red/10 hover:text-accent-red transition-colors"
                  title="Supprimer cette facture"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
