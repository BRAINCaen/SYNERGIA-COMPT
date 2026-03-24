'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import { StatusBadge, ConfidenceBadge } from '@/components/ui/Badge'
import PCGSelector from './PCGSelector'
import {
  CheckCircle, Download, ArrowLeft, FileText, Loader2, Save, AlertTriangle, Trash2, Pencil, Zap, Package,
} from 'lucide-react'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
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
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Supplier auto-classify
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [autoClassify, setAutoClassify] = useState(false)
  const [togglingAutoClassify, setTogglingAutoClassify] = useState(false)

  // Editable amounts
  const [editingField, setEditingField] = useState<'total_ht' | 'total_tva' | 'total_ttc' | null>(null)
  const [editAmounts, setEditAmounts] = useState<{ total_ht: number | null; total_tva: number | null; total_ttc: number | null }>({
    total_ht: null, total_tva: null, total_ttc: null,
  })
  const [amountsModified, setAmountsModified] = useState(false)
  const [savingAmounts, setSavingAmounts] = useState(false)

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
      setEditAmounts({
        total_ht: data.total_ht,
        total_tva: data.total_tva,
        total_ttc: data.total_ttc,
      })
      setAmountsModified(false)

      if (data.supplier_name) {
        fetchSupplier(data.supplier_name)
      }
    }
    setLoading(false)
  }

  const fetchSupplier = async (supplierName: string) => {
    try {
      const res = await authFetch('/api/suppliers')
      if (res.ok) {
        const suppliers = await res.json()
        const match = suppliers.find(
          (s: { name: string }) => s.name.toLowerCase() === supplierName.toLowerCase()
        )
        if (match) {
          setSupplierId(match.id)
          setAutoClassify(match.auto_classify || false)
        }
      }
    } catch {
      // Ignore
    }
  }

  const toggleAutoClassify = async () => {
    if (!supplierId) return
    setTogglingAutoClassify(true)
    try {
      const newValue = !autoClassify
      const res = await authFetch(`/api/suppliers/${supplierId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_classify: newValue }),
      })
      if (res.ok) {
        setAutoClassify(newValue)
      }
    } catch {
      // Ignore
    }
    setTogglingAutoClassify(false)
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

  const toggleImmobilization = (index: number) => {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, is_immobilization: !l.is_immobilization, isEdited: true } : l))
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
    if (res.ok) {
      await fetchInvoice()
      // Auto-generate annotated PDF on validation
      handleAnnotate()
    }
    setSaving(false)
  }

  const handleAnnotate = async () => {
    if (!fileUrl || !invoice) return
    setAnnotating(true)
    try {
      // Use proxy to avoid CORS issues with Firebase Storage
      const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(fileUrl)}`
      const pdfRes = await authFetch(proxyUrl)
      if (!pdfRes.ok) throw new Error('Failed to download PDF')
      const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())
      const pdfDoc = await PDFDocument.load(pdfBytes)

      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
      const courier = await pdfDoc.embedFont(StandardFonts.Courier)

      const GREEN = rgb(0, 200/255, 150/255)
      const DARK = rgb(13/255, 17/255, 23/255)
      const CARD = rgb(22/255, 27/255, 34/255)
      const ORANGE = rgb(255/255, 140/255, 66/255)
      const RED = rgb(255/255, 59/255, 48/255)
      const WHITE = rgb(1, 1, 1)
      const GRAY = rgb(0.5, 0.5, 0.5)
      const GRAY_L = rgb(0.7, 0.7, 0.7)

      const confColor = (s: number | null) => {
        if (s == null) return GRAY
        if (s >= 0.85) return GREEN
        if (s >= 0.65) return ORANGE
        return RED
      }
      const confLabel = (s: number | null) => s == null ? '--' : `${Math.round(s * 100)}%`
      const trunc = (t: string, m: number) => t.length <= m ? t : t.substring(0, m - 3) + '...'

      // ========== ANNOTATE ORIGINAL PAGES ==========
      // Add a dark banner at the bottom of every original page with classification info
      const existingPages = pdfDoc.getPages()
      const bannerH = 14 + lines.filter(l => l.pcg_code).length * 13

      for (const origPage of existingPages) {
        const { width: pw } = origPage.getSize()
        const bh = Math.min(bannerH, 120) // cap banner height

        // Semi-transparent dark banner at bottom
        origPage.drawRectangle({ x: 0, y: 0, width: pw, height: bh + 5, color: DARK, opacity: 0.92 })
        origPage.drawRectangle({ x: 0, y: bh + 5, width: pw, height: 2, color: GREEN })

        // Header line
        origPage.drawText('SYNERGIA-COMPT | Ventilation comptable BOEHME', {
          x: 8, y: bh - 8, size: 7, font: helveticaBold, color: GREEN,
        })
        origPage.drawText(`${invoice.file_name} — ${new Date().toLocaleDateString('fr-FR')}`, {
          x: pw - 200, y: bh - 8, size: 6, font: helvetica, color: GRAY_L,
        })

        // Each line classification
        let ly = bh - 22
        for (const ln of lines) {
          if (!ln.pcg_code || ly < 5) continue
          const cc = confColor(ln.confidence_score)

          // Color indicator bar
          origPage.drawRectangle({ x: 8, y: ly - 1, width: 3, height: 10, color: cc })

          // Account code
          origPage.drawText(ln.pcg_code, { x: 14, y: ly, size: 7, font: courier, color: GREEN })

          // Label
          origPage.drawText(trunc(ln.pcg_label || '', 30), { x: 75, y: ly, size: 6.5, font: helvetica, color: WHITE })

          // Description
          origPage.drawText(trunc(ln.description || '', 25), { x: 215, y: ly, size: 6, font: helvetica, color: GRAY_L })

          // Amount
          if (ln.total_ht != null) {
            origPage.drawText(`${ln.total_ht.toFixed(2)} EUR HT`, { x: 355, y: ly, size: 6.5, font: courier, color: WHITE })
          }

          // Confidence
          origPage.drawText(confLabel(ln.confidence_score), { x: 440, y: ly, size: 6.5, font: courier, color: cc })

          // Journal
          if (ln.journal_code) {
            origPage.drawText(ln.journal_code, { x: 475, y: ly, size: 6, font: helvetica, color: GRAY })
          }

          // IMMO flag
          if (ln.is_immobilization) {
            origPage.drawText('IMMO', { x: pw - 35, y: ly, size: 6, font: helveticaBold, color: ORANGE })
          }

          // Reasoning
          if (ln.reasoning) {
            ly -= 10
            if (ly >= 5) {
              origPage.drawText(`Motif: ${trunc(ln.reasoning, 80)}`, { x: 14, y: ly, size: 5.5, font: helveticaOblique, color: GRAY })
            }
          }

          ly -= 13
        }
      }

      // ========== SUMMARY PAGE ==========
      const page = pdfDoc.addPage()
      const { width: w, height: h } = page.getSize()

      page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: DARK })
      page.drawRectangle({ x: 0, y: h - 70, width: w, height: 70, color: CARD })
      page.drawRectangle({ x: 0, y: h - 3, width: w, height: 3, color: GREEN })

      page.drawText('VENTILATION COMPTABLE -- BOEHME', {
        x: 50, y: h - 30, size: 16, font: helveticaBold, color: GREEN,
      })
      page.drawText('SYNERGIA-COMPT | B.R.A.I.N. Escape & Quiz Game', {
        x: 50, y: h - 48, size: 9, font: helvetica, color: GRAY_L,
      })
      page.drawText(`Annote le ${new Date().toLocaleDateString('fr-FR')}`, {
        x: w - 180, y: h - 40, size: 9, font: helvetica, color: GRAY,
      })

      // Invoice info block
      page.drawRectangle({ x: 40, y: h - 100, width: w - 80, height: 25, color: CARD })
      page.drawText(`Facture: ${invoice.file_name}`, { x: 50, y: h - 90, size: 8, font: helveticaBold, color: WHITE })
      page.drawText(`Fournisseur: ${invoice.supplier_name || '--'}`, { x: 250, y: h - 90, size: 8, font: helvetica, color: GRAY_L })
      if (invoice.invoice_number) page.drawText(`N: ${invoice.invoice_number}`, { x: 450, y: h - 90, size: 8, font: helvetica, color: GRAY })

      // Legend
      const legendY = h - 115
      page.drawText('Confiance :', { x: 50, y: legendY, size: 7, font: helveticaBold, color: GRAY_L })
      let lx = 105
      for (const [label, col] of [['>=85%', GREEN], ['65-84%', ORANGE], ['<65%', RED]] as const) {
        page.drawRectangle({ x: lx, y: legendY - 1, width: 8, height: 8, color: col })
        page.drawText(label, { x: lx + 11, y: legendY, size: 7, font: helvetica, color: GRAY_L })
        lx += 50
      }

      // Table headers
      let y = h - 135
      const cols = { num: 50, conf: 68, code: 100, label: 175, desc: 310, amount: 440, jnl: 510 }
      page.drawRectangle({ x: 40, y: y - 5, width: w - 80, height: 20, color: CARD })
      for (const [text, cx] of [['#', cols.num], ['Conf.', cols.conf], ['Compte', cols.code], ['Libelle', cols.label], ['Description', cols.desc], ['HT', cols.amount], ['Jnl', cols.jnl]] as const) {
        page.drawText(text as string, { x: cx as number, y, size: 7, font: helveticaBold, color: GREEN })
      }
      y -= 25

      // Rows with reasoning
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i]
        if (!ln.pcg_code || y < 60) continue
        const cc = confColor(ln.confidence_score)
        const rh = ln.reasoning ? 32 : 18

        if (i % 2 === 0) page.drawRectangle({ x: 40, y: y - 5, width: w - 80, height: rh, color: CARD })
        page.drawRectangle({ x: 40, y: y - 5, width: 3, height: rh, color: cc })

        page.drawText(`${i + 1}`, { x: cols.num, y, size: 7, font: helvetica, color: GRAY })
        page.drawText(confLabel(ln.confidence_score), { x: cols.conf, y, size: 7, font: courier, color: cc })
        page.drawText(ln.pcg_code, { x: cols.code, y, size: 8, font: courier, color: GREEN })
        page.drawText(trunc(ln.pcg_label || '', 24), { x: cols.label, y, size: 7, font: helvetica, color: GRAY_L })
        page.drawText(trunc(ln.description || '', 22), { x: cols.desc, y, size: 7, font: helvetica, color: WHITE })
        if (ln.total_ht != null) page.drawText(`${ln.total_ht.toFixed(2)} EUR`, { x: cols.amount, y, size: 7, font: courier, color: WHITE })
        if (ln.journal_code) page.drawText(ln.journal_code, { x: cols.jnl, y, size: 7, font: helvetica, color: GRAY })
        if (ln.is_immobilization) page.drawText('IMMO', { x: w - 70, y, size: 6, font: helveticaBold, color: ORANGE })

        y -= 15
        if (ln.reasoning) {
          page.drawText(`Motif: ${trunc(ln.reasoning, 85)}`, { x: cols.code, y, size: 6, font: helveticaOblique, color: GRAY })
          y -= 14
        }
        y -= 3
      }

      // Total
      if (y > 70) {
        page.drawLine({ start: { x: 40, y: y }, end: { x: w - 40, y: y }, thickness: 0.5, color: rgb(48/255, 54/255, 61/255) })
        const totalHT = lines.reduce((s, l) => s + (l.total_ht || 0), 0)
        const totalTTC = lines.reduce((s, l) => s + (l.total_ttc || 0), 0)
        page.drawText(`TOTAL HT: ${totalHT.toFixed(2)} EUR`, { x: cols.amount - 60, y: y - 15, size: 9, font: helveticaBold, color: GREEN })
        page.drawText(`TOTAL TTC: ${totalTTC.toFixed(2)} EUR`, { x: cols.amount - 60, y: y - 28, size: 8, font: helvetica, color: GRAY_L })
      }

      // Footer
      page.drawLine({ start: { x: 40, y: 45 }, end: { x: w - 40, y: 45 }, thickness: 0.5, color: rgb(48/255, 54/255, 61/255) })
      page.drawText('SYNERGIA-COMPT -- SARL BOEHME (B.R.A.I.N.) -- Classification IA validee', {
        x: 50, y: 30, size: 7, font: helveticaOblique, color: GRAY,
      })

      const resultBytes = await pdfDoc.save()
      const blob = new Blob([resultBytes as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `annotated_${invoice.file_name || 'facture.pdf'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Annotation error:', error)
    }
    setAnnotating(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await authFetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
      if (res.ok) {
        router.push('/invoices')
      }
    } catch (e) {
      console.error('Delete error:', e)
    }
    setDeleting(false)
    setShowDeleteConfirm(false)
  }

  const handleSaveAmounts = async () => {
    setSavingAmounts(true)
    try {
      const res = await authFetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          total_ht: editAmounts.total_ht,
          total_tva: editAmounts.total_tva,
          total_ttc: editAmounts.total_ttc,
        }),
      })
      if (res.ok) {
        setInvoice((prev) => prev ? {
          ...prev,
          total_ht: editAmounts.total_ht,
          total_tva: editAmounts.total_tva,
          total_ttc: editAmounts.total_ttc,
        } : prev)
        setAmountsModified(false)
        setEditingField(null)
      }
    } catch (e) {
      console.error('Save amounts error:', e)
    }
    setSavingAmounts(false)
  }

  const handleAmountChange = (field: 'total_ht' | 'total_tva' | 'total_ttc', value: string) => {
    const parsed = value === '' ? null : parseFloat(value.replace(',', '.'))
    setEditAmounts((prev) => ({ ...prev, [field]: parsed }))
    setAmountsModified(true)
  }

  const startEditing = (field: 'total_ht' | 'total_tva' | 'total_ttc') => {
    setEditingField(field)
  }

  const stopEditing = () => {
    setEditingField(null)
  }

  const formatAmount = (amount: number | null) => {
    if (amount == null) return '-'
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
  }

  const lowConfidenceLines = lines.filter((l) => l.confidence_score != null && l.confidence_score < 0.85)

  if (loading) {
    return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent-green" /></div>
  }

  if (!invoice) {
    return <div className="text-center text-gray-500">Facture non trouvee</div>
  }

  const renderAmountField = (label: string, field: 'total_ht' | 'total_tva' | 'total_ttc', colorClass: string) => {
    const isEditing = editingField === field
    const value = editAmounts[field]

    return (
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        {isEditing ? (
          <div className="mt-1">
            <input
              type="text"
              autoFocus
              value={value != null ? String(value) : ''}
              onChange={(e) => handleAmountChange(field, e.target.value)}
              onBlur={stopEditing}
              onKeyDown={(e) => {
                if (e.key === 'Enter') stopEditing()
                if (e.key === 'Escape') {
                  setEditAmounts((prev) => ({ ...prev, [field]: invoice[field] }))
                  setEditingField(null)
                }
              }}
              className="w-full rounded-lg border border-accent-green/50 bg-dark-input px-2 py-1 text-lg font-bold font-mono text-white focus:border-accent-green focus:outline-none focus:ring-1 focus:ring-accent-green/50"
              placeholder="0.00"
            />
          </div>
        ) : (
          <div
            className="group flex items-center gap-1 cursor-pointer"
            onClick={() => startEditing(field)}
            title="Cliquer pour modifier"
          >
            <p className={`text-lg font-bold font-mono ${colorClass}`}>{formatAmount(value)}</p>
            <Pencil className="h-3 w-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/invoices')} className="btn-secondary p-2"><ArrowLeft className="h-4 w-4" /></button>
          <div>
            <h1 className="text-xl font-bold text-white">{invoice.file_name}</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
              {invoice.supplier_name && <span>Fournisseur : <span className="text-gray-300">{invoice.supplier_name}</span></span>}
              {invoice.invoice_number && <span className="font-mono">N deg {invoice.invoice_number}</span>}
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-accent-red/30 bg-dark-card px-3 py-2 text-sm font-medium text-accent-red hover:bg-accent-red/10 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </button>
          {invoice.status === 'classified' && (
            <button onClick={handleValidate} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Valider
            </button>
          )}
          {(invoice.status === 'validated' || invoice.status === 'exported') && invoice.file_type === 'application/pdf' && (
            <button onClick={handleAnnotate} disabled={annotating} className="btn-secondary">
              {annotating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              PDF annote
            </button>
          )}
        </div>
      </div>

      {lowConfidenceLines.length > 0 && invoice.status === 'classified' && (
        <div className="flex items-start gap-3 rounded-lg border border-accent-orange/30 bg-accent-orange/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-accent-orange" />
          <div>
            <p className="text-sm font-medium text-accent-orange">
              {lowConfidenceLines.length} ligne{lowConfidenceLines.length > 1 ? 's' : ''} avec confiance faible ({`<`}85%)
            </p>
            <p className="mt-1 text-xs text-gray-400">Verifiez et corrigez les codes PCG surlignes avant de valider.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card h-[700px] overflow-hidden p-0">
          {fileUrl ? (
            invoice.file_type === 'application/pdf' ? (
              <iframe src={fileUrl} className="h-full w-full rounded-xl" title="Apercu facture" />
            ) : (
              <img src={fileUrl} alt="Facture" className="h-full w-full object-contain" />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-gray-600"><FileText className="h-16 w-16" /></div>
          )}
        </div>

        <div className="space-y-4">
          {/* Supplier auto-classify toggle */}
          {invoice.supplier_name && supplierId && (invoice.status === 'validated' || invoice.status === 'classified' || invoice.status === 'exported') && (
            <div className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${
              autoClassify ? 'border-accent-green/30 bg-accent-green/5' : 'border-dark-border bg-dark-card'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  autoClassify ? 'bg-accent-green/10' : 'bg-dark-input'
                }`}>
                  <Zap className={`h-5 w-5 ${autoClassify ? 'text-accent-green' : 'text-gray-500'}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-200">
                    {autoClassify ? 'Fournisseur memorise' : 'Memoriser ce fournisseur ?'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {autoClassify
                      ? `Les prochaines factures de "${invoice.supplier_name}" seront classifiees automatiquement`
                      : `Classifier automatiquement les futures factures de "${invoice.supplier_name}"`}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleAutoClassify}
                disabled={togglingAutoClassify}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent-green/50 focus:ring-offset-2 focus:ring-offset-dark-bg ${
                  autoClassify ? 'bg-accent-green' : 'bg-dark-border'
                } ${togglingAutoClassify ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                  autoClassify ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          )}

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Resume</h3>
              {amountsModified && (
                <button
                  onClick={handleSaveAmounts}
                  disabled={savingAmounts}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-green px-3 py-1.5 text-xs font-medium text-dark-bg hover:bg-accent-green/90 transition-colors disabled:opacity-50"
                >
                  {savingAmounts ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Save className="h-3 w-3" />
                  )}
                  Enregistrer les montants
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {renderAmountField('Total HT', 'total_ht', 'text-gray-200')}
              {renderAmountField('TVA', 'total_tva', 'text-gray-200')}
              {renderAmountField('Total TTC', 'total_ttc', 'text-accent-green')}
            </div>
          </div>

          <div className="card max-h-[550px] overflow-y-auto p-0">
            <div className="sticky top-0 border-b border-dark-border bg-dark-card px-4 py-3 rounded-t-xl">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Lignes de facturation ({lines.length})</h3>
            </div>
            <div className="divide-y divide-dark-border">
              {lines.map((line, index) => {
                const isLowConfidence = line.confidence_score != null && line.confidence_score < 0.85
                return (
                  <div key={line.id || index} className={`space-y-2 p-4 ${isLowConfidence ? 'bg-accent-orange/5' : ''}`}>
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-gray-200">{line.description}</p>
                      <div className="flex items-center gap-2">
                        <ConfidenceBadge score={line.confidence_score} />
                        <span className="text-sm font-bold font-mono text-gray-200">{formatAmount(line.total_ht)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 font-mono">
                      {line.quantity && <span>Qte : {line.quantity}</span>}
                      {line.unit_price && <span>PU : {formatAmount(line.unit_price)}</span>}
                      {line.tva_rate && <span>TVA : {line.tva_rate}%</span>}
                      {line.classification_method && (
                        <span className={`flex items-center gap-1 ${
                          line.classification_method === 'known_supplier' ? 'text-accent-green' : 'text-accent-blue'
                        }`}>
                          {line.classification_method === 'known_supplier' ? <Zap className="h-3 w-3" /> : null}
                          {line.classification_method === 'known_supplier' ? 'Fournisseur connu' : line.classification_method === 'ai' ? 'IA' : 'Manuel'}
                        </span>
                      )}
                    </div>
                    {(line as EditableLine).reasoning && (
                      <p className="text-xs italic text-gray-500 bg-dark-input rounded px-2 py-1">
                        {(line as EditableLine).reasoning}
                      </p>
                    )}
                    {/* Immobilization indicator */}
                    {line.is_immobilization && (
                      <div className="flex items-center gap-2 text-xs rounded-lg bg-accent-blue/10 border border-accent-blue/30 px-2 py-1.5">
                        <Package className="h-3.5 w-3.5 text-accent-blue" />
                        <span className="text-accent-blue font-medium">
                          Immobilisation{line.amortization_rate ? ` — Amort. ${line.amortization_rate}%` : ''}
                        </span>
                      </div>
                    )}
                    {/* Immobilization toggle for high-value items */}
                    {line.total_ht >= 500 && (
                      <button
                        onClick={() => toggleImmobilization(index)}
                        className={`flex items-center gap-1.5 text-xs rounded-lg px-2 py-1 transition-colors ${
                          line.is_immobilization
                            ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                            : 'bg-dark-input text-gray-500 border border-dark-border hover:border-accent-blue/30'
                        }`}
                      >
                        <Package className="h-3 w-3" />
                        {line.is_immobilization ? 'Immobilisation' : 'Marquer comme immobilisation ?'}
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <PCGSelector accounts={pcgAccounts} value={line.pcg_code} onChange={(code, label) => updateLine(index, code, label)} />
                      </div>
                      <select value={line.journal_code || 'AC'} onChange={(e) => updateJournal(index, e.target.value)} className="input-field w-24 font-mono">
                        <option value="AC">AC</option>
                        <option value="VE">VE</option>
                        <option value="BQ">BQ</option>
                        <option value="OD">OD</option>
                      </select>
                    </div>
                    {line.isEdited && (
                      <div className="flex items-center gap-1 text-xs text-accent-green"><Save className="h-3 w-3" />Modifie</div>
                    )}
                  </div>
                )
              })}
              {lines.length === 0 && <div className="p-8 text-center text-sm text-gray-500">Aucune ligne extraite</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-dark-card border border-dark-border p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-red/10">
                <Trash2 className="h-5 w-5 text-accent-red" />
              </div>
              <h3 className="text-lg font-semibold text-white">Supprimer cette facture</h3>
            </div>
            <p className="text-sm text-gray-400 mb-6">
              Voulez-vous vraiment supprimer la facture <strong className="text-gray-200">{invoice.file_name}</strong> ? Cette action est irreversible.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn-danger flex items-center gap-2"
              >
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
