'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import { useRouter } from 'next/navigation'
import {
  Landmark,
  Check,
  X,
  AlertTriangle,
  Search,
  Link,
  Unlink,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Trash2,
  ChevronDown,
  Ban,
  Clock,
  ShieldOff,
  Eye,
} from 'lucide-react'

type TransactionStatus = 'matched' | 'unmatched' | 'ignored'
type FilterTab = 'all' | 'unmatched' | 'matched' | 'debits' | 'credits'

interface MatchedEntity {
  id: string
  type: 'invoice' | 'revenue'
  name: string
  amount: number
  date: string
}

interface Transaction {
  id: string
  date: string
  label: string
  debit: number | null
  credit: number | null
  status: TransactionStatus
  matched_entity?: MatchedEntity | null
}

interface StatementInfo {
  id: string
  file_name: string
  period_month: string
  total_debits: number
  total_credits: number
  transaction_count: number
}

interface MatchCandidate {
  id: string
  type: 'invoice' | 'revenue'
  name: string
  supplier?: string
  amount: number
  date: string
  file_name?: string
}

export default function ReconciliationClient({ statementId }: { statementId: string }) {
  const { user, loading: authLoading } = useAuth()
  const authFetch = useAuthFetch()
  const router = useRouter()

  const [statement, setStatement] = useState<StatementInfo | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [matchModalTx, setMatchModalTx] = useState<Transaction | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MatchCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [autoReconciling, setAutoReconciling] = useState(false)
  const [txSearch, setTxSearch] = useState('')
  const [ignoreDropdownTx, setIgnoreDropdownTx] = useState<string | null>(null)
  const [previewCandidate, setPreviewCandidate] = useState<MatchCandidate | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [matchingMulti, setMatchingMulti] = useState(false)
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([])
  const [multiMatchModal, setMultiMatchModal] = useState(false)
  const [autoRulePattern, setAutoRulePattern] = useState('')
  const [createAutoRule, setCreateAutoRule] = useState(false)
  const [showAllDocs, setShowAllDocs] = useState(false)

  // Close ignore dropdown on outside click
  useEffect(() => {
    if (!ignoreDropdownTx) return
    const handleClick = () => setIgnoreDropdownTx(null)
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', handleClick) }
  }, [ignoreDropdownTx])

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login')
      return
    }
    fetchData()
  }, [user, authLoading])

  const fetchData = async () => {
    try {
      const [stmtRes, txRes] = await Promise.all([
        authFetch(`/api/bank-statements/${statementId}`),
        authFetch(`/api/bank-statements/${statementId}/transactions`),
      ])
      if (stmtRes.ok) {
        const data = await stmtRes.json()
        // The API returns the statement fields at top level (not nested under .statement)
        setStatement({
          id: data.id,
          file_name: data.file_name,
          period_month: data.period_month,
          total_debits: data.total_debits,
          total_credits: data.total_credits,
          transaction_count: data.transaction_count || data.summary?.total_transactions || 0,
        })
      }
      if (txRes.ok) {
        const txData = await txRes.json()
        const txList = (txData.transactions || []).map((t: any) => ({
          id: t.id,
          date: t.date,
          label: t.label,
          debit: t.type === 'debit' ? t.amount : null,
          credit: t.type === 'credit' ? t.amount : null,
          status: t.match_status || 'unmatched',
          matched_entity: t.matched_invoice_id ? { id: t.matched_invoice_id, type: 'invoice', name: '', amount: t.amount, date: t.date } : null,
        }))
        setTransactions(txList)
      }
    } catch (e) {
      console.error('Fetch error:', e)
    }
    setLoading(false)
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)

  const matchedCount = transactions.filter((t) => t.status === 'matched').length
  const ignoredCount = transactions.filter((t) => t.status === 'ignored').length
  const treatedCount = matchedCount + ignoredCount
  const totalCount = transactions.length
  const matchPercent = totalCount > 0 ? Math.round((treatedCount / totalCount) * 100) : 0

  const filteredTransactions = transactions.filter((t) => {
    // Tab filter
    let tabMatch = true
    switch (activeTab) {
      case 'unmatched': tabMatch = t.status === 'unmatched'; break
      case 'matched': tabMatch = t.status === 'matched'; break
      case 'debits': tabMatch = t.debit != null && t.debit > 0; break
      case 'credits': tabMatch = t.credit != null && t.credit > 0; break
    }
    if (!tabMatch) return false
    // Search filter
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase()
      const label = (t.label || '').toLowerCase()
      const date = (t.date || '')
      const amount = String(t.debit || t.credit || '')
      return label.includes(q) || date.includes(q) || amount.includes(q)
    }
    return true
  })

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'Tous', count: totalCount },
    {
      key: 'unmatched',
      label: 'Non rapproches',
      count: transactions.filter((t) => t.status === 'unmatched').length,
    },
    { key: 'matched', label: 'Rapproches', count: matchedCount },
    {
      key: 'debits',
      label: 'Debits',
      count: transactions.filter((t) => t.debit != null && t.debit > 0).length,
    },
    {
      key: 'credits',
      label: 'Credits',
      count: transactions.filter((t) => t.credit != null && t.credit > 0).length,
    },
  ]

  const handleAutoReconcile = async () => {
    setAutoReconciling(true)
    try {
      const res = await authFetch(`/api/bank-statements/${statementId}/reconcile`, {
        method: 'POST',
      })
      if (res.ok) {
        await fetchData()
      }
    } catch (e) {
      console.error('Auto reconcile error:', e)
    }
    setAutoReconciling(false)
  }

  const handleIgnore = async (txId: string) => {
    try {
      const res = await authFetch(`/api/bank-statements/${statementId}/transactions/${txId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ignored' }),
      })
      if (res.ok) {
        setTransactions((prev) =>
          prev.map((t) => (t.id === txId ? { ...t, status: 'ignored' as const, matched_entity: null } : t))
        )
      }
    } catch (e) {
      console.error('Ignore error:', e)
    }
  }

  const detectIgnorePattern = (label: string): { pattern: string; match_type: 'contains' | 'starts_with' | 'exact'; description: string } => {
    const upper = (label || '').toUpperCase().trim()

    // Known prefixes that should use starts_with
    const knownPrefixes = [
      'VIR SEPA ACOMPTE SALAIRE',
      'VIR SEPA SALAIRE',
      'VIR SEPA',
      'PRLV SEPA',
      'REMCB',
      'COMCB',
      'COTIS CARTE',
      'FRAIS CARTE',
      'F COTIS',
      'RETRAIT DAB',
      'ECH PRET',
    ]

    for (const prefix of knownPrefixes) {
      if (upper.startsWith(prefix)) {
        // For VIR SEPA patterns, try to include purpose words after prefix
        if (prefix === 'VIR SEPA' && upper.length > prefix.length + 1) {
          const rest = upper.substring(prefix.length).trim()
          const words = rest.split(/\s+/)
          // Take first 2-3 meaningful words as the pattern
          const meaningful = words.filter((w) => w.length > 2).slice(0, 3)
          if (meaningful.length > 0) {
            const extended = prefix + ' ' + meaningful.join(' ')
            return { pattern: extended, match_type: 'starts_with', description: `Auto: ${label.substring(0, 50)}` }
          }
        }
        return { pattern: prefix, match_type: 'starts_with', description: `Auto: ${label.substring(0, 50)}` }
      }
    }

    // For other labels, try to extract a meaningful company/entity name
    // Remove trailing reference numbers, dates, etc.
    const cleaned = upper.replace(/\s+\d{6,}.*$/, '').replace(/\s+DU\s+\d{2}\/\d{2}.*$/, '').trim()
    if (cleaned.length > 3 && cleaned.length <= 60) {
      return { pattern: cleaned, match_type: 'contains', description: `Auto: ${label.substring(0, 50)}` }
    }

    // Fallback: use first 30 chars as starts_with
    const fallback = upper.substring(0, 30).trim()
    return { pattern: fallback, match_type: 'starts_with', description: `Auto: ${label.substring(0, 50)}` }
  }

  const handleIgnoreAlways = async (tx: Transaction) => {
    // 1. Ignore this transaction
    await handleIgnore(tx.id)

    // 2. Create an ignore rule
    const { pattern, match_type, description } = detectIgnorePattern(tx.label)
    try {
      await authFetch('/api/ignore-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern, match_type, description }),
      })
    } catch (e) {
      console.error('Create ignore rule error:', e)
    }
    setIgnoreDropdownTx(null)
  }

  const handleUnmatch = async (txId: string) => {
    try {
      const res = await authFetch(`/api/bank-statements/${statementId}/transactions/${txId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'unmatched', matched_entity: null }),
      })
      if (res.ok) {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === txId ? { ...t, status: 'unmatched' as const, matched_entity: null } : t
          )
        )
      }
    } catch (e) {
      console.error('Unmatch error:', e)
    }
  }

  const openMultiMatchModal = () => {
    if (selectedTxIds.length === 0) return
    setMultiMatchModal(true)
    setSearchQuery('')
    setSearchResults([])
    setSelectedCandidateIds([])
    setCreateAutoRule(false)
    setSearching(true)

    // Auto-detect common pattern in selected transaction labels
    const selectedLabels = selectedTxIds.map(id => {
      const tx = transactions.find(t => t.id === id)
      return (tx?.label || '').toUpperCase()
    })
    // Find common prefix
    if (selectedLabels.length > 1) {
      let common = selectedLabels[0]
      for (const label of selectedLabels.slice(1)) {
        while (common && !label.startsWith(common)) {
          common = common.substring(0, common.length - 1)
        }
      }
      // Clean up: trim and ensure at least 3 chars
      common = common.trim()
      if (common.length >= 3) {
        setAutoRulePattern(common)
      } else {
        setAutoRulePattern('')
      }
    } else {
      setAutoRulePattern(selectedLabels[0]?.substring(0, 20) || '')
    }
    // Load invoices sorted by total amount of selected transactions
    const totalAmount = selectedTxIds.reduce((sum, id) => {
      const tx = transactions.find(t => t.id === id)
      return sum + (tx?.debit || tx?.credit || 0)
    }, 0)
    // Detect if selected transactions are debits or credits
    const selectedTxTypes = selectedTxIds.map(id => transactions.find(t => t.id === id))
    const isCredit = selectedTxTypes.some(tx => tx?.credit && tx.credit > 0)
    const txTypeParam = isCredit ? 'credit' : 'debit'
    authFetch(`/api/invoices/search?amount=${totalAmount}&type=${txTypeParam}`)
      .then(res => res.ok ? res.json() : { invoices: [] })
      .then(data => {
        const results: MatchCandidate[] = (data.invoices || []).map((inv: any) => ({
          id: inv.id, type: inv.document_type === 'revenue' ? 'revenue' : inv.type === 'payslip' ? 'invoice' : 'invoice',
          name: inv.supplier_name || inv.file_name || 'Sans nom',
          amount: inv.total_ttc || 0, date: inv.invoice_date || '', file_name: inv.file_name || '',
        }))
        setSearchResults(results)
      })
      .catch(() => {})
      .finally(() => setSearching(false))
  }

  const openMatchModal = async (tx: Transaction) => {
    setMatchModalTx(tx)
    setSearchQuery('')
    setSearching(true)
    setSearchResults([])
    setSelectedCandidateIds([])

    // Auto-load ALL invoices sorted by closest amount
    try {
      const amount = tx.debit || tx.credit || 0
      const txType = showAllDocs ? '' : (tx.debit ? 'debit' : 'credit')
      const typeParam = txType ? `&type=${txType}` : ''
      const res = await authFetch(`/api/invoices/search?amount=${amount}${typeParam}`)
      if (res.ok) {
        const data = await res.json()
        const results: MatchCandidate[] = (data.invoices || []).map((inv: any) => ({
          id: inv.id,
          type: inv.document_type === 'revenue' ? 'revenue' : inv.type === 'payslip' ? 'invoice' : 'invoice',
          name: inv.supplier_name || inv.file_name || 'Sans nom',
          amount: inv.total_ttc || 0,
          date: inv.invoice_date || '',
          file_name: inv.file_name || '',
        }))
        setSearchResults(results)
      }
    } catch (e) {
      console.error('Load invoices error:', e)
    }
    setSearching(false)
  }

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    setSearching(true)
    try {
      const params = new URLSearchParams()
      if (query.length >= 1) params.set('q', query)
      if (matchModalTx) {
        const amount = matchModalTx.debit || matchModalTx.credit || 0
        params.set('amount', String(amount))
        if (!showAllDocs) params.set('type', matchModalTx.debit ? 'debit' : 'credit')
      }
      const res = await authFetch(`/api/invoices/search?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        const results: MatchCandidate[] = (data.invoices || []).map((inv: any) => ({
          id: inv.id,
          type: inv.document_type === 'revenue' ? 'revenue' : inv.type === 'payslip' ? 'invoice' : 'invoice',
          name: inv.supplier_name || inv.file_name || 'Sans nom',
          amount: inv.total_ttc || 0,
          date: inv.invoice_date || '',
          file_name: inv.file_name || '',
        }))
        setSearchResults(results)
      }
    } catch (e) {
      console.error('Search error:', e)
    }
    setSearching(false)
  }

  // Preview a candidate invoice before confirming
  const handlePreview = async (candidate: MatchCandidate) => {
    setPreviewCandidate(candidate)
    setLoadingPreview(true)
    setPreviewUrl(null)
    try {
      // Fetch invoice to get file_url
      const res = await authFetch(`/api/invoices/${candidate.id}`)
      if (res.ok) {
        const data = await res.json()
        setPreviewUrl(data.file_url || null)
      }
    } catch { /* */ }
    setLoadingPreview(false)
  }

  const confirmPreviewMatch = async () => {
    if (previewCandidate) {
      await confirmMatch(previewCandidate)
      setPreviewCandidate(null)
      setPreviewUrl(null)
    }
  }

  const confirmMatch = async (candidate: MatchCandidate) => {
    if (!matchModalTx) return

    try {
      const body: Record<string, string> = { transaction_id: matchModalTx.id }
      if (candidate.type === 'invoice') body.invoice_id = candidate.id
      else body.revenue_id = candidate.id

      const res = await authFetch(
        `/api/bank-statements/${statementId}/match`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      if (res.ok) {
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === matchModalTx.id
              ? {
                  ...t,
                  status: 'matched' as const,
                  matched_entity: {
                    id: candidate.id,
                    type: candidate.type,
                    name: candidate.name,
                    amount: candidate.amount,
                    date: candidate.date,
                  },
                }
              : t
          )
        )
        setMatchModalTx(null)
      }
    } catch (e) {
      console.error('Match error:', e)
    }
  }

  const statusIcon = (status: TransactionStatus) => {
    switch (status) {
      case 'matched':
        return <Check className="h-4 w-4 text-accent-green" />
      case 'unmatched':
        return <AlertTriangle className="h-4 w-4 text-accent-orange" />
      case 'ignored':
        return <X className="h-4 w-4 text-gray-500" />
    }
  }

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
        </div>
      </AppLayout>
    )
  }

  if (!statement) {
    return (
      <AppLayout>
        <div className="flex h-96 flex-col items-center justify-center gap-3">
          <AlertTriangle className="h-8 w-8 text-accent-red" />
          <p className="text-sm text-gray-500">Releve introuvable.</p>
          <button onClick={() => router.push('/bank')} className="btn-secondary text-sm">
            Retour
          </button>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/bank')}
              className="rounded-lg p-2 text-gray-400 hover:bg-dark-hover hover:text-gray-200 transition-colors"
            >
              <Landmark className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">{statement.file_name}</h1>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-sm text-gray-500">Periode : {statement.period_month}</span>
                <span className="text-sm font-mono text-accent-red">{fmt(statement.total_debits)} debits</span>
                <span className="text-sm font-mono text-accent-green">{fmt(statement.total_credits)} credits</span>
              </div>
            </div>
          </div>
          <button
            onClick={handleAutoReconcile}
            disabled={autoReconciling}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {autoReconciling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link className="h-4 w-4" />
            )}
            Lancer le rapprochement auto
          </button>
        </div>

        {/* Summary bar */}
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-400">
              Traites : <span className="font-mono font-medium text-white">{treatedCount}</span> /{' '}
              <span className="font-mono">{totalCount}</span>{' '}
              <span className="text-accent-green font-medium">({matchPercent}%)</span>
              <span className="ml-3 text-xs">
                (<span className="text-accent-green">{matchedCount} rapproches</span>
                {ignoredCount > 0 && <span className="text-gray-500"> + {ignoredCount} ignores</span>})
              </span>
            </p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-dark-input">
            <div
              className="h-full rounded-full bg-accent-green transition-all duration-700"
              style={{ width: `${matchPercent}%` }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-accent-green/10 text-accent-green'
                    : 'bg-dark-card text-gray-400 hover:bg-dark-hover hover:text-gray-200'
                }`}
              >
                {tab.label}
                {tab.count != null && (
                  <span className="ml-1.5 font-mono text-xs opacity-70">{tab.count}</span>
                )}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Rechercher..."
              className="input-field w-48 pl-9 text-sm"
            />
          </div>
        </div>

        {/* Transactions table */}
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border text-left">
                <th className="w-8 px-2 py-3">
                  {(() => {
                    const selectableIds = filteredTransactions.filter(t => t.status === 'unmatched').map(t => t.id)
                    if (selectableIds.length === 0) return null
                    const allChecked = selectableIds.length > 0 && selectableIds.every(id => selectedTxIds.includes(id))
                    return (
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => {
                          if (allChecked) {
                            setSelectedTxIds(prev => prev.filter(id => !selectableIds.includes(id)))
                          } else {
                            setSelectedTxIds(prev => [...new Set([...prev, ...selectableIds])])
                          }
                        }}
                        className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green/50 cursor-pointer"
                        title={`Tout ${allChecked ? 'decocher' : 'cocher'} (${selectableIds.length})`}
                      />
                    )
                  })()}
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Date
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Libelle
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Debit
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Credit
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Statut
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-border">
              {filteredTransactions.length > 0 ? (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className={`hover:bg-dark-hover transition-colors ${selectedTxIds.includes(tx.id) ? 'bg-accent-green/5' : ''}`}>
                    <td className="w-8 px-2 py-3">
                      {tx.status === 'unmatched' && (
                        <input
                          type="checkbox"
                          checked={selectedTxIds.includes(tx.id)}
                          onChange={() => setSelectedTxIds(prev =>
                            prev.includes(tx.id) ? prev.filter(id => id !== tx.id) : [...prev, tx.id]
                          )}
                          className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green/50 cursor-pointer"
                        />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-300">
                      {tx.date
                        ? new Date(tx.date).toLocaleDateString('fr-FR')
                        : '-'}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-gray-200">
                      <div>
                        <p className="truncate">{tx.label}</p>
                        {tx.status === 'matched' && tx.matched_entity && (
                          <button
                            onClick={() => {
                              const path =
                                tx.matched_entity!.type === 'invoice'
                                  ? `/invoices/${tx.matched_entity!.id}`
                                  : `/revenue/${tx.matched_entity!.id}`
                              router.push(path)
                            }}
                            className="mt-0.5 flex items-center gap-1 text-xs text-accent-green hover:underline"
                          >
                            <FileText className="h-3 w-3" />
                            {tx.matched_entity.name}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm">
                      {tx.debit != null && tx.debit > 0 ? (
                        <span className="text-accent-red">{fmt(tx.debit)}</span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm">
                      {tx.credit != null && tx.credit > 0 ? (
                        <span className="text-accent-green">{fmt(tx.credit)}</span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">{statusIcon(tx.status)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {tx.status === 'unmatched' && (
                          <>
                            <button
                              onClick={() => openMatchModal(tx)}
                              className="rounded px-2 py-1 text-xs font-medium text-accent-blue hover:bg-accent-blue/10 transition-colors"
                            >
                              Pointer
                            </button>
                            <div className="relative">
                              <button
                                onClick={() => setIgnoreDropdownTx(ignoreDropdownTx === tx.id ? null : tx.id)}
                                className="flex items-center gap-0.5 rounded px-2 py-1 text-xs text-gray-500 hover:bg-dark-hover hover:text-gray-300 transition-colors"
                              >
                                Ignorer
                                <ChevronDown className="h-3 w-3" />
                              </button>
                              {ignoreDropdownTx === tx.id && (
                                <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-lg border border-dark-border bg-dark-card shadow-xl">
                                  <button
                                    onClick={() => { handleIgnore(tx.id); setIgnoreDropdownTx(null) }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 hover:bg-dark-hover transition-colors rounded-t-lg"
                                  >
                                    <Clock className="h-3.5 w-3.5 text-gray-500" />
                                    Ce mois
                                  </button>
                                  <button
                                    onClick={() => handleIgnoreAlways(tx)}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 hover:bg-dark-hover transition-colors rounded-b-lg border-t border-dark-border"
                                  >
                                    <ShieldOff className="h-3.5 w-3.5 text-accent-orange" />
                                    Toujours (creer une regle)
                                  </button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                        {tx.status === 'matched' && (
                          <button
                            onClick={() => handleUnmatch(tx.id)}
                            className="rounded p-1 text-gray-500 hover:bg-accent-red/10 hover:text-accent-red transition-colors"
                            title="Dissocier"
                          >
                            <Unlink className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {tx.status === 'ignored' && (
                          <button
                            onClick={() => handleUnmatch(tx.id)}
                            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-dark-hover hover:text-gray-300 transition-colors"
                          >
                            Restaurer
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    Aucune transaction pour ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Floating bar when transactions are selected */}
        {selectedTxIds.length > 0 && (
          <div className="sticky bottom-4 mx-auto flex w-fit items-center gap-3 rounded-xl border border-accent-green/30 bg-dark-card px-5 py-3 shadow-2xl">
            <span className="text-sm text-gray-300">
              <span className="font-bold text-accent-green">{selectedTxIds.length}</span> ligne(s) selectionnee(s)
              <span className="ml-2 font-mono text-xs text-gray-500">
                ({fmt(selectedTxIds.reduce((s, id) => {
                  const tx = transactions.find(t => t.id === id)
                  return s + (tx?.debit || tx?.credit || 0)
                }, 0))})
              </span>
            </span>
            <button
              onClick={openMultiMatchModal}
              className="flex items-center gap-1.5 rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90"
            >
              <Link className="h-4 w-4" />
              Pointer la selection
            </button>
            <button
              onClick={() => setSelectedTxIds([])}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-dark-hover hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Manual match modal */}
      {matchModalTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-xl border border-dark-border bg-dark-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-dark-border px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-white">Pointer la transaction</h3>
                <p className="mt-0.5 text-sm text-gray-500 truncate max-w-sm">
                  {matchModalTx.label}
                </p>
                <p className="text-xs font-mono text-gray-400 mt-0.5">
                  {matchModalTx.debit
                    ? `Debit : ${fmt(matchModalTx.debit)}`
                    : `Credit : ${fmt(matchModalTx.credit || 0)}`}{' '}
                  &middot;{' '}
                  {matchModalTx.date
                    ? new Date(matchModalTx.date).toLocaleDateString('fr-FR')
                    : '-'}
                </p>
              </div>
              <button
                onClick={() => setMatchModalTx(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-dark-hover hover:text-gray-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Rechercher une facture ou un revenu..."
                  className="input-field w-full pl-10 text-sm"
                  autoFocus
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-500" />
                )}
              </div>

              {/* Toggle to show all document types */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllDocs}
                  onChange={() => {
                    setShowAllDocs(!showAllDocs)
                    if (matchModalTx) {
                      const amount = matchModalTx.debit || matchModalTx.credit || 0
                      const typeParam = !showAllDocs ? '' : `&type=${matchModalTx.debit ? 'debit' : 'credit'}`
                      authFetch(`/api/invoices/search?amount=${amount}${typeParam}`)
                        .then(res => res.ok ? res.json() : { invoices: [] })
                        .then(data => {
                          setSearchResults((data.invoices || []).map((inv: any) => ({
                            id: inv.id, type: inv.document_type === 'revenue' ? 'revenue' : inv.type === 'payslip' ? 'invoice' : 'invoice',
                            name: inv.supplier_name || inv.file_name || 'Sans nom',
                            amount: inv.total_ttc || 0, date: inv.invoice_date || '', file_name: inv.file_name || '',
                          })))
                        })
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border-dark-border bg-dark-input text-accent-orange focus:ring-accent-orange/50"
                />
                <span className="text-xs text-gray-400">Voir tous les documents (factures + encaissements + bulletins)</span>
              </label>

              {/* Results with checkboxes + eye preview */}
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {searchResults.length > 0 ? (
                  searchResults.map((candidate) => {
                    const isSelected = selectedCandidateIds.includes(candidate.id)
                    const txAmount = matchModalTx?.debit || matchModalTx?.credit || 0
                    const isExactMatch = Math.abs(candidate.amount - txAmount) <= 0.01
                    return (
                      <div
                        key={`${candidate.type}-${candidate.id}`}
                        className={`flex items-center gap-2 rounded-lg border p-2.5 transition-all ${
                          isSelected ? 'border-accent-green/50 bg-accent-green/5' : isExactMatch ? 'border-accent-green/20 bg-accent-green/5' : 'border-dark-border bg-dark-input'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => setSelectedCandidateIds(prev =>
                            prev.includes(candidate.id) ? prev.filter(id => id !== candidate.id) : [...prev, candidate.id]
                          )}
                          className="h-4 w-4 shrink-0 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green/50 cursor-pointer"
                        />
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {candidate.type === 'invoice' ? (
                            <ArrowDownRight className="h-4 w-4 shrink-0 text-accent-red" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 shrink-0 text-accent-green" />
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-200">{candidate.name}</p>
                            {candidate.file_name && candidate.file_name !== candidate.name && (
                              <p className="truncate text-xs text-gray-500">{candidate.file_name}</p>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right flex items-center gap-2">
                          <div>
                            <p className="font-mono text-sm font-medium text-gray-200">{fmt(candidate.amount)}</p>
                            <p className="text-xs text-gray-500">
                              {candidate.date ? new Date(candidate.date).toLocaleDateString('fr-FR') : '-'}
                            </p>
                          </div>
                          {isExactMatch && (
                            <span className="rounded bg-accent-green/10 px-1 py-0.5 text-[9px] font-bold text-accent-green">MATCH</span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePreview(candidate) }}
                            className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-200"
                            title="Voir la facture"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })
                ) : !searching ? (
                  <p className="py-6 text-center text-sm text-gray-500">Aucun resultat.</p>
                ) : null}
              </div>

              {/* Confirm button */}
              {selectedCandidateIds.length > 0 && (
                <div className="flex items-center justify-between border-t border-dark-border pt-3">
                  <span className="text-xs text-gray-500">{selectedCandidateIds.length} facture(s) selectionnee(s)</span>
                  <button
                    onClick={async () => {
                      if (!matchModalTx) return
                      setMatchingMulti(true)
                      try {
                        for (const cId of selectedCandidateIds) {
                          const c = searchResults.find(r => r.id === cId)
                          if (!c) continue
                          const body: Record<string, string> = { transaction_id: matchModalTx.id }
                          if (c.type === 'invoice') body.invoice_id = c.id
                          else body.revenue_id = c.id
                          await authFetch(`/api/bank-statements/${statementId}/match`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                          })
                        }
                        setMatchModalTx(null)
                        setSelectedCandidateIds([])
                        await fetchData()
                      } catch (e) { console.error('Match error:', e) }
                      setMatchingMulti(false)
                    }}
                    disabled={matchingMulti}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50"
                  >
                    {matchingMulti ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Confirmer
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Multi-match modal: several transactions → one invoice */}
      {multiMatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg rounded-xl border border-dark-border bg-dark-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-dark-border px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-white">Pointer {selectedTxIds.length} transactions</h3>
                <p className="mt-0.5 text-xs font-mono text-gray-400">
                  Total: {fmt(selectedTxIds.reduce((s, id) => { const tx = transactions.find(t => t.id === id); return s + (tx?.debit || tx?.credit || 0) }, 0))}
                </p>
              </div>
              <button onClick={() => setMultiMatchModal(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-dark-hover hover:text-gray-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={async (e) => {
                    const q = e.target.value
                    setSearchQuery(q)
                    setSearching(true)
                    try {
                      const totalAmt = selectedTxIds.reduce((s, id) => { const tx = transactions.find(t => t.id === id); return s + (tx?.debit || tx?.credit || 0) }, 0)
                      const isCreditTx = selectedTxIds.some(id => { const tx = transactions.find(t => t.id === id); return tx?.credit && tx.credit > 0 })
                      const params = new URLSearchParams({ amount: String(totalAmt), type: isCreditTx ? 'credit' : 'debit' })
                      if (q.length >= 1) params.set('q', q)
                      const res = await authFetch(`/api/invoices/search?${params}`)
                      if (res.ok) {
                        const data = await res.json()
                        setSearchResults((data.invoices || []).map((inv: any) => ({
                          id: inv.id, type: inv.document_type === 'revenue' ? 'revenue' : inv.type === 'payslip' ? 'invoice' : 'invoice',
                          name: inv.supplier_name || inv.file_name || 'Sans nom',
                          amount: inv.total_ttc || 0, date: inv.invoice_date || '', file_name: inv.file_name || '',
                        })))
                      }
                    } catch {}
                    setSearching(false)
                  }}
                  placeholder="Rechercher une facture..."
                  className="input-field w-full pl-10 text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {searching && (
                  <div className="flex h-16 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-accent-green" />
                  </div>
                )}
                {!searching && searchResults.length === 0 && (
                  <p className="py-6 text-center text-sm text-gray-500">Aucune facture trouvee. Tapez pour rechercher.</p>
                )}
                {searchResults.map((candidate) => {
                  const isSelected = selectedCandidateIds.includes(candidate.id)
                  const totalAmt = selectedTxIds.reduce((s, id) => { const tx = transactions.find(t => t.id === id); return s + (tx?.debit || tx?.credit || 0) }, 0)
                  const isExactMatch = Math.abs(candidate.amount - totalAmt) <= 0.01
                  return (
                    <div
                      key={candidate.id}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 transition-all ${
                        isSelected ? 'border-accent-green/50 bg-accent-green/5' : isExactMatch ? 'border-accent-green/20 bg-accent-green/5' : 'border-dark-border bg-dark-input'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setSelectedCandidateIds(prev =>
                          prev.includes(candidate.id) ? prev.filter(id => id !== candidate.id) : [...prev, candidate.id]
                        )}
                        className="h-4 w-4 shrink-0 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green/50 cursor-pointer"
                      />
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {candidate.type === 'invoice' ? (
                          <ArrowDownRight className="h-4 w-4 shrink-0 text-accent-red" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-accent-green" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-200">{candidate.name}</p>
                          {candidate.file_name && candidate.file_name !== candidate.name && (
                            <p className="truncate text-xs text-gray-500">{candidate.file_name}</p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right flex items-center gap-2">
                        <div>
                          <p className="font-mono text-sm font-medium text-gray-200">{fmt(candidate.amount)}</p>
                          <p className="text-xs text-gray-500">{candidate.date ? new Date(candidate.date).toLocaleDateString('fr-FR') : '-'}</p>
                        </div>
                        {isExactMatch && (
                          <span className="rounded bg-accent-green/10 px-1 py-0.5 text-[9px] font-bold text-accent-green">MATCH</span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreview(candidate) }}
                          className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-200"
                          title="Voir le document"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Confirm button for multi-match */}
              {selectedCandidateIds.length > 0 && (
                <button
                  onClick={async () => {
                    setMatchingMulti(true)
                    try {
                      for (const txId of selectedTxIds) {
                        const tx = transactions.find(t => t.id === txId)
                        if (!tx) continue
                        for (const cId of selectedCandidateIds) {
                          const c = searchResults.find(r => r.id === cId)
                          if (!c) continue
                          const body: Record<string, string> = { transaction_id: txId }
                          if (c.type === 'invoice') body.invoice_id = c.id
                          else body.revenue_id = c.id
                          await authFetch(`/api/bank-statements/${statementId}/match`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                          })
                        }
                      }
                      // Create auto-match rule if checked
                      if (createAutoRule && autoRulePattern.trim() && selectedCandidateIds.length === 1) {
                        const c = searchResults.find(r => r.id === selectedCandidateIds[0])
                        if (c) {
                          await authFetch('/api/auto-match-rules', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              pattern: autoRulePattern.trim(),
                              match_type: 'contains',
                              document_id: c.id,
                              document_type: c.type,
                              document_name: c.name || c.file_name,
                              description: `"${autoRulePattern.trim()}" → ${c.name || c.file_name}`,
                            }),
                          })
                        }
                      }
                      setMultiMatchModal(false)
                      setSelectedTxIds([])
                      setSelectedCandidateIds([])
                      await fetchData()
                    } catch (e) { console.error('Multi match error:', e) }
                    setMatchingMulti(false)
                  }}
                  disabled={matchingMulti}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-accent-green px-4 py-2.5 text-sm font-bold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50"
                >
                  {matchingMulti ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Pointer {selectedTxIds.length} transaction(s) → {selectedCandidateIds.length} document(s)
                </button>
              )}

              {/* Auto-rule option */}
              {autoRulePattern && (
                <div className="border-t border-dark-border pt-3">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createAutoRule}
                      onChange={() => setCreateAutoRule(!createAutoRule)}
                      className="mt-0.5 h-4 w-4 rounded border-dark-border bg-dark-input text-accent-orange focus:ring-accent-orange/50"
                    />
                    <div>
                      <p className="text-xs font-medium text-accent-orange">Creer une regle automatique</p>
                      <p className="text-xs text-gray-500">
                        Les prochains mois, les transactions contenant
                        <input
                          type="text"
                          value={autoRulePattern}
                          onChange={(e) => setAutoRulePattern(e.target.value)}
                          className="mx-1 inline-block w-32 rounded border border-dark-border bg-dark-input px-1.5 py-0.5 text-xs font-mono text-accent-orange focus:border-accent-orange focus:outline-none"
                        />
                        seront automatiquement pointees avec ce document.
                      </p>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview modal */}
      {previewCandidate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-3xl rounded-xl border border-dark-border bg-dark-card shadow-2xl" style={{ maxHeight: '85vh' }}>
            <div className="flex items-center justify-between border-b border-dark-border px-6 py-3">
              <div>
                <p className="text-sm font-medium text-white">{previewCandidate.name}</p>
                <p className="text-xs text-gray-500">{previewCandidate.file_name} — {fmt(previewCandidate.amount)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={confirmPreviewMatch}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-green px-3 py-1.5 text-xs font-semibold text-dark-bg hover:bg-accent-green/90"
                >
                  <Check className="h-3.5 w-3.5" />
                  Valider le rapprochement
                </button>
                <button
                  onClick={() => { setPreviewCandidate(null); setPreviewUrl(null) }}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-dark-hover hover:text-gray-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="p-4" style={{ height: '70vh' }}>
              {loadingPreview ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
                </div>
              ) : previewUrl ? (
                <iframe src={previewUrl} className="h-full w-full rounded-lg border border-dark-border" />
              ) : (
                <p className="flex h-full items-center justify-center text-gray-500">Impossible de charger le PDF</p>
              )}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
