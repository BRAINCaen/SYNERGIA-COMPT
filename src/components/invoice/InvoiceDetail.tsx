'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import { StatusBadge, ConfidenceBadge } from '@/components/ui/Badge'
import PCGSelector from './PCGSelector'
import {
  CheckCircle, Download, ArrowLeft, FileText, Loader2, Save, AlertTriangle,
} from 'lucide-react'
import type { Invoice, InvoiceLine, PCGAccount } from '@/types'

interface InvoiceDetailProps {
  invoiceId: string
  pcgAccounts: PCGAccount[]
}

interface EditableLine extends InvoiceLine {
  isEdited: boolean
}

export default function InvoiceDetail({ invoiceId, pcgAccounts }: InvoiceDetailProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [lines, setLines] = useState<EditableLine[]>([])
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const router = useRouter()
  const authFetch = useAuthFetch()

  useEffect(() => {
    fetchInvoice()
  }, [invoiceId])

  const fetchInvoice = async () => {
    setLoading(true)
    const res = await authFetch(`/api/invoices/${invoiceId}`)
    if (res.ok) {
      const data = await res.json()
      setInvoice(data)
      setFileUrl(data.file_url)
      setLines(
        (data.lines || []).map((l: InvoiceLine) => ({ ...l, isEdited: false }))
      )
    }
    setLoading(false)
  }

  const updateLine = (index: number, pcgCode: string, pcgLabel: string) => {
    setLines((prev) =>
      prev.map((l, i) =>
        i === index ? { ...l, pcg_code: pcgCode, pcg_label: pcgLabel, isEdited: true, manually_corrected: true } : l
      )
    )
  }

  const updateJournal = (index: number, journalCode: string) => {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, journal_code: journalCode, isEdited: true } : l))
    )
  }

  const handleValidate = async () => {
    setSaving(true)
    const res = await authFetch(`/api/invoices/${invoiceId}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: lines.map((l) => ({
          id: l.id, pcg_code: l.pcg_code, pcg_label: l.pcg_label,
          journal_code: l.journal_code, manually_corrected: l.manually_corrected,
        })),
      }),
    })
    if (res.ok) await fetchInvoice()
    setSaving(false)
  }

  const handleAnnotate = async () => {
    setAnnotating(true)
    const res = await authFetch(`/api/invoices/${invoiceId}/annotate`, { method: 'POST' })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `annotated_${invoice?.file_name || 'facture.pdf'}`
      a.click()
      URL.revokeObjectURL(url)
    }
    setAnnotating(false)
  }

  const formatAmount = (amount: number | null) => {
    if (amount == null) return '-'
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
  }

  const lowConfidenceLines = lines.filter((l) => l.confidence_score != null && l.confidence_score < 0.85)

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary-600" /></div>
  }

  if (!invoice) {
    return <div className="text-center text-gray-500">Facture non trouvée</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/invoices')} className="btn-secondary p-2"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{invoice.file_name}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
              {invoice.supplier_name && <span>Fournisseur : {invoice.supplier_name}</span>}
              {invoice.invoice_number && <span>N° {invoice.invoice_number}</span>}
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === 'classified' && (
            <button onClick={handleValidate} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Valider
            </button>
          )}
          {(invoice.status === 'validated' || invoice.status === 'exported') && invoice.file_type === 'application/pdf' && (
            <button onClick={handleAnnotate} disabled={annotating} className="btn-secondary">
              {annotating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              PDF annoté
            </button>
          )}
        </div>
      </div>

      {lowConfidenceLines.length > 0 && invoice.status === 'classified' && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-600" />
          <div>
            <p className="text-sm font-medium text-yellow-800">
              {lowConfidenceLines.length} ligne{lowConfidenceLines.length > 1 ? 's' : ''} avec confiance faible ({`<`}85%)
            </p>
            <p className="mt-1 text-xs text-yellow-700">Vérifiez et corrigez les codes PCG surlignés avant de valider.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card h-[700px] overflow-hidden p-0">
          {fileUrl ? (
            invoice.file_type === 'application/pdf' ? (
              <iframe src={fileUrl} className="h-full w-full" title="Aperçu facture" />
            ) : (
              <img src={fileUrl} alt="Facture" className="h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400"><FileText className="h-16 w-16" /></div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Résumé</h3>
            <div className="grid grid-cols-3 gap-4">
              <div><p className="text-xs text-gray-500">Total HT</p><p className="text-lg font-bold text-gray-900">{formatAmount(invoice.total_ht)}</p></div>
              <div><p className="text-xs text-gray-500">TVA</p><p className="text-lg font-bold text-gray-900">{formatAmount(invoice.total_tva)}</p></div>
              <div><p className="text-xs text-gray-500">Total TTC</p><p className="text-lg font-bold text-primary-600">{formatAmount(invoice.total_ttc)}</p></div>
            </div>
          </div>

          <div className="card max-h-[550px] overflow-y-auto p-0">
            <div className="sticky top-0 border-b border-gray-200 bg-white px-4 py-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Lignes de facturation ({lines.length})</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {lines.map((line, index) => {
                const isLowConfidence = line.confidence_score != null && line.confidence_score < 0.85
                return (
                  <div key={line.id || index} className={`space-y-2 p-4 ${isLowConfidence ? 'bg-yellow-50' : ''}`}>
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-gray-900">{line.description}</p>
                      <div className="flex items-center gap-2">
                        <ConfidenceBadge score={line.confidence_score} />
                        <span className="text-sm font-bold text-gray-900">{formatAmount(line.total_ht)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {line.quantity && <span>Qté : {line.quantity}</span>}
                      {line.unit_price && <span>PU : {formatAmount(line.unit_price)}</span>}
                      {line.tva_rate && <span>TVA : {line.tva_rate}%</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <PCGSelector accounts={pcgAccounts} value={line.pcg_code} onChange={(code, label) => updateLine(index, code, label)} />
                      </div>
                      <select value={line.journal_code || 'AC'} onChange={(e) => updateJournal(index, e.target.value)} className="input-field w-24">
                        <option value="AC">AC</option>
                        <option value="VE">VE</option>
                        <option value="BQ">BQ</option>
                        <option value="OD">OD</option>
                      </select>
                    </div>
                    {line.isEdited && (
                      <div className="flex items-center gap-1 text-xs text-primary-600"><Save className="h-3 w-3" />Modifié</div>
                    )}
                  </div>
                )
              })}
              {lines.length === 0 && <div className="p-8 text-center text-sm text-gray-500">Aucune ligne extraite</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
