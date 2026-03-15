'use client'

import { useState, useCallback } from 'react'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import { Upload, X, FileText, Image, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

interface UploadedFile {
  file: File
  status: 'pending' | 'uploading' | 'processing' | 'done' | 'error'
  progress: number
  invoiceId?: string
  error?: string
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
      prev.map((f, i) => (i === index ? { ...f, status: 'uploading', progress: 30 } : f))
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
        prev.map((f, i) => (i === index ? { ...f, status: 'error', error: err.error } : f))
      )
      return
    }

    const { invoice } = await uploadRes.json()

    setFiles((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, status: 'processing', progress: 50, invoiceId: invoice.id } : f
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
      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, status: 'error', error: "Erreur d'extraction" } : f))
      )
      return
    }

    const { data: extraction } = await extractRes.json()

    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, progress: 70 } : f))
    )

    // Update invoice with extracted data
    await authFetch(`/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

    // Step 3: Classify
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, progress: 80 } : f))
    )

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

      const linesData = extraction.lines.map((line: { description: string; quantity?: number; unit_price?: number; total_ht: number; tva_rate?: number; tva_amount?: number; total_ttc?: number }, i: number) => {
        const classification = classifications?.find(
          (c: { line_index: number }) => c.line_index === i
        )
        return {
          invoice_id: invoice.id,
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
        }
      })

      await authFetch(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'classified' }),
      })

      await authFetch(`/api/invoices/${invoice.id}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: linesData }),
      })
    }

    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, status: 'done', progress: 100 } : f))
    )
  }

  const processAll = async () => {
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'pending') {
        await processFile(i)
      }
    }
  }

  const getFileIcon = (type: string) => {
    if (type === 'application/pdf') return <FileText className="h-8 w-8 text-red-500" />
    return <Image className="h-8 w-8 text-blue-500" />
  }

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
      case 'done':
        return <CheckCircle className="h-5 w-5 text-green-600" />
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-600" />
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors ${
          isDragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 bg-white hover:border-gray-400'
        }`}
      >
        <Upload className={`mb-4 h-12 w-12 ${isDragOver ? 'text-primary-500' : 'text-gray-400'}`} />
        <p className="mb-2 text-lg font-medium text-gray-700">Glissez-déposez vos factures ici</p>
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
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700">
              {files.length} fichier{files.length > 1 ? 's' : ''} sélectionné{files.length > 1 ? 's' : ''}
            </h3>
            <button onClick={processAll} className="btn-primary">Traiter tout</button>
          </div>

          {files.map((f, index) => (
            <div key={index} className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
              {getFileIcon(f.file.type)}
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{f.file.name}</p>
                <p className="text-xs text-gray-500">{(f.file.size / 1024 / 1024).toFixed(2)} Mo</p>
                {(f.status === 'uploading' || f.status === 'processing') && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div className="h-full rounded-full bg-primary-600 transition-all duration-500" style={{ width: `${f.progress}%` }} />
                  </div>
                )}
                {f.error && <p className="mt-1 text-xs text-red-600">{f.error}</p>}
              </div>
              <div className="flex items-center gap-2">
                {getStatusIcon(f.status)}
                {f.status === 'pending' && (
                  <button onClick={() => removeFile(index)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
