'use client'

import { useState, useCallback } from 'react'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import { Upload, X, FileText, Image, Loader2, CheckCircle, AlertCircle, MessageCircleQuestion, Send, Zap, Copy } from 'lucide-react'

interface AnswerChoice {
  label: string
  pcg_code: string
  pcg_label: string
}

interface ClarificationQuestion {
  line_index: number
  description: string
  total_ht: number
  question: string
  answer_choices: AnswerChoice[]
  current_best?: { code: string; label: string; confidence: number }
}

interface UploadedFile {
  file: File
  status: 'pending' | 'uploading' | 'processing' | 'questions' | 'done' | 'error' | 'duplicate'
  progress: number
  invoiceId?: string
  error?: string
  duplicateOf?: string
  autoClassified?: boolean
  knownSupplier?: boolean
  documentType?: 'expense' | 'revenue'
  questions?: ClarificationQuestion[]
  answers?: Record<number, string>
  extraction?: {
    supplier?: { name?: string }
    lines?: { description: string; quantity?: number; unit_price?: number; total_ht: number; tva_rate?: number; tva_amount?: number; total_ttc?: number }[]
  }
  classifications?: {
    line_index: number
    pcg_code: string
    pcg_label: string
    confidence: number
    reasoning: string
    journal_code: string
    is_immobilization?: boolean
    amortization_rate?: number | null
    classification_method?: string
  }[]
}

export default function InvoiceUploader() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const authFetch = useAuthFetch()

  const acceptedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/tiff',
  ]

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const validFiles = Array.from(newFiles).filter((f) =>
      acceptedTypes.includes(f.type)
    )
    const uploadFiles: UploadedFile[] = validFiles.map((file) => ({
      file,
      status: 'pending',
      progress: 0,
    }))
    setFiles((prev) => [...prev, ...uploadFiles])
  }, [])

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

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const processFile = async (index: number) => {
    const uploadedFile = files[index]

    // Step 1: Upload
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, status: 'uploading', progress: 20 } : f))
    )

    const uploadForm = new FormData()
    uploadForm.append('file', uploadedFile.file)

    const uploadRes = await authFetch('/api/invoices/upload', {
      method: 'POST',
      body: uploadForm,
    })

    if (!uploadRes.ok) {
      const err = await uploadRes.json()
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'error', error: err.error || 'Erreur upload' } : f))
      )
      return
    }

    const { invoice } = await uploadRes.json()

    setFiles((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, status: 'processing', progress: 40, invoiceId: invoice.id } : f
      )
    )

    // Step 2: Extract
    const extractForm = new FormData()
    extractForm.append('file', uploadedFile.file)

    const extractRes = await authFetch('/api/invoices/extract', {
      method: 'POST',
      body: extractForm,
    })

    if (!extractRes.ok) {
      let errMsg = "Erreur d'extraction IA"
      try { const errData = await extractRes.json(); errMsg = errData.error || errMsg } catch { /* */ }
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'error', error: errMsg } : f))
      )
      return
    }

    const { data: extraction } = await extractRes.json()

    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, progress: 60, extraction } : f))
    )

    // Duplicate detection: check supplier + amount + date (same month = duplicate)
    const invoiceNum = extraction.invoice?.number
    const extractedSupplier = extraction.supplier?.name
    const extractedTTC = extraction.totals?.total_ttc
    const extractedDate = extraction.invoice?.date // YYYY-MM-DD
    if (extractedSupplier) {
      try {
        const params = new URLSearchParams()
        if (invoiceNum) params.set('invoice_number', invoiceNum)
        params.set('supplier_name', extractedSupplier)
        if (extractedTTC != null) params.set('total_ttc', String(extractedTTC))
        if (extractedDate) params.set('invoice_date', extractedDate)
        const checkRes = await authFetch(`/api/invoices/check-duplicate?${params.toString()}`)
        if (checkRes.ok) {
          const { isDuplicate, existingFileName } = await checkRes.json()
          if (isDuplicate) {
            await authFetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' })
            setFiles((prev) =>
              prev.map((f, i) => (i === index ? { ...f, status: 'duplicate' as const, duplicateOf: existingFileName, progress: 100 } : f))
            )
            return
          }
        }
      } catch { /* continue if check fails */ }
    }

    // Detect document type (expense vs revenue)
    const docType = extraction.document_type || 'expense'
    const revenueSource = extraction.revenue_source || null
    const isRevenue = docType === 'revenue'

    // Rename: SUPPLIER-AMOUNT_EUR-YYYYMMDD-NUMFACTURE.ext
    const supplierName = (extraction.supplier?.name || '').toUpperCase().trim()
      .replace(/[^A-Z0-9\sÀ-Ü]/g, '').replace(/\s+/g, '_').slice(0, 40)
    const totalTTC = extraction.totals?.total_ttc
    const cleanInvoiceNum = (extraction.invoice?.number || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)
    const originalExt = files[index]?.file?.name?.split('.').pop() || 'pdf'
    let newFileName = files[index]?.file?.name || 'facture.pdf'
    if (supplierName || totalTTC != null) {
      const parts: string[] = []
      if (supplierName) parts.push(supplierName)
      if (totalTTC != null) parts.push(`${totalTTC.toFixed(2).replace('.', ',')}EUR`)
      if (extractedDate) parts.push(extractedDate.slice(0, 10).replace(/-/g, ''))
      if (cleanInvoiceNum) parts.push(cleanInvoiceNum)
      newFileName = `${parts.join('-')}.${originalExt}`
    }

    await authFetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: newFileName,
        document_type: docType,
        revenue_source: revenueSource,
        is_credit_note: extraction.is_credit_note || false,
        supplier_name: extraction.supplier?.name,
        supplier_siret: extraction.supplier?.siret,
        invoice_number: extraction.invoice?.number,
        invoice_date: extraction.invoice?.date,
        due_date: extraction.invoice?.due_date,
        total_ht: extraction.totals?.total_ht,
        total_tva: extraction.totals?.total_tva,
        total_ttc: extraction.totals?.total_ttc,
        raw_extraction: extraction,
        status: 'processing',
      }),
    })

    // Step 3: Classify (check supplier auto-classify first)
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, progress: 70 } : f))
    )

    let supplierAutoClassify = false
    let supplierLineMappings: { description: string; pcg_code: string; pcg_label: string; journal_code: string }[] = []

    try {
      const suppliersRes = await authFetch('/api/suppliers')
      if (suppliersRes.ok) {
        const suppliers = await suppliersRes.json()
        const supplierName = (extraction.supplier?.name || '').toLowerCase()
        const match = suppliers.find((s: { name: string; auto_classify?: boolean }) =>
          s.name.toLowerCase() === supplierName && s.auto_classify
        )
        if (match && match.line_mappings && match.line_mappings.length > 0) {
          supplierAutoClassify = true
          supplierLineMappings = match.line_mappings
        }
      }
    } catch {
      // Ignore
    }

    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, progress: 75 } : f))
    )

    const classifyRes = await authFetch('/api/invoices/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: extraction.lines,
        supplier_name: extraction.supplier?.name || 'Inconnu',
        document_type: docType,
        revenue_source: revenueSource,
        ...(supplierAutoClassify && docType !== 'revenue' ? {
          supplier_auto_classify: true,
          supplier_line_mappings: supplierLineMappings,
        } : {}),
      }),
    })

    if (!classifyRes.ok) {
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'error', error: 'Erreur de classification IA' } : f))
      )
      return
    }

    const classifyData = await classifyRes.json()
    const { classifications, questions, auto_classified, known_supplier } = classifyData

    if (auto_classified || known_supplier) {
      setFiles((prev) =>
        prev.map((f, i) =>
          i === index ? { ...f, progress: 90, autoClassified: !!auto_classified, knownSupplier: !!known_supplier, documentType: docType as 'expense' | 'revenue' } : f
        )
      )
    }

    if (questions && questions.length > 0) {
      setFiles((prev) =>
        prev.map((f, i) =>
          i === index
            ? {
                ...f,
                status: 'questions',
                progress: 85,
                questions,
                answers: {},
                classifications: classifications || [],
              }
            : f
        )
      )
      return
    }

    await finalizeClassification(index, invoice.id, extraction, classifications || [])
  }

  const setAnswer = (fileIndex: number, lineIndex: number, answer: string) => {
    setFiles((prev) =>
      prev.map((f, i) =>
        i === fileIndex ? { ...f, answers: { ...f.answers, [lineIndex]: answer } } : f
      )
    )
  }

  const submitAnswers = async (fileIndex: number) => {
    const f = files[fileIndex]
    if (!f.questions || !f.answers || !f.invoiceId || !f.extraction) return

    setFiles((prev) =>
      prev.map((file, i) => (i === fileIndex ? { ...file, status: 'processing', progress: 90 } : file))
    )

    const allClassifications = [...(f.classifications || [])]

    for (const q of f.questions) {
      const answer = f.answers[q.line_index]
      if (!answer) continue

      const line = f.extraction.lines?.[q.line_index]
      if (!line) continue

      const reclassifyRes = await authFetch('/api/invoices/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reclassify',
          line,
          line_index: q.line_index,
          supplier_name: f.extraction.supplier?.name || 'Inconnu',
          question: q.question,
          user_answer: answer,
        }),
      })

      if (reclassifyRes.ok) {
        const { classification } = await reclassifyRes.json()
        allClassifications.push(classification)
      }
    }

    await finalizeClassification(fileIndex, f.invoiceId, f.extraction, allClassifications)
  }

  const finalizeClassification = async (
    fileIndex: number,
    invoiceId: string,
    extraction: UploadedFile['extraction'],
    classifications: UploadedFile['classifications']
  ) => {
    if (!extraction?.lines) return

    const linesData = extraction.lines.map((line, i) => {
      const classification = classifications?.find((c) => c.line_index === i)
      return {
        invoice_id: invoiceId,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        total_ht: line.total_ht,
        tva_rate: line.tva_rate,
        tva_amount: line.tva_amount,
        total_ttc: line.total_ttc,
        pcg_code: classification?.pcg_code || null,
        pcg_label: classification?.pcg_label || null,
        confidence_score: classification?.confidence || null,
        journal_code: classification?.journal_code || null,
        reasoning: classification?.reasoning || null,
        is_immobilization: classification?.is_immobilization || false,
        amortization_rate: classification?.amortization_rate || null,
        classification_method: classification?.classification_method || null,
      }
    })

    await authFetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'classified' }),
    })

    await authFetch(`/api/invoices/${invoiceId}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: linesData }),
    })

    setFiles((prev) =>
      prev.map((f, i) => (i === fileIndex ? { ...f, status: 'done', progress: 100 } : f))
    )
  }

  const processAll = async () => {
    let count = 0
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'pending') {
        if (count > 0) await new Promise(r => setTimeout(r, 5000))
        await processFile(i)
        count++
      }
    }
  }

  const getFileIcon = (type: string) => {
    if (type === 'application/pdf') return <FileText className="h-8 w-8 text-accent-red" />
    return <Image className="h-8 w-8 text-accent-blue" />
  }

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin text-accent-green" />
      case 'questions':
        return <MessageCircleQuestion className="h-5 w-5 text-accent-orange" />
      case 'done':
        return <CheckCircle className="h-5 w-5 text-accent-green" />
      case 'duplicate':
        return <Copy className="h-5 w-5 text-accent-orange" />
      case 'error':
        return <AlertCircle className="h-5 w-5 text-accent-red" />
      default:
        return null
    }
  }

  const getStatusLabel = (f: UploadedFile) => {
    switch (f.status) {
      case 'uploading': return 'Upload en cours...'
      case 'processing': return 'Analyse IA en cours...'
      case 'questions': return "L'IA a besoin de precisions"
      case 'done': {
        const typeLabel = f.documentType === 'revenue' ? 'RECETTE' : 'DEPENSE'
        if (f.autoClassified) return `${typeLabel} — Classifie auto (fournisseur memorise)`
        if (f.knownSupplier) return `${typeLabel} — Fournisseur connu BOEHME`
        return `${typeLabel} — Classifie par IA`
      }
      case 'duplicate': return `Doublon ignore (deja presente : ${f.duplicateOf || ''})`
      case 'error': return 'Erreur'
      default: return 'En attente'
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
          isDragOver ? 'border-accent-green bg-accent-green/5' : 'border-dark-border bg-dark-card hover:border-gray-500'
        }`}
      >
        <Upload className={`mb-4 h-12 w-12 ${isDragOver ? 'text-accent-green' : 'text-gray-500'}`} />
        <p className="mb-2 text-lg font-medium text-gray-300">Glissez-deposez vos factures ici</p>
        <p className="mb-4 text-sm text-gray-500">PDF, JPG, PNG ou TIFF</p>
        <label className="btn-primary cursor-pointer">
          Parcourir les fichiers
          <input
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            className="hidden"
          />
        </label>
      </div>

      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-400">
              {files.length} fichier{files.length > 1 ? 's' : ''} selectionne{files.length > 1 ? 's' : ''}
            </h3>
            {files.some(f => f.status === 'pending') && (
              <button onClick={processAll} className="btn-primary">Traiter tout</button>
            )}
          </div>

          {files.map((f, index) => (
            <div key={index} className="rounded-lg border border-dark-border bg-dark-card overflow-hidden">
              <div className="flex items-center gap-4 p-4">
                {getFileIcon(f.file.type)}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">{f.file.name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500">{(f.file.size / 1024 / 1024).toFixed(2)} Mo</p>
                    <span className={`text-xs font-medium flex items-center gap-1 ${
                      f.status === 'questions' ? 'text-accent-orange' :
                      f.status === 'done' ? 'text-accent-green' :
                      f.status === 'error' ? 'text-accent-red' :
                      f.status === 'duplicate' ? 'text-accent-orange' :
                      'text-gray-500'
                    }`}>
                      {f.status === 'done' && f.documentType === 'revenue' && (
                        <span className="inline-flex items-center rounded-full bg-accent-green/20 px-1.5 py-0.5 text-[10px] font-bold text-accent-green mr-1">RECETTE</span>
                      )}
                      {f.status === 'done' && f.documentType === 'expense' && (
                        <span className="inline-flex items-center rounded-full bg-accent-red/20 px-1.5 py-0.5 text-[10px] font-bold text-accent-red mr-1">DEPENSE</span>
                      )}
                      {(f.knownSupplier || f.autoClassified) && f.status === 'done' && <Zap className="h-3 w-3" />}
                      {getStatusLabel(f)}
                    </span>
                  </div>
                  {(f.status === 'uploading' || f.status === 'processing') && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-dark-input">
                      <div className="h-full rounded-full bg-accent-green transition-all duration-500" style={{ width: `${f.progress}%` }} />
                    </div>
                  )}
                  {f.error && <p className="mt-1 text-xs text-accent-red">{f.error}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {f.status === 'error' && (
                    <button
                      onClick={() => {
                        setFiles(prev => prev.map((file, i) => i === index ? { ...file, status: 'pending', error: undefined, progress: 0 } : file))
                        setTimeout(() => processFile(index), 500)
                      }}
                      className="rounded-lg bg-accent-orange/10 px-3 py-1 text-xs font-medium text-accent-orange hover:bg-accent-orange/20 transition-colors"
                    >
                      Reessayer
                    </button>
                  )}
                  {getStatusIcon(f.status)}
                  {f.status === 'pending' && (
                    <button onClick={() => removeFile(index)} className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-300">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {f.status === 'questions' && f.questions && (
                <div className="border-t border-accent-orange/30 bg-accent-orange/5 p-4 space-y-4">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageCircleQuestion className="h-5 w-5 text-accent-orange" />
                    <h4 className="text-sm font-semibold text-accent-orange">
                      L&apos;IA a besoin de votre aide pour {f.questions.length} ligne{f.questions.length > 1 ? 's' : ''}
                    </h4>
                  </div>

                  {f.questions.map((q) => (
                    <div key={q.line_index} className="rounded-lg border border-dark-border bg-dark-card p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-200">{q.description}</p>
                          <p className="text-xs text-gray-500 font-mono">{q.total_ht} EUR HT</p>
                        </div>
                        {q.current_best && (
                          <span className="text-xs text-gray-500 font-mono">
                            Suggestion : {q.current_best.code} ({Math.round(q.current_best.confidence * 100)}%)
                          </span>
                        )}
                      </div>

                      <div className="rounded-lg bg-accent-orange/10 border border-accent-orange/20 p-3">
                        <p className="text-sm text-accent-orange font-medium">{q.question}</p>
                      </div>

                      {q.answer_choices && q.answer_choices.length > 0 && (
                        <div className="space-y-2">
                          {q.answer_choices.map((choice) => {
                            const isSelected = f.answers?.[q.line_index] === choice.label
                            return (
                              <button
                                key={choice.pcg_code}
                                onClick={() => setAnswer(index, q.line_index, choice.label)}
                                className={`w-full rounded-lg border-2 p-3 text-left transition-all ${
                                  isSelected
                                    ? 'border-accent-green bg-accent-green/10'
                                    : 'border-dark-border bg-dark-input hover:border-accent-green/50'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className={`text-sm font-medium ${isSelected ? 'text-accent-green' : 'text-gray-300'}`}>
                                    {choice.label}
                                  </span>
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${
                                    isSelected ? 'bg-accent-green/20 text-accent-green' : 'bg-dark-border text-gray-500'
                                  }`}>
                                    {choice.pcg_code}
                                  </span>
                                </div>
                                <p className="mt-0.5 text-xs text-gray-500">{choice.pcg_label}</p>
                              </button>
                            )
                          })}
                        </div>
                      )}

                      <div>
                        <p className="text-xs text-gray-500 mb-1">Ou decrivez autrement :</p>
                        <input
                          type="text"
                          value={q.answer_choices?.some(c => c.label === f.answers?.[q.line_index]) ? '' : (f.answers?.[q.line_index] || '')}
                          onChange={(e) => setAnswer(index, q.line_index, e.target.value)}
                          placeholder="Reponse libre..."
                          className="input-field flex-1 text-sm"
                        />
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => submitAnswers(index)}
                    disabled={!f.questions.every((q) => f.answers?.[q.line_index])}
                    className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    Envoyer les reponses et finaliser
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
