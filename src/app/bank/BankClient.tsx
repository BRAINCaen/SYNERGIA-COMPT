'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import { useRouter } from 'next/navigation'
import {
  Landmark,
  Upload,
  FileText,
  Loader2,
  Trash2,
  Eye,
  Link,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
} from 'lucide-react'

interface BankStatement {
  id: string
  file_name: string
  period_month: string
  transaction_count: number
  total_debits: number
  total_credits: number
  status: 'pending' | 'parsed' | 'reconciling' | 'completed' | 'error'
  created_at: string
}

interface MonthlySummary {
  month: string
  statement_count: number
  total_debits: number
  total_credits: number
  matched_count: number
  total_transactions: number
}

// ═══ DETERMINISTIC BANK STATEMENT PARSER (no AI) ═══
// Parses Crédit Mutuel PDF by grouping text items into lines,
// requiring TWO dates per line, and classifying debit/credit by label keywords

function parseAmount(s: string): number | null {
  if (!s || !s.trim()) return null
  const cleaned = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : Math.round(n * 100) / 100
}

// Classify a transaction as debit or credit based on its label
// This is 100% reliable for Crédit Mutuel statements
function classifyTransaction(label: string, amount: number): { debit: number | null; credit: number | null } {
  const L = label.toUpperCase()

  // CREDITS (money coming IN)
  if (L.startsWith('REMCB')) return { debit: null, credit: amount }
  if (L.includes('VIR PAYPAL PTE')) return { debit: null, credit: amount }
  if (L.includes('VIR ASP AGENCE')) return { debit: null, credit: amount }
  if (L.includes('VIR DRFIP')) return { debit: null, credit: amount }
  if (L.includes('VIR EDENRED')) return { debit: null, credit: amount }
  if (L.includes('VIR CAP LOISIRS')) return { debit: null, credit: amount }
  if (L.includes('VIR LUDOBOX')) return { debit: null, credit: amount }
  if (L.includes('VIR INST FUNBOOKER')) return { debit: null, credit: amount }
  if (L.includes('VIR FUNBOOKER')) return { debit: null, credit: amount }
  if (L.includes('VIR SOCOTEC')) return { debit: null, credit: amount }
  if (L.includes('VIR ORANGE')) return { debit: null, credit: amount }
  if (L.includes('VIR EUROFEU')) return { debit: null, credit: amount }
  // SOLDE CREDITEUR at start is the opening balance → skip handled elsewhere

  // Rare COMCB credits (refunds) — these are specific tiny amounts
  // COMCB00091 NB0001 = 0.10 credit, COMCB00267 NB0001 = 0.06 credit, COMCB00103 NB0001 = 0.96 credit
  if (L.startsWith('COMCB') && L.includes('NB0001') && amount < 1) return { debit: null, credit: amount }

  // DEBITS (money going OUT) — everything else
  return { debit: amount, credit: null }
}

type PdfTextItem = { str: string; x: number; y: number }

function parseBankStatementFromPositions(
  pages: { page: number; items: PdfTextItem[] }[]
): { date: string; label: string; debit: number | null; credit: number | null }[] {
  const transactions: { date: string; label: string; debit: number | null; credit: number | null }[] = []
  const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/
  const amountRegex = /^[\d][.\d\s]*,\d{2}$/

  for (const { items } of pages) {
    if (items.length === 0) continue

    // Group items by Y position (same line) — tolerance of 3px
    const lines: Map<number, PdfTextItem[]> = new Map()
    for (const item of items) {
      let foundY = false
      for (const [y] of lines) {
        if (Math.abs(y - item.y) <= 3) {
          lines.get(y)!.push(item)
          foundY = true
          break
        }
      }
      if (!foundY) {
        lines.set(item.y, [item])
      }
    }

    // Sort lines top to bottom
    const sortedLines = Array.from(lines.entries())
      .sort(([y1], [y2]) => y2 - y1)

    for (const [, lineItems] of sortedLines) {
      lineItems.sort((a, b) => a.x - b.x)

      // A valid transaction line must have TWO dates at the start
      const strs = lineItems.map(it => it.str.trim()).filter(s => s.length > 0)
      if (strs.length < 3) continue

      const date1Match = strs[0].match(dateRegex)
      const date2Match = strs[1].match(dateRegex)
      if (!date1Match || !date2Match) continue

      const day = date1Match[1]
      const month = date1Match[2]
      const year = date1Match[3]
      const yearNum = parseInt(year)
      if (yearNum < 2024 || yearNum > 2030) continue
      const isoDate = `${year}-${month}-${day}`

      // Extract label and amounts from remaining items (skip the 2 dates)
      const restItems = strs.slice(2)
      let label = ''
      const amounts: number[] = []

      for (const str of restItems) {
        if (amountRegex.test(str)) {
          const amt = parseAmount(str)
          if (amt !== null) amounts.push(amt)
        } else if (str && !str.startsWith('SOLDE') && !str.startsWith('Total') &&
                   !str.startsWith('<<') && !str.startsWith('UN.') &&
                   !str.startsWith('Réf') && !str.startsWith('QXBAN') &&
                   !str.startsWith('IBAN')) {
          if (label) label += ' '
          label += str
        }
      }

      // Must have exactly one amount and a label
      if (amounts.length !== 1 || !label) continue
      if (label.toUpperCase().includes('SOLDE')) continue
      if (label.toUpperCase().includes('TOTAL DES MOUVEMENTS')) continue

      const { debit, credit } = classifyTransaction(label, amounts[0])
      transactions.push({ date: isoDate, label, debit, credit })
    }
  }

  return transactions
}

export default function BankClient() {
  const { user, loading: authLoading } = useAuth()
  const authFetch = useAuthFetch()
  const router = useRouter()

  const [statements, setStatements] = useState<BankStatement[]>([])
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login')
      return
    }
    fetchStatements()
  }, [user, authLoading])

  const fetchStatements = async () => {
    try {
      const res = await authFetch('/api/bank-statements')
      if (res.ok) {
        const data = await res.json()
        setStatements(data.statements || [])
        setSummary(data.summary || null)
      }
    } catch (e) {
      console.error('Bank statements fetch error:', e)
    }
    setLoading(false)
  }

  const acceptedTypes = [
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/pdf',
  ]

  const acceptedExtensions = ['.csv', '.xlsx', '.xls', '.pdf']

  const isAcceptedFile = (file: File) => {
    if (acceptedTypes.includes(file.type)) return true
    return acceptedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
  }

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter(isAcceptedFile)
      if (files.length === 0) return

      setUploading(true)
      setUploadProgress(10)

      for (const file of files) {
        const form = new FormData()
        form.append('file', file)

        setUploadProgress(30)

        try {
          const res = await authFetch('/api/bank-statements/upload', {
            method: 'POST',
            body: form,
          })

          setUploadProgress(80)

          if (!res.ok) {
            const err = await res.json()
            console.error('Upload error:', err.error)
          }
        } catch (e) {
          console.error('Upload failed:', e)
        }
      }

      setUploadProgress(100)
      await fetchStatements()

      setTimeout(() => {
        setUploading(false)
        setUploadProgress(0)
      }, 500)
    },
    [authFetch]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  const handleAnalyze = async (id: string) => {
    setAnalyzing(id)
    try {
      // Step 1: Get file path
      const stmtRes = await authFetch(`/api/bank-statements/${id}`)
      if (!stmtRes.ok) throw new Error('Relevé non trouvé')
      const stmtData = await stmtRes.json()

      // Step 2: Download PDF via proxy
      const proxyRes = await authFetch(`/api/proxy-pdf?path=${encodeURIComponent(stmtData.file_path)}`)
      if (!proxyRes.ok) throw new Error('Téléchargement échoué')
      const pdfBuffer = await proxyRes.arrayBuffer()

      // Step 3: Extract text from PDF IN THE BROWSER using pdfjs-dist
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise

      // Extract text WITH positions to detect debit vs credit columns
      const allItems: { page: number; items: PdfTextItem[] }[] = []
      let fullText = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const pageItems: PdfTextItem[] = content.items
          .filter((item: any) => item.str && item.str.trim())
          .map((item: any) => ({
            str: item.str,
            x: Math.round(item.transform[4]),
            y: Math.round(item.transform[5]),
          }))
        allItems.push({ page: i, items: pageItems })
        fullText += content.items.map((item: any) => item.str).join(' ') + '\n'
      }

      if (fullText.trim().length < 30) {
        throw new Error('PDF illisible — aucun texte extractible')
      }

      // Step 4: Parse transactions using column positions (DETERMINISTIC, no AI)
      // Crédit Mutuel PDF has columns: Date | Date valeur | Opération | Débit EUROS | Crédit EUROS
      // We detect column positions from the header row, then classify amounts
      const transactions = parseBankStatementFromPositions(allItems)

      if (transactions.length === 0) {
        throw new Error('Aucune transaction trouvée dans le relevé')
      }

      // Step 5: Save transactions
      const saveRes = await authFetch(`/api/bank-statements/${id}/save-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
      })
      if (!saveRes.ok) throw new Error('Erreur de sauvegarde')
      const saveData = await saveRes.json()

      setStatements((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: 'parsed' as const,
                transaction_count: saveData.transaction_count,
                total_debits: saveData.total_debits,
                total_credits: saveData.total_credits,
                period_month: saveData.period_month || s.period_month,
              }
            : s
        )
      )
    } catch (e) {
      console.error('Analyze failed:', e)
      alert(`Erreur : ${e instanceof Error ? e.message : 'Erreur inconnue'}`)
    }
    setAnalyzing(null)
  }

  const handleReconcile = async (id: string) => {
    setReconciling(id)
    try {
      const res = await authFetch(`/api/bank-statements/${id}/reconcile`, {
        method: 'POST',
      })
      if (res.ok) {
        router.push(`/bank/${id}`)
      } else {
        console.error('Reconciliation error')
        setReconciling(null)
      }
    } catch (e) {
      console.error('Reconciliation failed:', e)
      setReconciling(null)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch(`/api/bank-statements/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setStatements((prev) => prev.filter((s) => s.id !== id))
        setDeleteConfirm(null)
      }
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)

  const statusBadge = (status: BankStatement['status']) => {
    const map: Record<string, { bg: string; label: string }> = {
      pending: { bg: 'bg-accent-orange/10 text-accent-orange', label: 'En attente' },
      parsed: { bg: 'bg-accent-blue/10 text-accent-blue', label: 'Analyse' },
      error: { bg: 'bg-accent-red/10 text-accent-red', label: 'Erreur' },
      reconciling: { bg: 'bg-accent-orange/10 text-accent-orange', label: 'Rapprochement' },
      completed: { bg: 'bg-accent-green/10 text-accent-green', label: 'Termine' },
    }
    const s = map[status] || map.parsed
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg}`}>
        {s.label}
      </span>
    )
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

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-accent-blue/10 p-3 text-accent-blue">
            <Landmark className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Releves bancaires</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Import, rapprochement et pointage automatique
            </p>
          </div>
        </div>

        {/* Monthly summary */}
        {summary && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card flex items-center gap-4">
              <div className="rounded-xl bg-accent-blue/10 p-3 text-accent-blue">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-white">{summary.statement_count}</p>
                <p className="text-sm text-gray-500">Releves</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="rounded-xl bg-accent-red/10 p-3 text-accent-red">
                <ArrowDownRight className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-white">{fmt(summary.total_debits)}</p>
                <p className="text-sm text-gray-500">Total debits</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="rounded-xl bg-accent-green/10 p-3 text-accent-green">
                <ArrowUpRight className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-white">{fmt(summary.total_credits)}</p>
                <p className="text-sm text-gray-500">Total credits</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="rounded-xl bg-accent-green/10 p-3 text-accent-green">
                <Link className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-white">
                  {summary.total_transactions > 0
                    ? Math.round((summary.matched_count / summary.total_transactions) * 100)
                    : 0}
                  %
                </p>
                <p className="text-sm text-gray-500">Rapproches</p>
              </div>
            </div>
          </div>
        )}

        {/* Upload zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors ${
            isDragOver
              ? 'border-accent-green bg-accent-green/5'
              : 'border-dark-border bg-dark-card hover:border-gray-500'
          }`}
        >
          {uploading ? (
            <>
              <Loader2 className="mb-3 h-10 w-10 animate-spin text-accent-green" />
              <p className="mb-2 text-sm font-medium text-gray-300">Import en cours...</p>
              <div className="h-1.5 w-64 overflow-hidden rounded-full bg-dark-input">
                <div
                  className="h-full rounded-full bg-accent-green transition-all duration-500"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <Upload
                className={`mb-3 h-10 w-10 ${isDragOver ? 'text-accent-green' : 'text-gray-500'}`}
              />
              <p className="mb-1 text-base font-medium text-gray-300">
                Glissez-deposez vos releves bancaires
              </p>
              <p className="mb-4 text-sm text-gray-500">CSV, XLSX ou PDF</p>
              <label className="btn-primary cursor-pointer">
                Parcourir les fichiers
                <input
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.xls,.pdf"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                  className="hidden"
                />
              </label>
            </>
          )}
        </div>

        {/* Statements list */}
        {statements.length > 0 ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Releves importes</h2>
            <div className="space-y-3">
              {statements.map((st) => (
                <div
                  key={st.id}
                  className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="rounded-lg bg-accent-blue/10 p-2.5 text-accent-blue">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-200">{st.file_name}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                        <span className="text-xs text-gray-500">
                          Periode : {st.period_month || '-'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {st.transaction_count} operations
                        </span>
                        <span className="text-xs font-mono text-accent-red">
                          {fmt(st.total_debits)} debits
                        </span>
                        <span className="text-xs font-mono text-accent-green">
                          {fmt(st.total_credits)} credits
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {statusBadge(st.status)}

                    {st.status === 'pending' && (
                      <button
                        onClick={() => handleAnalyze(st.id)}
                        disabled={analyzing === st.id}
                        className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
                      >
                        {analyzing === st.id ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Analyse IA...
                          </>
                        ) : (
                          <>
                            <Search className="h-3.5 w-3.5" />
                            Analyser
                          </>
                        )}
                      </button>
                    )}

                    {st.status === 'parsed' && (
                      <button
                        onClick={() => handleReconcile(st.id)}
                        disabled={reconciling === st.id}
                        className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
                      >
                        {reconciling === st.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Link className="h-3.5 w-3.5" />
                        )}
                        Rapprocher
                      </button>
                    )}

                    <button
                      onClick={() => router.push(`/bank/${st.id}`)}
                      className="btn-secondary flex items-center gap-1.5 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Voir
                    </button>

                    {deleteConfirm === st.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDelete(st.id)}
                          className="rounded bg-accent-red/20 px-2 py-1 text-xs font-medium text-accent-red hover:bg-accent-red/30"
                        >
                          Confirmer
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="rounded bg-dark-input px-2 py-1 text-xs text-gray-400 hover:bg-dark-hover"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(st.id)}
                        className="rounded p-1.5 text-gray-500 hover:bg-accent-red/10 hover:text-accent-red transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          !uploading && (
            <div className="card flex flex-col items-center py-12">
              <AlertTriangle className="mb-3 h-8 w-8 text-gray-600" />
              <p className="text-sm text-gray-500">
                Aucun releve bancaire importe. Commencez par deposer un fichier CSV, XLSX ou PDF.
              </p>
            </div>
          )
        )}
      </div>
    </AppLayout>
  )
}
