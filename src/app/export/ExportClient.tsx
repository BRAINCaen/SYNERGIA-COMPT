'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import {
  Download,
  FileText,
  Loader2,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Banknote,
  Users,
  FolderOpen,
} from 'lucide-react'
import type { Invoice, ExportFormat, RevenueEntry, Payslip } from '@/types'

type DocTab = 'factures' | 'encaissements' | 'personnel' | 'tous'

interface ExportableDoc {
  id: string
  type: 'facture' | 'encaissement' | 'payslip'
  label: string
  sublabel: string
  date: string | null
  amount: number | null
}

export default function ExportClient() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [revenue, setRevenue] = useState<RevenueEntry[]>([])
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<ExportFormat>('fec')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [docTab, setDocTab] = useState<DocTab>('tous')
  const { user } = useAuth()
  const authFetch = useAuthFetch()

  // Month selector
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    if (user) fetchAll()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const fetchAll = async () => {
    setLoading(true)
    try {
      // Sequential to avoid auth token race condition
      const invRes = await authFetch('/api/invoices')
      if (invRes.ok) {
        const data = await invRes.json()
        setInvoices(data.filter((i: Invoice) => i.status === 'validated' || i.status === 'exported'))
      }

      const revRes = await authFetch('/api/revenue')
      if (revRes.ok) {
        const data = await revRes.json()
        setRevenue(data)
      }

      const payRes = await authFetch('/api/payslips')
      if (payRes.ok) {
        const data = await payRes.json()
        setPayslips(data)
      }
    } catch (e) {
      console.error('Fetch error:', e)
    }
    setLoading(false)
  }

  // Build unified doc list
  const allDocs: ExportableDoc[] = useMemo(() => {
    const docs: ExportableDoc[] = []

    for (const inv of invoices) {
      docs.push({
        id: `facture:${inv.id}`,
        type: 'facture',
        label: inv.supplier_name || inv.file_name,
        sublabel: `${inv.invoice_number || '-'} · ${inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('fr-FR') : '-'}`,
        date: inv.invoice_date || inv.created_at,
        amount: inv.total_ttc,
      })
    }

    for (const rev of revenue) {
      docs.push({
        id: `encaissement:${rev.id}`,
        type: 'encaissement',
        label: rev.entity_name || rev.description || rev.source,
        sublabel: `${rev.reference || rev.source} · ${rev.date ? new Date(rev.date).toLocaleDateString('fr-FR') : '-'}`,
        date: rev.date,
        amount: rev.amount_ttc,
      })
    }

    for (const pay of payslips) {
      docs.push({
        id: `payslip:${pay.id}`,
        type: 'payslip',
        label: pay.employee_name,
        sublabel: `Bulletin ${pay.month} · Brut: ${formatAmount(pay.gross_salary)}`,
        date: pay.month ? `${pay.month}-01` : pay.created_at,
        amount: pay.net_salary,
      })
    }

    return docs
  }, [invoices, revenue, payslips])

  // Filter by month
  const filteredByMonth = useMemo(() => {
    if (!selectedMonth) return allDocs
    return allDocs.filter((doc) => {
      if (!doc.date) return false
      return doc.date.startsWith(selectedMonth)
    })
  }, [allDocs, selectedMonth])

  // Filter by tab
  const filteredDocs = useMemo(() => {
    if (docTab === 'tous') return filteredByMonth
    if (docTab === 'factures') return filteredByMonth.filter((d) => d.type === 'facture')
    if (docTab === 'encaissements') return filteredByMonth.filter((d) => d.type === 'encaissement')
    if (docTab === 'personnel') return filteredByMonth.filter((d) => d.type === 'payslip')
    return filteredByMonth
  }, [filteredByMonth, docTab])

  // Available months from docs
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    for (const doc of allDocs) {
      if (doc.date) {
        const m = doc.date.slice(0, 7) // YYYY-MM
        if (/^\d{4}-\d{2}$/.test(m)) months.add(m)
      }
    }
    return Array.from(months).sort().reverse()
  }, [allDocs])

  // Month navigation
  const navigateMonth = (dir: -1 | 1) => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const date = new Date(y, m - 1 + dir, 1)
    setSelectedMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
    setSelected(new Set())
  }

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const d = new Date(y, m - 1)
    return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }).replace(/^\w/, (c) => c.toUpperCase())
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filteredDocs.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredDocs.map((d) => d.id)))
    }
  }

  const handleExport = async () => {
    if (selected.size === 0) return
    setExporting(true)

    try {
      // Separate IDs by type
      const invoiceIds: string[] = []
      const revenueIds: string[] = []
      const payslipIds: string[] = []

      for (const key of selected) {
        const [type, id] = key.split(':')
        if (type === 'facture') invoiceIds.push(id)
        else if (type === 'encaissement') revenueIds.push(id)
        else if (type === 'payslip') payslipIds.push(id)
      }

      const res = await authFetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_ids: invoiceIds,
          revenue_ids: revenueIds,
          payslip_ids: payslipIds,
          format,
          month: selectedMonth,
        }),
      })

      if (res.ok) {
        const blob = await res.blob()
        const contentDisposition = res.headers.get('Content-Disposition')
        const fileName = contentDisposition?.match(/filename="(.+)"/)?.[1] || `export_${selectedMonth}.${format === 'fec' ? 'txt' : format}`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
        await fetchAll()
        setSelected(new Set())
      }
    } catch (error) {
      console.error('Export error:', error)
    }

    setExporting(false)
  }

  const tabs: { key: DocTab; label: string; icon: typeof FileText; count: number }[] = [
    { key: 'tous', label: 'Tous', icon: FolderOpen, count: filteredByMonth.length },
    { key: 'factures', label: 'Factures', icon: Receipt, count: filteredByMonth.filter((d) => d.type === 'facture').length },
    { key: 'encaissements', label: 'Encaissements', icon: Banknote, count: filteredByMonth.filter((d) => d.type === 'encaissement').length },
    { key: 'personnel', label: 'Personnel', icon: Users, count: filteredByMonth.filter((d) => d.type === 'payslip').length },
  ]

  const formats: { value: ExportFormat; label: string; desc: string }[] = [
    { value: 'fec', label: 'FEC', desc: 'Fichier des Ecritures Comptables (format legal)' },
    { value: 'csv', label: 'CSV', desc: 'Tableur compatible Excel (separateur ;)' },
    { value: 'json', label: 'JSON', desc: 'Format structure pour integration' },
  ]

  const typeColors: Record<string, string> = {
    facture: 'bg-blue-500/20 text-blue-400',
    encaissement: 'bg-green-500/20 text-green-400',
    payslip: 'bg-purple-500/20 text-purple-400',
  }

  const typeLabels: Record<string, string> = {
    facture: 'Facture',
    encaissement: 'Encaissement',
    payslip: 'Bulletin',
  }

  // Stats for current month
  const totalSelected = useMemo(() => {
    let sum = 0
    for (const key of selected) {
      const doc = filteredDocs.find((d) => d.id === key)
      if (doc?.amount) sum += doc.amount
    }
    return sum
  }, [selected, filteredDocs])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Export comptable</h1>
        <p className="mt-1 text-sm text-gray-500">Exportez vos documents valides — FEC, CSV ou JSON</p>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between rounded-xl border border-dark-border bg-dark-card px-4 py-3">
        <button
          onClick={() => navigateMonth(-1)}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-dark-hover hover:text-white"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-lg font-semibold text-white">{monthLabel(selectedMonth)}</p>
          <p className="text-xs text-gray-500">
            {filteredByMonth.length} document{filteredByMonth.length > 1 ? 's' : ''} valide{filteredByMonth.length > 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => navigateMonth(1)}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-dark-hover hover:text-white"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Quick month pills */}
      {availableMonths.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {availableMonths.slice(0, 12).map((m) => (
            <button
              key={m}
              onClick={() => { setSelectedMonth(m); setSelected(new Set()) }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                m === selectedMonth
                  ? 'bg-accent-green text-dark-bg'
                  : 'bg-dark-card text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
            >
              {new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
            </button>
          ))}
        </div>
      )}

      {/* Format */}
      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Format d&apos;export</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {formats.map((f) => (
            <button key={f.value} onClick={() => setFormat(f.value)}
              className={`rounded-lg border-2 p-4 text-left transition-colors ${format === f.value ? 'border-accent-green bg-accent-green/10' : 'border-dark-border hover:border-gray-500'}`}>
              <p className="font-medium text-gray-200">{f.label}</p>
              <p className="mt-1 text-xs text-gray-500">{f.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Document type tabs */}
      <div className="flex gap-1 rounded-xl border border-dark-border bg-dark-card p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => { setDocTab(tab.key); setSelected(new Set()) }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                docTab === tab.key
                  ? 'bg-accent-green/20 text-accent-green'
                  : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                docTab === tab.key ? 'bg-accent-green/30 text-accent-green' : 'bg-dark-hover text-gray-500'
              }`}>
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Document list */}
      <div className="card p-0">
        <div className="flex items-center justify-between border-b border-dark-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={selectAll} className="text-gray-500 hover:text-gray-300">
              {selected.size === filteredDocs.length && filteredDocs.length > 0 ? (
                <CheckSquare className="h-5 w-5 text-accent-green" />
              ) : (
                <Square className="h-5 w-5" />
              )}
            </button>
            <h2 className="text-sm font-semibold text-gray-400">
              {filteredDocs.length} document{filteredDocs.length > 1 ? 's' : ''}
            </h2>
            {selected.size > 0 && (
              <span className="rounded-full bg-accent-green/20 px-2 py-0.5 text-xs font-medium text-accent-green">
                {selected.size} selectionne{selected.size > 1 ? 's' : ''} · {formatAmount(totalSelected)}
              </span>
            )}
          </div>
          <button onClick={handleExport} disabled={selected.size === 0 || exporting} className="btn-primary">
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Exporter {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <FileText className="mb-3 h-12 w-12 text-gray-600" />
            <p className="text-sm">Aucun document valide pour {monthLabel(selectedMonth)}</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-border">
            {filteredDocs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => toggleSelect(doc.id)}
                className={`flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-dark-hover ${
                  selected.has(doc.id) ? 'bg-accent-green/5' : ''
                }`}
              >
                {selected.has(doc.id) ? (
                  <CheckSquare className="h-5 w-5 shrink-0 text-accent-green" />
                ) : (
                  <Square className="h-5 w-5 shrink-0 text-gray-500" />
                )}
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${typeColors[doc.type]}`}>
                  {typeLabels[doc.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">{doc.label}</p>
                  <p className="truncate text-xs text-gray-500">{doc.sublabel}</p>
                </div>
                <span className="shrink-0 text-sm font-mono font-medium text-gray-200">
                  {formatAmount(doc.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatAmount(amount: number | null | undefined) {
  if (amount == null) return '-'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}
