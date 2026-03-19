'use client'

import { useState, useEffect } from 'react'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import { Download, FileText, Loader2, CheckSquare, Square } from 'lucide-react'
import type { Invoice, ExportFormat } from '@/types'

export default function ExportClient() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<ExportFormat>('fec')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const authFetch = useAuthFetch()

  useEffect(() => {
    fetchValidated()
  }, [])

  const fetchValidated = async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/invoices?status=validated')
      if (res.ok) {
        const data = await res.json()
        setInvoices(data)
      }
    } catch (e) {
      console.error('Fetch error:', e)
    }
    setLoading(false)
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
    if (selected.size === invoices.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(invoices.map((i) => i.id)))
    }
  }

  const handleExport = async () => {
    if (selected.size === 0) return
    setExporting(true)

    try {
      const res = await authFetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_ids: Array.from(selected), format }),
      })

      if (res.ok) {
        const blob = await res.blob()
        const contentDisposition = res.headers.get('Content-Disposition')
        const fileName = contentDisposition?.match(/filename="(.+)"/)?.[1] || `export.${format === 'fec' ? 'txt' : format}`
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
        await fetchValidated()
        setSelected(new Set())
      }
    } catch (error) {
      console.error('Export error:', error)
    }

    setExporting(false)
  }

  const formatAmount = (amount: number | null) => {
    if (amount == null) return '-'
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
  }

  const formats: { value: ExportFormat; label: string; desc: string }[] = [
    { value: 'fec', label: 'FEC', desc: 'Fichier des Ecritures Comptables (format legal)' },
    { value: 'csv', label: 'CSV', desc: 'Tableur compatible Excel (separateur ;)' },
    { value: 'json', label: 'JSON', desc: 'Format structure pour integration' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Export comptable</h1>
        <p className="mt-1 text-sm text-gray-500">Exportez vos factures validees — FEC, CSV ou JSON</p>
      </div>

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

      <div className="card p-0">
        <div className="flex items-center justify-between border-b border-dark-border px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={selectAll} className="text-gray-500 hover:text-gray-300">
              {selected.size === invoices.length && invoices.length > 0 ? <CheckSquare className="h-5 w-5 text-accent-green" /> : <Square className="h-5 w-5" />}
            </button>
            <h2 className="text-sm font-semibold text-gray-400">Factures validees ({invoices.length})</h2>
          </div>
          <button onClick={handleExport} disabled={selected.size === 0 || exporting} className="btn-primary">
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Exporter {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-accent-green" /></div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <FileText className="mb-3 h-12 w-12 text-gray-600" />
            <p className="text-sm">Aucune facture validee disponible pour l&apos;export</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-border">
            {invoices.map((inv) => (
              <div key={inv.id} onClick={() => toggleSelect(inv.id)}
                className={`flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-dark-hover ${selected.has(inv.id) ? 'bg-accent-green/5' : ''}`}>
                {selected.has(inv.id) ? <CheckSquare className="h-5 w-5 text-accent-green" /> : <Square className="h-5 w-5 text-gray-500" />}
                <FileText className="h-5 w-5 text-gray-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200">{inv.supplier_name || inv.file_name}</p>
                  <p className="text-xs text-gray-500">{inv.invoice_number || '-'} &middot; {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('fr-FR') : '-'}</p>
                </div>
                <span className="text-sm font-mono font-medium text-gray-200">{formatAmount(inv.total_ttc)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
