'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import JSZip from 'jszip'
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
  FileArchive,
  File,
} from 'lucide-react'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { Invoice, ExportFormat, RevenueEntry, Payslip } from '@/types'

type DocTab = 'factures' | 'encaissements' | 'personnel' | 'tous'
type ExportContent = 'file_only' | 'file_and_pdfs' | 'pdfs_only'

interface AccountingInfo {
  pcgCode: string
  pcgLabel: string
  journalCode: string
  lines?: { description: string; pcgCode: string; pcgLabel: string; amount: number }[]
}

interface ExportableDoc {
  id: string
  type: 'facture' | 'encaissement' | 'payslip'
  label: string
  sublabel: string
  date: string | null
  amount: number | null
  filePath: string | null
  fileName: string | null
  accounting: AccountingInfo | null
}

export default function ExportClient() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [revenue, setRevenue] = useState<RevenueEntry[]>([])
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<ExportFormat>('fec')
  const [exportContent, setExportContent] = useState<ExportContent>('file_and_pdfs')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [docTab, setDocTab] = useState<DocTab>('tous')
  const { user } = useAuth()
  const authFetch = useAuthFetch()

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
        filePath: inv.file_path,
        fileName: inv.file_name,
        accounting: null, // Lines fetched at annotation time via API
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
        filePath: rev.file_path || null,
        fileName: rev.file_name || null,
        accounting: {
          pcgCode: rev.pcg_code,
          pcgLabel: rev.pcg_label,
          journalCode: rev.journal_code,
        },
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
        filePath: pay.file_path || null,
        fileName: pay.file_name || null,
        accounting: {
          pcgCode: '641000',
          pcgLabel: 'Remunerations du personnel',
          journalCode: 'OD',
          lines: [
            { description: 'Salaire brut', pcgCode: '641000', pcgLabel: 'Remunerations', amount: pay.gross_salary },
            ...(pay.employer_charges > 0 ? [{ description: 'Charges patronales', pcgCode: '645000', pcgLabel: 'Charges secu', amount: pay.employer_charges }] : []),
          ],
        },
      })
    }
    return docs
  }, [invoices, revenue, payslips])

  const filteredByMonth = useMemo(() => {
    if (!selectedMonth) return allDocs
    return allDocs.filter((doc) => doc.date?.startsWith(selectedMonth))
  }, [allDocs, selectedMonth])

  const filteredDocs = useMemo(() => {
    if (docTab === 'tous') return filteredByMonth
    if (docTab === 'factures') return filteredByMonth.filter((d) => d.type === 'facture')
    if (docTab === 'encaissements') return filteredByMonth.filter((d) => d.type === 'encaissement')
    if (docTab === 'personnel') return filteredByMonth.filter((d) => d.type === 'payslip')
    return filteredByMonth
  }, [filteredByMonth, docTab])

  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    for (const doc of allDocs) {
      if (doc.date) {
        const m = doc.date.slice(0, 7)
        if (/^\d{4}-\d{2}$/.test(m)) months.add(m)
      }
    }
    return Array.from(months).sort().reverse()
  }, [allDocs])

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

  // Generate clean filename for a document
  const makeCleanFilename = (doc: ExportableDoc) => {
    const dateStr = doc.date ? doc.date.slice(0, 10).replace(/-/g, '') : 'NODATE'
    const name = (doc.label || 'INCONNU').toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 40)
    const amount = doc.amount != null ? `${doc.amount.toFixed(2).replace('.', ',')}EUR` : ''
    const prefix = doc.type === 'facture' ? 'FAC' : doc.type === 'encaissement' ? 'ENC' : 'BUL'
    return `${prefix}_${dateStr}_${name}${amount ? `_${amount}` : ''}.pdf`
  }

  // Download a PDF from Firebase Storage via proxy
  const downloadPdf = async (filePath: string): Promise<Blob | null> => {
    try {
      const res = await authFetch(`/api/proxy-pdf?path=${encodeURIComponent(filePath)}`)
      if (res.ok) return await res.blob()
      return null
    } catch {
      return null
    }
  }

  // Fetch invoice detail (with lines) and annotate PDF client-side
  const downloadAnnotatedInvoicePdf = async (invoiceId: string, filePath: string, doc: ExportableDoc): Promise<Blob | null> => {
    try {
      // Fetch invoice detail with lines
      const detailRes = await authFetch(`/api/invoices/${invoiceId}`)
      const detail = detailRes.ok ? await detailRes.json() : null
      const lines = detail?.lines || []

      // Download raw PDF
      const pdfBlob = await downloadPdf(filePath)
      if (!pdfBlob) return null

      const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer())
      const pdfDoc = await PDFDocument.load(pdfBytes)
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const courier = await pdfDoc.embedFont(StandardFonts.Courier)
      const pages = pdfDoc.getPages()
      if (pages.length === 0) return pdfBlob

      const GREEN = rgb(0, 200 / 255, 150 / 255)
      const WHITE = rgb(1, 1, 1)
      const GRAY = rgb(0.6, 0.6, 0.6)
      const DARK = rgb(13 / 255, 17 / 255, 23 / 255)

      // Build annotation data
      const supplier = detail?.supplier_name || doc.label || ''
      const invoiceNum = detail?.invoice_number || ''
      const invoiceDate = detail?.invoice_date || doc.date || ''
      const totalHt = detail?.total_ht
      const totalTva = detail?.total_tva
      const totalTtc = detail?.total_ttc || doc.amount

      // === STAMP on first page (bottom-right) ===
      const firstPage = pages[0]
      const { width } = firstPage.getSize()

      const lineCount = Math.max(lines.length, 1)
      const stampH = 30 + lineCount * 14 + 25
      const stampW = 300
      const stampX = width - stampW - 10
      const stampY = 10

      // Dark background
      firstPage.drawRectangle({ x: stampX, y: stampY, width: stampW, height: stampH, color: DARK, borderColor: GREEN, borderWidth: 1.5 })
      // Green accent
      firstPage.drawRectangle({ x: stampX, y: stampY + stampH - 2, width: stampW, height: 2, color: GREEN })

      // Header
      firstPage.drawText('VENTILATION COMPTABLE — SYNERGIA-COMPT', {
        x: stampX + 5, y: stampY + stampH - 14, size: 7, font: helveticaBold, color: GREEN,
      })
      firstPage.drawText(new Date().toLocaleDateString('fr-FR'), {
        x: stampX + stampW - 60, y: stampY + stampH - 14, size: 6, font: helvetica, color: GRAY,
      })

      let ly = stampY + stampH - 30

      if (lines.length > 0) {
        // Show each line with PCG code
        for (const line of lines) {
          if (ly < stampY + 15) break
          const pcg = line.pcg_code || '------'
          const label = (line.pcg_label || '').slice(0, 20)
          const desc = (line.description || '').slice(0, 25)
          const amt = line.total_ht != null ? `${Number(line.total_ht).toFixed(2)}` : ''

          firstPage.drawText(pcg, { x: stampX + 5, y: ly, size: 7, font: courier, color: GREEN })
          firstPage.drawText(label, { x: stampX + 55, y: ly, size: 6, font: helvetica, color: GRAY })
          firstPage.drawText(desc, { x: stampX + 140, y: ly, size: 6, font: helvetica, color: WHITE })
          if (amt) firstPage.drawText(`${amt} EUR`, { x: stampX + stampW - 55, y: ly, size: 6, font: courier, color: WHITE })
          ly -= 14
        }
      } else {
        // No lines — show basic info
        firstPage.drawText('Pas de lignes detaillees', { x: stampX + 5, y: ly, size: 6, font: helvetica, color: GRAY })
        ly -= 14
      }

      // Summary line
      ly -= 2
      firstPage.drawRectangle({ x: stampX + 5, y: ly + 8, width: stampW - 10, height: 0.5, color: GRAY })
      const summaryParts: string[] = []
      if (totalHt != null) summaryParts.push(`HT: ${Number(totalHt).toFixed(2)}`)
      if (totalTva != null && totalTva > 0) summaryParts.push(`TVA: ${Number(totalTva).toFixed(2)}`)
      if (totalTtc != null) summaryParts.push(`TTC: ${Number(totalTtc).toFixed(2)}`)
      firstPage.drawText(summaryParts.join(' | ') + ' EUR', {
        x: stampX + 5, y: ly - 2, size: 7, font: helveticaBold, color: WHITE,
      })

      const annotatedBytes = await pdfDoc.save()
      return new Blob([annotatedBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
    } catch (e) {
      console.error('Annotate error:', e)
      // Fallback: return raw PDF
      return downloadPdf(filePath)
    }
  }

  // Annotate a PDF with accounting stamp (for encaissements/bulletins - client-side)
  const addAccountingStamp = async (pdfBlob: Blob, doc: ExportableDoc): Promise<Blob> => {
    if (!doc.accounting) return pdfBlob

    try {
      const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer())
      const pdfDoc = await PDFDocument.load(pdfBytes)
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
      const courier = await pdfDoc.embedFont(StandardFonts.Courier)
      const pages = pdfDoc.getPages()

      if (pages.length === 0) return pdfBlob

      const firstPage = pages[0]
      const { width } = firstPage.getSize()

      // Stamp dimensions
      const stampW = 260
      const stampH = doc.accounting.lines ? 20 + doc.accounting.lines.length * 14 + 10 : 50
      const stampX = width - stampW - 15
      const stampY = 15

      // Dark background
      firstPage.drawRectangle({
        x: stampX, y: stampY, width: stampW, height: stampH,
        color: rgb(13 / 255, 17 / 255, 23 / 255),
        borderColor: rgb(0, 200 / 255, 150 / 255),
        borderWidth: 1,
      })

      // Green accent line
      firstPage.drawRectangle({
        x: stampX, y: stampY + stampH - 2, width: stampW, height: 2,
        color: rgb(0, 200 / 255, 150 / 255),
      })

      // Title
      firstPage.drawText('SYNERGIA-COMPT', {
        x: stampX + 5, y: stampY + stampH - 14,
        size: 7, font: helveticaBold, color: rgb(0, 200 / 255, 150 / 255),
      })

      // Date
      firstPage.drawText(new Date().toLocaleDateString('fr-FR'), {
        x: stampX + stampW - 55, y: stampY + stampH - 14,
        size: 6, font: helvetica, color: rgb(0.5, 0.5, 0.5),
      })

      if (doc.accounting.lines) {
        let ly = stampY + stampH - 30
        for (const line of doc.accounting.lines) {
          firstPage.drawText(line.pcgCode, {
            x: stampX + 5, y: ly, size: 7, font: courier, color: rgb(0, 200 / 255, 150 / 255),
          })
          firstPage.drawText(line.pcgLabel, {
            x: stampX + 60, y: ly, size: 6, font: helvetica, color: rgb(0.7, 0.7, 0.7),
          })
          firstPage.drawText(`${line.amount.toFixed(2)} EUR`, {
            x: stampX + stampW - 60, y: ly, size: 6, font: courier, color: rgb(1, 1, 1),
          })
          ly -= 14
        }
      } else {
        firstPage.drawText(doc.accounting.pcgCode, {
          x: stampX + 5, y: stampY + stampH - 30,
          size: 8, font: courier, color: rgb(0, 200 / 255, 150 / 255),
        })
        firstPage.drawText(doc.accounting.pcgLabel, {
          x: stampX + 70, y: stampY + stampH - 30,
          size: 7, font: helvetica, color: rgb(0.7, 0.7, 0.7),
        })
        firstPage.drawText(`Jnl: ${doc.accounting.journalCode}`, {
          x: stampX + 5, y: stampY + stampH - 42,
          size: 6, font: helvetica, color: rgb(0.5, 0.5, 0.5),
        })
      }

      const annotatedBytes = await pdfDoc.save()
      return new Blob([annotatedBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
    } catch (e) {
      console.error('Stamp error:', e)
      return pdfBlob
    }
  }

  const handleExport = async () => {
    if (selected.size === 0) return
    setExporting(true)
    setExportProgress('')

    try {
      const invoiceIds: string[] = []
      const revenueIds: string[] = []
      const payslipIds: string[] = []

      for (const key of selected) {
        const [type, id] = key.split(':')
        if (type === 'facture') invoiceIds.push(id)
        else if (type === 'encaissement') revenueIds.push(id)
        else if (type === 'payslip') payslipIds.push(id)
      }

      const needsFile = exportContent !== 'pdfs_only'
      const needsPdfs = exportContent !== 'file_only'

      // Step 1: Get the FEC/CSV/JSON file from API
      let fileBlob: Blob | null = null
      let fileExt = format === 'fec' ? 'txt' : format

      if (needsFile) {
        setExportProgress('Generation du fichier comptable...')
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
          fileBlob = await res.blob()
        } else {
          console.error('Export API error:', res.status)
        }
      }

      // If only file, just download it directly
      if (exportContent === 'file_only' && fileBlob) {
        const url = URL.createObjectURL(fileBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${format.toUpperCase()}_${selectedMonth}.${fileExt}`
        a.click()
        URL.revokeObjectURL(url)
        setExporting(false)
        setExportProgress('')
        return
      }

      // Step 2: Download PDFs and create ZIP
      if (needsPdfs) {
        const zip = new JSZip()
        const docsFolder = zip.folder('documents') || zip

        // Add comptable file to ZIP
        if (fileBlob && needsFile) {
          zip.file(`${format.toUpperCase()}_${selectedMonth}.${fileExt}`, fileBlob)
        }

        // Get selected docs that have files
        const selectedDocs = filteredDocs.filter((d) => selected.has(d.id) && d.filePath)
        let downloaded = 0

        // Download and annotate PDFs in batches of 3
        for (let i = 0; i < selectedDocs.length; i += 3) {
          const batch = selectedDocs.slice(i, i + 3)
          setExportProgress(`Annotation et telechargement des PDFs... ${downloaded}/${selectedDocs.length}`)

          const results = await Promise.all(
            batch.map(async (doc) => {
              let blob: Blob | null = null
              const [type, docId] = doc.id.split(':')

              if (type === 'facture') {
                // Client-side annotation with invoice detail + lines
                blob = await downloadAnnotatedInvoicePdf(docId, doc.filePath!, doc)
              } else {
                // Download raw then stamp client-side
                blob = await downloadPdf(doc.filePath!)
                if (blob && doc.accounting) {
                  blob = await addAccountingStamp(blob, doc)
                }
              }

              return { doc, blob }
            })
          )

          for (const { doc, blob } of results) {
            if (blob) {
              const cleanName = makeCleanFilename(doc)
              docsFolder.file(cleanName, blob)
              downloaded++
            }
          }
        }

        setExportProgress('Creation du ZIP...')
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = `COMPTA_${selectedMonth}.zip`
        a.click()
        URL.revokeObjectURL(url)
      }

      setSelected(new Set())
    } catch (error) {
      console.error('Export error:', error)
    }

    setExporting(false)
    setExportProgress('')
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

  const contentOptions: { value: ExportContent; label: string; desc: string; icon: typeof FileText }[] = [
    { value: 'file_only', label: 'Fichier seul', desc: 'FEC/CSV/JSON uniquement', icon: File },
    { value: 'file_and_pdfs', label: 'Fichier + PDFs', desc: 'ZIP avec fichier comptable + tous les PDFs renommes', icon: FileArchive },
    { value: 'pdfs_only', label: 'PDFs seuls', desc: 'ZIP avec tous les PDFs renommes', icon: FileText },
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
        <button onClick={() => navigateMonth(-1)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-dark-hover hover:text-white">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <p className="text-lg font-semibold text-white">{monthLabel(selectedMonth)}</p>
          <p className="text-xs text-gray-500">
            {filteredByMonth.length} document{filteredByMonth.length > 1 ? 's' : ''} valide{filteredByMonth.length > 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => navigateMonth(1)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-dark-hover hover:text-white">
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
                m === selectedMonth ? 'bg-accent-green text-dark-bg' : 'bg-dark-card text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
            >
              {new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
            </button>
          ))}
        </div>
      )}

      {/* Format + Content side by side */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Format */}
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Format d&apos;export</h2>
          <div className="grid grid-cols-3 gap-2">
            {formats.map((f) => (
              <button key={f.value} onClick={() => setFormat(f.value)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${format === f.value ? 'border-accent-green bg-accent-green/10' : 'border-dark-border hover:border-gray-500'}`}>
                <p className="font-medium text-gray-200">{f.label}</p>
                <p className="mt-1 text-xs text-gray-500">{f.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Content type */}
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Contenu</h2>
          <div className="grid grid-cols-3 gap-2">
            {contentOptions.map((opt) => {
              const Icon = opt.icon
              return (
                <button key={opt.value} onClick={() => setExportContent(opt.value)}
                  className={`rounded-lg border-2 p-3 text-left transition-colors ${exportContent === opt.value ? 'border-accent-green bg-accent-green/10' : 'border-dark-border hover:border-gray-500'}`}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-gray-400" />
                    <p className="font-medium text-gray-200 text-sm">{opt.label}</p>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{opt.desc}</p>
                </button>
              )
            })}
          </div>
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
                docTab === tab.key ? 'bg-accent-green/20 text-accent-green' : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                docTab === tab.key ? 'bg-accent-green/30 text-accent-green' : 'bg-dark-hover text-gray-500'
              }`}>{tab.count}</span>
            </button>
          )
        })}
      </div>

      {/* Export progress */}
      {exporting && exportProgress && (
        <div className="flex items-center gap-3 rounded-lg border border-accent-green/30 bg-accent-green/10 px-4 py-3">
          <Loader2 className="h-5 w-5 animate-spin text-accent-green" />
          <p className="text-sm text-accent-green">{exportProgress}</p>
        </div>
      )}

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
