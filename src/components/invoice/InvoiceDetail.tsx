'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import { StatusBadge, ConfidenceBadge } from '@/components/ui/Badge'
import PCGSelector from './PCGSelector'
import {
  CheckCircle, Download, ArrowLeft, FileText, Loader2, Save, AlertTriangle, Trash2, Pencil, Zap, Package, Landmark, Link, Search, X, Lightbulb, ChevronLeft, ChevronRight,
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
  const [editingName, setEditingName] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [altLineIdx, setAltLineIdx] = useState<number | null>(null)
  const [altLoading, setAltLoading] = useState(false)
  const [alternatives, setAlternatives] = useState<Array<{ pcg_code: string; pcg_label: string; journal_code: string; confidence: number; reasoning: string }>>([])
  const [allInvoiceIds, setAllInvoiceIds] = useState<string[]>([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showBankMatch, setShowBankMatch] = useState(false)
  const [bankTransactions, setBankTransactions] = useState<any[]>([])
  const [bankSearching, setBankSearching] = useState(false)
  const [bankMatched, setBankMatched] = useState<string | null>(null)
  const [bankMatchCount, setBankMatchCount] = useState(0)
  const [matchedTxDetails, setMatchedTxDetails] = useState<any[]>([])
  const [selectedBankTxIds, setSelectedBankTxIds] = useState<string[]>([])
  const [bankMatching, setBankMatching] = useState(false)

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
  const { user } = useAuth()
  const authFetch = useAuthFetch()

  useEffect(() => {
    if (user) fetchInvoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, user])

  // Load all invoice IDs for prev/next navigation (sorted by date desc, same as list)
  useEffect(() => {
    if (!user) return
    const loadIds = async () => {
      try {
        const res = await authFetch('/api/invoices')
        if (res.ok) {
          const data = await res.json()
          // Same sort as InvoiceList: by invoice_date or created_at desc
          const sorted = [...data].sort((a: { invoice_date?: string; created_at?: string }, b: { invoice_date?: string; created_at?: string }) => {
            const da = new Date(a.invoice_date || a.created_at || 0).getTime()
            const db = new Date(b.invoice_date || b.created_at || 0).getTime()
            return db - da
          })
          setAllInvoiceIds(sorted.map((inv: { id: string }) => inv.id))
        }
      } catch { /* */ }
    }
    loadIds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const currentIdx = allInvoiceIds.indexOf(invoiceId)
  const prevId = currentIdx > 0 ? allInvoiceIds[currentIdx - 1] : null
  const nextId = currentIdx >= 0 && currentIdx < allInvoiceIds.length - 1 ? allInvoiceIds[currentIdx + 1] : null

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

      // Check how many bank transactions are matched to this invoice
      try {
        const txRes = await authFetch('/api/bank-statements/transactions?match_status=matched')
        if (txRes.ok) {
          const txData = await txRes.json()
          const txs = txData.transactions || txData || []
          const matchedTxs = txs.filter((tx: any) => tx.matched_invoice_id === invoiceId)
          setBankMatchCount(matchedTxs.length)
          setMatchedTxDetails(matchedTxs)
          if (matchedTxs.length > 0) setBankMatched('existing')
        }
      } catch { /* non-blocking */ }

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
          <button onClick={() => router.push('/invoices')} className="btn-secondary p-2" title="Retour a la liste"><ArrowLeft className="h-4 w-4" /></button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => prevId && router.push(`/invoices/${prevId}`)}
              disabled={!prevId}
              className="rounded-lg border border-dark-border p-2 text-gray-400 hover:bg-dark-hover hover:text-accent-green disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Facture precedente"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {allInvoiceIds.length > 0 && currentIdx >= 0 && (
              <span className="px-2 text-xs font-mono text-gray-500">
                {currentIdx + 1} / {allInvoiceIds.length}
              </span>
            )}
            <button
              onClick={() => nextId && router.push(`/invoices/${nextId}`)}
              disabled={!nextId}
              className="rounded-lg border border-dark-border p-2 text-gray-400 hover:bg-dark-hover hover:text-accent-green disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Facture suivante"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  autoFocus
                  className="flex-1 rounded-lg border border-accent-green/50 bg-dark-input px-3 py-1.5 text-xl font-bold text-white focus:border-accent-green focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (async () => {
                        if (!newFileName.trim() || newFileName === invoice.file_name) { setEditingName(false); return }
                        setRenaming(true)
                        try {
                          const res = await authFetch(`/api/invoices/${invoiceId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ file_name: newFileName.trim() }),
                          })
                          if (res.ok) {
                            setInvoice((prev) => prev ? { ...prev, file_name: newFileName.trim() } : prev)
                            setEditingName(false)
                          }
                        } catch {}
                        setRenaming(false)
                      })()
                    } else if (e.key === 'Escape') {
                      setEditingName(false)
                    }
                  }}
                />
                <button
                  onClick={async () => {
                    if (!newFileName.trim() || newFileName === invoice.file_name) { setEditingName(false); return }
                    setRenaming(true)
                    try {
                      const res = await authFetch(`/api/invoices/${invoiceId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file_name: newFileName.trim() }),
                      })
                      if (res.ok) {
                        setInvoice((prev) => prev ? { ...prev, file_name: newFileName.trim() } : prev)
                        setEditingName(false)
                      }
                    } catch {}
                    setRenaming(false)
                  }}
                  disabled={renaming}
                  className="rounded-lg bg-accent-green px-3 py-1.5 text-sm font-semibold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50"
                >
                  {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="rounded-lg border border-dark-border px-3 py-1.5 text-sm text-gray-400 hover:bg-dark-hover"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h1 className="truncate text-xl font-bold text-white">{invoice.file_name}</h1>
                <button
                  onClick={() => { setNewFileName(invoice.file_name); setEditingName(true) }}
                  className="shrink-0 rounded-lg p-1.5 text-gray-500 opacity-0 transition-opacity hover:bg-dark-hover hover:text-accent-green group-hover:opacity-100"
                  title="Renommer la facture"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
              {invoice.supplier_name && <span>Fournisseur : <span className="text-gray-300">{invoice.supplier_name}</span></span>}
              {invoice.invoice_number && <span className="font-mono">N deg {invoice.invoice_number}</span>}
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              if (!invoice?.file_path) { alert('Pas de fichier PDF associe'); return }
              if (!confirm('Relancer l\'extraction IA et la classification ? Les lignes existantes seront remplacees.')) return
              setSaving(true)
              try {
                // Download PDF via proxy
                const pdfRes = await authFetch(`/api/proxy-pdf?path=${encodeURIComponent(invoice.file_path)}`)
                if (!pdfRes.ok) throw new Error('Telechargement PDF echoue')
                const pdfBlob = await pdfRes.blob()

                // Extract with AI
                const form = new FormData()
                form.append('file', new File([pdfBlob], invoice.file_name || 'document.pdf', { type: 'application/pdf' }))
                const extractRes = await authFetch('/api/invoices/extract', { method: 'POST', body: form })
                if (!extractRes.ok) throw new Error('Erreur extraction IA')
                const { data: extraction } = await extractRes.json()

                // Update invoice data
                await authFetch(`/api/invoices/${invoiceId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    document_type: extraction.document_type || 'expense',
                    is_credit_note: extraction.is_credit_note || false,
                    supplier_name: extraction.supplier?.name,
                    supplier_siret: extraction.supplier?.siret || null,
                    invoice_number: extraction.invoice?.number || null,
                    invoice_date: extraction.invoice?.date || null,
                    due_date: extraction.invoice?.due_date || null,
                    currency: extraction.invoice?.currency || 'EUR',
                    total_ht: extraction.totals?.total_ht || null,
                    total_tva: extraction.totals?.total_tva || null,
                    total_ttc: extraction.totals?.total_ttc || null,
                    raw_extraction: extraction,
                    status: 'processing',
                  }),
                })

                // Classify lines with AI
                if (extraction.lines?.length > 0) {
                  const classifyRes = await authFetch('/api/invoices/classify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      lines: extraction.lines,
                      supplier_name: extraction.supplier?.name || 'Inconnu',
                    }),
                  })

                  if (classifyRes.ok) {
                    const { classifications } = await classifyRes.json()
                    const newLines = extraction.lines.map((line: { description?: string; quantity?: number; unit_price?: number; total_ht?: number; tva_rate?: number; tva_amount?: number; total_ttc?: number }, i: number) => {
                      const c = classifications?.find((cl: { line_index: number }) => cl.line_index === i)
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

                    // Save lines
                    await authFetch(`/api/invoices/${invoiceId}/lines`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ lines: newLines }),
                    })

                    await authFetch(`/api/invoices/${invoiceId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'classified' }),
                    })
                  }
                }

                await fetchInvoice()
              } catch (e) {
                alert(`Erreur : ${e instanceof Error ? e.message : 'inconnue'}`)
              }
              setSaving(false)
            }}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-accent-orange/50 bg-dark-card px-3 py-2 text-sm font-medium text-accent-orange hover:bg-accent-orange/10 transition-colors disabled:opacity-50"
            title="Relancer l'extraction IA (recupere les lignes de facturation)"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Rescanner
          </button>
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
          <button
            onClick={async () => {
              if (showBankMatch) {
                setShowBankMatch(false)
                return
              }
              setShowBankMatch(true)
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
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              bankMatched
                ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                : 'border-accent-green/30 bg-dark-card text-accent-green hover:bg-accent-green/10'
            }`}
          >
            <Landmark className="h-4 w-4" />
            {bankMatchCount > 0 ? `Rapproche (${bankMatchCount}) +` : 'Rapprocher'}
          </button>
        </div>
      </div>

      {/* Bank match details */}
      {matchedTxDetails.length > 0 && !showBankMatch && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-accent-green" />
              <span className="text-sm font-semibold text-accent-green">
                {matchedTxDetails.length} transaction(s) rapprochee(s)
              </span>
            </div>
            <span className="text-xs text-gray-500">Cliquez &quot;Rapprocher +&quot; pour en ajouter</span>
          </div>
          <div className="space-y-1">
            {matchedTxDetails.map((tx: any) => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-accent-green/20 bg-accent-green/5 px-3 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-gray-400 shrink-0">
                    {tx.date ? new Date(tx.date).toLocaleDateString('fr-FR') : '-'}
                  </span>
                  <span className="text-sm text-gray-200 truncate">{tx.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-mono text-sm font-medium ${tx.type === 'debit' ? 'text-accent-red' : 'text-accent-green'}`}>
                    {(tx.amount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                  </span>
                  <button
                    onClick={async () => {
                      if (!confirm('Annuler ce rapprochement ?')) return
                      try {
                        await authFetch(`/api/bank-statements/${tx.statement_id}/match`, {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ transaction_id: tx.id }),
                        })
                        setMatchedTxDetails(prev => prev.filter(t => t.id !== tx.id))
                        setBankMatchCount(prev => prev - 1)
                      } catch (e) { console.error('Unmatch error:', e) }
                    }}
                    className="rounded p-1 text-gray-500 hover:bg-accent-red/10 hover:text-accent-red transition-colors"
                    title="Annuler ce rapprochement"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bank match section */}
      {showBankMatch && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Rapprochement bancaire</h3>
            <button onClick={() => setShowBankMatch(false)} className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-200">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>

          {bankSearching ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent-green" />
            </div>
          ) : (() => {
            const bankSearch = (document.getElementById('bank-match-search') as HTMLInputElement)?.value?.toLowerCase() || ''
            const ttc = invoice?.total_ttc || 0
            // All target amounts: total TTC + each line amount (total_ht, total_ttc)
            const targetAmounts: { label: string; amount: number }[] = [
              { label: `Total TTC`, amount: ttc },
            ]
            for (const ln of lines) {
              if (ln.total_ht && ln.total_ht > 0) {
                targetAmounts.push({ label: ln.description?.substring(0, 30) || `Ligne`, amount: ln.total_ht })
              }
              if (ln.total_ttc && ln.total_ttc > 0 && ln.total_ttc !== ln.total_ht) {
                targetAmounts.push({ label: `${(ln.description || 'Ligne').substring(0, 25)} TTC`, amount: ln.total_ttc })
              }
            }
            const allAmounts = targetAmounts.map(t => t.amount)

            const matchingTx = bankTransactions
              .filter((tx: any) => allAmounts.some(a => Math.abs(tx.amount - a) <= 0.01))
              .sort((a: any, b: any) => {
                const aDist = Math.min(...allAmounts.map(am => Math.abs(a.amount - am)))
                const bDist = Math.min(...allAmounts.map(am => Math.abs(b.amount - am)))
                return aDist - bDist
              })
            const otherTx = bankTransactions
              .filter((tx: any) => !allAmounts.some(a => Math.abs(tx.amount - a) <= 0.01))
              .sort((a: any, b: any) => {
                const aDist = Math.min(...allAmounts.map(am => Math.abs(a.amount - am)))
                const bDist = Math.min(...allAmounts.map(am => Math.abs(b.amount - am)))
                return aDist - bDist
              })
            const allSorted = [...matchingTx, ...otherTx]
            const filtered = bankSearch
              ? allSorted.filter((tx: any) => (tx.label || '').toLowerCase().includes(bankSearch))
              : allSorted

            return (
              <>
                {/* Target amounts badges */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-500">Montants recherches :</span>
                  {targetAmounts.map((t, i) => (
                    <span key={i} className={`rounded px-1.5 py-0.5 font-mono ${i === 0 ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-blue/10 text-accent-blue'}`}>
                      {t.label}: {t.amount.toFixed(2)}€
                    </span>
                  ))}
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    id="bank-match-search"
                    type="text"
                    placeholder="Rechercher par libelle..."
                    onChange={() => setBankTransactions([...bankTransactions])}
                    className="input-field w-full pl-9 text-sm"
                  />
                </div>

                {matchingTx.length > 0 && (
                  <p className="text-xs font-medium text-accent-green">
                    {matchingTx.length} transaction(s) avec montant exact (+/- 0.01€)
                  </p>
                )}

                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {filtered.length === 0 && (
                    <p className="py-6 text-center text-sm text-gray-500">Aucune transaction non rapprochee trouvee.</p>
                  )}
                  {filtered.map((tx: any) => {
                    const isMatch = allAmounts.some((a: number) => Math.abs(tx.amount - a) <= 0.01)
                    const isSelected = selectedBankTxIds.includes(tx.id)
                    return (
                      <label
                        key={tx.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-all hover:border-accent-green/50 ${
                          isSelected ? 'border-accent-green/50 bg-accent-green/5' : isMatch ? 'border-accent-green/20 bg-accent-green/5' : 'border-dark-border bg-dark-input'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedBankTxIds(prev =>
                              prev.includes(tx.id) ? prev.filter(id => id !== tx.id) : [...prev, tx.id]
                            )
                          }}
                          className="h-4 w-4 rounded border-dark-border bg-dark-input text-accent-green focus:ring-accent-green/50"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-200">{tx.label}</p>
                          <p className="text-xs text-gray-500 font-mono">
                            {tx.date ? new Date(tx.date).toLocaleDateString('fr-FR') : '-'}
                          </p>
                        </div>
                        <div className="shrink-0 ml-3 text-right">
                          <span className={`font-mono text-sm font-medium ${
                            tx.type === 'debit' ? 'text-accent-red' : 'text-accent-green'
                          }`}>
                            {tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' \u20AC'}
                          </span>
                          {isMatch && (
                            <span className="ml-2 rounded bg-accent-green/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
                              MATCH
                            </span>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>

                {selectedBankTxIds.length > 0 && (
                  <div className="flex items-center justify-between border-t border-dark-border pt-3">
                    <span className="text-xs text-gray-500">{selectedBankTxIds.length} transaction(s) selectionnee(s)</span>
                    <button
                      onClick={async () => {
                        setBankMatching(true)
                        try {
                          for (const txId of selectedBankTxIds) {
                            const tx = bankTransactions.find((t: any) => t.id === txId)
                            if (!tx) continue
                            await authFetch(`/api/bank-statements/${tx.statement_id}/match`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ transaction_id: txId, invoice_id: invoiceId }),
                            })
                          }
                          setBankMatched('multi')
                          setBankMatchCount(prev => prev + selectedBankTxIds.length)
                          setShowBankMatch(false)
                          setSelectedBankTxIds([])
                          setBankTransactions(prev => prev.filter((t: any) => !selectedBankTxIds.includes(t.id)))
                        } catch (e) {
                          console.error('Match error:', e)
                        }
                        setBankMatching(false)
                      }}
                      disabled={bankMatching}
                      className="flex items-center gap-1.5 rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90 disabled:opacity-50"
                    >
                      {bankMatching ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                      Confirmer le rapprochement
                    </button>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

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

          {/* Ventilation comptable summary */}
          {lines.length > 0 && (
            <div className="card border-2 border-accent-green/20 bg-accent-green/5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-accent-green">
                Ventilation comptable
              </h3>
              {(() => {
                const classified = lines.filter(l => l.pcg_code)
                const unclassified = lines.filter(l => !l.pcg_code)
                if (classified.length === 0) {
                  return (
                    <div className="flex items-center gap-2 rounded-lg bg-accent-orange/10 border border-accent-orange/30 px-3 py-2 text-sm text-accent-orange">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Aucune ligne classifiee — selectionne un compte PCG ci-dessous</span>
                    </div>
                  )
                }
                return (
                  <div className="space-y-2">
                    {classified.map((line, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg bg-dark-input px-3 py-2">
                        <span className="shrink-0 rounded bg-accent-green/20 px-2 py-0.5 text-xs font-mono font-bold text-accent-green">
                          {line.pcg_code}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-200">{line.pcg_label || '(libelle manquant)'}</p>
                          <p className="truncate text-xs text-gray-500">{line.description}</p>
                        </div>
                        <span className="shrink-0 rounded bg-dark-border px-1.5 py-0.5 text-xs font-mono text-gray-400">
                          Jnl {line.journal_code || 'AC'}
                        </span>
                        <span className="shrink-0 font-mono text-sm font-bold text-gray-200">
                          {formatAmount(line.total_ht)}
                        </span>
                      </div>
                    ))}
                    {unclassified.length > 0 && (
                      <div className="flex items-center gap-2 rounded-lg bg-accent-orange/10 border border-accent-orange/30 px-3 py-2 text-xs text-accent-orange">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        <span>{unclassified.length} ligne(s) non classifiee(s) — voir ci-dessous</span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

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
                    {line.pcg_code && (
                      <div className="flex items-center gap-2 rounded-lg bg-accent-green/10 border border-accent-green/30 px-2 py-1.5">
                        <span className="shrink-0 rounded bg-accent-green/30 px-2 py-0.5 text-xs font-mono font-bold text-accent-green">
                          {line.pcg_code}
                        </span>
                        <span className="truncate text-xs text-gray-300 flex-1">{line.pcg_label || '(libelle manquant)'}</span>
                        <button
                          onClick={async () => {
                            setAltLineIdx(index)
                            setAltLoading(true)
                            setAlternatives([])
                            try {
                              const res = await authFetch('/api/invoices/suggest-alternatives', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  description: line.description,
                                  supplier_name: invoice.supplier_name,
                                  total_ht: line.total_ht,
                                  current_pcg_code: line.pcg_code,
                                  document_type: invoice.document_type,
                                }),
                              })
                              if (res.ok) {
                                const data = await res.json()
                                setAlternatives(data.alternatives || [])
                              }
                            } catch { /* */ }
                            setAltLoading(false)
                          }}
                          className="shrink-0 flex items-center gap-1 rounded-lg bg-accent-orange/20 px-2 py-1 text-xs font-medium text-accent-orange hover:bg-accent-orange/30 transition-colors"
                          title="Pas d'accord ? Voir d'autres propositions"
                        >
                          <Lightbulb className="h-3 w-3" />
                          Pas d&apos;accord ?
                        </button>
                      </div>
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
              {lines.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <AlertTriangle className="h-10 w-10 text-accent-orange/50" />
                  <div>
                    <p className="text-sm font-medium text-gray-300">Aucune ligne de facturation</p>
                    <p className="mt-1 text-xs text-gray-500">
                      L&apos;extraction IA n&apos;a pas sauvegarde de lignes pour cette facture.<br />
                      Clique sur le bouton orange <strong className="text-accent-orange">Rescanner</strong> en haut a droite pour relancer l&apos;IA.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {/* Alternatives modal */}
      {altLineIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setAltLineIdx(null)}>
          <div className="mx-4 w-full max-w-xl rounded-2xl border border-dark-border bg-dark-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-orange/10">
                <Lightbulb className="h-5 w-5 text-accent-orange" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Propositions alternatives</h3>
                <p className="text-xs text-gray-500">
                  Pour : {lines[altLineIdx]?.description}
                </p>
              </div>
            </div>

            {altLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="mb-3 h-8 w-8 animate-spin text-accent-orange" />
                <p className="text-sm text-gray-400">L&apos;IA analyse d&apos;autres comptes possibles...</p>
              </div>
            ) : alternatives.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">Aucune alternative trouvee.</p>
            ) : (
              <div className="space-y-2">
                {alternatives.map((alt, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      updateLine(altLineIdx, alt.pcg_code, alt.pcg_label)
                      updateJournal(altLineIdx, alt.journal_code)
                      setAltLineIdx(null)
                    }}
                    className="w-full rounded-lg border border-dark-border bg-dark-input p-3 text-left transition-colors hover:border-accent-green/50 hover:bg-accent-green/5"
                  >
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 rounded bg-accent-green/20 px-2 py-0.5 text-sm font-mono font-bold text-accent-green">
                        {alt.pcg_code}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-200">{alt.pcg_label}</p>
                        <p className="mt-1 text-xs italic text-gray-500">{alt.reasoning}</p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        <span className="rounded bg-dark-border px-1.5 py-0.5 text-xs font-mono text-gray-400">
                          Jnl {alt.journal_code}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          alt.confidence >= 0.85 ? 'bg-accent-green/20 text-accent-green' :
                          alt.confidence >= 0.65 ? 'bg-accent-orange/20 text-accent-orange' :
                          'bg-accent-red/20 text-accent-red'
                        }`}>
                          {Math.round(alt.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setAltLineIdx(null)}
                className="rounded-lg border border-dark-border px-4 py-2 text-sm text-gray-400 hover:bg-dark-hover"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

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
