'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import { useRouter } from 'next/navigation'
import {
  Users, Upload, FileText, Loader2, Trash2, Check, AlertTriangle, Landmark, Search, X, CheckCircle,
} from 'lucide-react'

interface PayslipData {
  employee_name: string
  employee_role: string | null
  period: string
  gross_salary: number
  net_salary_before_tax: number
  net_salary_after_tax: number
  employer_charges: number
  employee_charges: number
  advance_amount: number
  remaining_to_pay: number
  hours_worked: number | null
  overtime_hours: number | null
  bonuses: { label: string; amount: number }[]
  deductions: { label: string; amount: number }[]
  employer_name: string
  contract_type: string | null
  paid_leave_balance: number | null
  cumul_brut_annuel: number | null
  cumul_net_imposable: number | null
}

interface Payslip {
  id: string
  employee_name: string
  employee_role: string | null
  month: string
  gross_salary: number
  net_salary: number
  net_after_tax: number
  employer_charges: number
  employee_charges: number
  advance_amount: number
  remaining_salary: number
  file_name: string | null
  status: string
  contract_type: string | null
  bonuses: { label: string; amount: number }[]
  created_at: string
}

interface UploadingFile {
  file: File
  status: 'uploading' | 'extracting' | 'extracted' | 'saving' | 'done' | 'error'
  progress: number
  data?: PayslipData
  error?: string
}

const fmt = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' \u20AC'

const MONTHS = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
]

function getMonthOptions() {
  const opts = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    opts.push({ value: val, label })
  }
  return opts
}

export default function PersonnelClient() {
  const { user, loading: authLoading } = useAuth()
  const authFetch = useAuthFetch()
  const router = useRouter()

  const monthOptions = getMonthOptions()
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value)
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [bankMatchPayslipId, setBankMatchPayslipId] = useState<string | null>(null)
  const [bankTransactions, setBankTransactions] = useState<any[]>([])
  const [bankSearching, setBankSearching] = useState(false)
  const [bankSearch, setBankSearch] = useState('')
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([])
  const [bankMatchedPayslips, setBankMatchedPayslips] = useState<Record<string, string[]>>({})
  const [bankMatching, setBankMatching] = useState(false)

  const openBankMatch = async (payslipId: string) => {
    if (bankMatchPayslipId === payslipId) {
      setBankMatchPayslipId(null)
      return
    }
    setBankMatchPayslipId(payslipId)
    setSelectedTxIds([])
    setBankSearch('')
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
  }

  const handleBankMatch = async (payslipId: string) => {
    if (selectedTxIds.length === 0) return
    setBankMatching(true)
    try {
      const res = await authFetch(`/api/payslips/${payslipId}/match-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: selectedTxIds }),
      })
      if (res.ok) {
        setBankMatchedPayslips((prev) => ({ ...prev, [payslipId]: selectedTxIds }))
        setBankMatchPayslipId(null)
        setSelectedTxIds([])
      }
    } catch (e) {
      console.error('Match error:', e)
    }
    setBankMatching(false)
  }

  const fetchPayslips = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const res = await authFetch(`/api/payslips?month=${selectedMonth}`)
      if (res.ok) {
        const data = await res.json()
        setPayslips(Array.isArray(data) ? data : data.payslips || [])
      }
    } catch { /* */ }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedMonth])

  useEffect(() => {
    if (!authLoading && user) fetchPayslips()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, selectedMonth])

  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  const processFile = async (file: File, index: number) => {
    setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'extracting', progress: 30 } : f))

    const extractForm = new FormData()
    extractForm.append('file', file)

    try {
      const extractRes = await authFetch('/api/payslips/extract', {
        method: 'POST',
        body: extractForm,
      })

      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({ error: 'Erreur extraction' }))
        setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error', error: err.error } : f))
        return
      }

      const { data } = await extractRes.json() as { data: PayslipData }
      setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'extracted', progress: 70, data } : f))

      // Save
      setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'saving', progress: 85 } : f))

      const saveForm = new FormData()
      saveForm.append('file', file)
      saveForm.append('employee_name', data.employee_name || '')
      saveForm.append('employee_role', data.employee_role || '')
      saveForm.append('month', data.period || selectedMonth)
      saveForm.append('gross_salary', String(data.gross_salary || 0))
      saveForm.append('net_salary', String(data.net_salary_after_tax || data.net_salary_before_tax || 0))
      saveForm.append('employer_charges', String(data.employer_charges || 0))
      saveForm.append('employee_charges', String(data.employee_charges || 0))
      saveForm.append('advance_amount', String(data.advance_amount || 0))
      saveForm.append('contract_type', data.contract_type || '')
      saveForm.append('bonuses', JSON.stringify(data.bonuses || []))

      const saveRes = await authFetch('/api/payslips', { method: 'POST', body: saveForm })

      if (!saveRes.ok) {
        setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error', error: 'Erreur sauvegarde' } : f))
        return
      }

      setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'done', progress: 100 } : f))
      fetchPayslips()
    } catch (e) {
      setUploadingFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error', error: 'Erreur inattendue' } : f))
    }
  }

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files)
    const startIdx = uploadingFiles.length
    const newFiles: UploadingFile[] = arr.map(f => ({ file: f, status: 'uploading' as const, progress: 10 }))
    setUploadingFiles(prev => [...prev, ...newFiles])
    const processSequentially = async () => {
      for (let i = 0; i < arr.length; i++) {
        await processFile(arr[i], startIdx + i)
        if (i < arr.length - 1) await new Promise(r => setTimeout(r, 2000))
      }
    }
    processSequentially()
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }, [uploadingFiles.length])

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer ce bulletin de paie ?')) return
    await authFetch(`/api/payslips/${id}`, { method: 'DELETE' })
    fetchPayslips()
  }

  const totalBrut = payslips.reduce((s, p) => s + (p.gross_salary || 0), 0)
  const totalNet = payslips.reduce((s, p) => s + (p.net_after_tax || p.net_salary || 0), 0)
  const totalCharges = payslips.reduce((s, p) => s + (p.employer_charges || 0), 0)
  const totalAcomptes = payslips.reduce((s, p) => s + (p.advance_amount || 0), 0)
  const totalSoldes = payslips.reduce((s, p) => s + (p.remaining_salary || 0), 0)

  if (authLoading) return <AppLayout><div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent-green" /></div></AppLayout>

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-purple-500/10 p-3"><Users className="h-6 w-6 text-purple-400" /></div>
            <div>
              <h1 className="text-2xl font-bold text-white">Frais de personnel</h1>
              <p className="text-sm text-gray-500">Upload des bulletins de paie — extraction automatique par IA</p>
            </div>
          </div>
        </div>

        <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="input-field w-48">
          {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Upload zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${isDragOver ? 'border-accent-green bg-accent-green/5' : 'border-dark-border'}`}
        >
          <Upload className="mx-auto h-10 w-10 text-gray-500" />
          <p className="mt-2 text-gray-300">Glissez-deposez vos bulletins de paie (PDF)</p>
          <p className="text-xs text-gray-500">L&apos;IA extrait automatiquement : employe, brut, net, charges, acompte, solde...</p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg bg-accent-green px-4 py-2 text-sm font-semibold text-dark-bg hover:bg-accent-green/90">
            Parcourir les fichiers
            <input type="file" accept=".pdf" multiple className="hidden" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
          </label>
        </div>

        {/* Upload progress */}
        {uploadingFiles.length > 0 && (
          <div className="space-y-2">
            {uploadingFiles.map((uf, i) => (
              <div key={i} className="card flex items-center gap-3 p-3">
                <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">{uf.file.name}</p>
                  <p className={`text-xs ${uf.status === 'error' ? 'text-accent-red' : uf.status === 'done' ? 'text-accent-green' : 'text-gray-500'}`}>
                    {uf.status === 'uploading' && 'Upload...'}
                    {uf.status === 'extracting' && 'Extraction IA en cours...'}
                    {uf.status === 'extracted' && `Extrait : ${uf.data?.employee_name} — Brut ${fmt(uf.data?.gross_salary || 0)}`}
                    {uf.status === 'saving' && 'Sauvegarde...'}
                    {uf.status === 'done' && `${uf.data?.employee_name} — ${uf.data?.period}`}
                    {uf.status === 'error' && uf.error}
                  </p>
                  {['uploading', 'extracting', 'saving'].includes(uf.status) && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-dark-input">
                      <div className="h-full rounded-full bg-accent-green transition-all" style={{ width: `${uf.progress}%` }} />
                    </div>
                  )}
                </div>
                {uf.status === 'done' && <Check className="h-5 w-5 text-accent-green shrink-0" />}
                {uf.status === 'error' && <AlertTriangle className="h-5 w-5 text-accent-red shrink-0" />}
                {uf.status === 'extracting' && <Loader2 className="h-5 w-5 animate-spin text-accent-green shrink-0" />}
              </div>
            ))}
          </div>
        )}

        {/* Summary cards */}
        {payslips.length > 0 && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            {[
              { label: 'TOTAL BRUT', value: totalBrut, color: 'text-white' },
              { label: 'TOTAL NET', value: totalNet, color: 'text-accent-green' },
              { label: 'CHARGES PATRON', value: totalCharges, color: 'text-accent-orange' },
              { label: 'ACOMPTES', value: totalAcomptes, color: 'text-accent-blue' },
              { label: 'SOLDES A VERSER', value: totalSoldes, color: 'text-purple-400' },
            ].map((c) => (
              <div key={c.label} className="card p-4">
                <p className="text-xs font-medium text-gray-500">{c.label}</p>
                <p className={`mt-1 font-mono text-lg font-bold ${c.color}`}>{fmt(c.value)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Payslips table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent-green" /></div>
          ) : payslips.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users className="mx-auto h-12 w-12 text-gray-600" />
              <p className="mt-2">Aucun bulletin pour cette periode</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border bg-dark-input/50 text-left text-xs font-medium uppercase text-gray-500">
                    <th className="px-4 py-3">Employe</th>
                    <th className="px-4 py-3">Contrat</th>
                    <th className="px-4 py-3 text-right">Brut</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3 text-right">Charges</th>
                    <th className="px-4 py-3 text-right">Acompte</th>
                    <th className="px-4 py-3 text-right">Solde</th>
                    <th className="px-4 py-3">Fichier</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <React.Fragment key={p.id}>
                    <tr className="border-b border-dark-border/50 hover:bg-dark-hover/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-200">{p.employee_name}</p>
                        {p.employee_role && <p className="text-xs text-gray-500">{p.employee_role}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{p.contract_type || '-'}</td>
                      <td className="px-4 py-3 text-right font-mono text-gray-200">{fmt(p.gross_salary)}</td>
                      <td className="px-4 py-3 text-right font-mono text-accent-green">{fmt(p.net_after_tax || p.net_salary)}</td>
                      <td className="px-4 py-3 text-right font-mono text-accent-orange">{fmt(p.employer_charges)}</td>
                      <td className="px-4 py-3 text-right font-mono text-accent-blue">{fmt(p.advance_amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-purple-400">{fmt(p.remaining_salary)}</td>
                      <td className="px-4 py-3"><span className="text-xs text-gray-400 truncate block max-w-[120px]">{p.file_name || '-'}</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {bankMatchedPayslips[p.id] ? (
                            <span className="flex items-center gap-1 rounded bg-accent-green/10 px-2 py-1 text-[10px] font-medium text-accent-green">
                              <CheckCircle className="h-3 w-3" /> Rapproche
                            </span>
                          ) : (
                            <button
                              onClick={() => openBankMatch(p.id)}
                              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                bankMatchPayslipId === p.id
                                  ? 'bg-accent-green/10 text-accent-green'
                                  : 'text-accent-green hover:bg-accent-green/10'
                              }`}
                            >
                              <Landmark className="h-3.5 w-3.5" />
                              Rapprocher
                            </button>
                          )}
                          <button onClick={() => handleDelete(p.id)} className="rounded p-1 text-gray-500 hover:bg-accent-red/10 hover:text-accent-red">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {bankMatchPayslipId === p.id && (
                      <tr>
                        <td colSpan={9} className="border-b border-dark-border/50 bg-dark-input/30 px-4 py-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Rapprochement bancaire — {p.employee_name}
                              </h4>
                              <button onClick={() => setBankMatchPayslipId(null)} className="rounded p-1 text-gray-500 hover:bg-dark-hover hover:text-gray-200">
                                <X className="h-4 w-4" />
                              </button>
                            </div>

                            {bankSearching ? (
                              <div className="flex h-16 items-center justify-center">
                                <Loader2 className="h-5 w-5 animate-spin text-accent-green" />
                              </div>
                            ) : (() => {
                              const amounts = [p.advance_amount, p.remaining_salary, p.net_after_tax || p.net_salary].filter(a => a > 0)
                              const matchingTx = bankTransactions.filter((tx: any) =>
                                amounts.some(amt => Math.abs(tx.amount - amt) <= 1)
                              ).sort((a: any, b: any) => {
                                const aDist = Math.min(...amounts.map(amt => Math.abs(a.amount - amt)))
                                const bDist = Math.min(...amounts.map(amt => Math.abs(b.amount - amt)))
                                return aDist - bDist
                              })
                              const otherTx = bankTransactions.filter((tx: any) =>
                                !amounts.some(amt => Math.abs(tx.amount - amt) <= 1)
                              )
                              const allSorted = [...matchingTx, ...otherTx]
                              const filtered = bankSearch
                                ? allSorted.filter((tx: any) => (tx.label || '').toLowerCase().includes(bankSearch.toLowerCase()))
                                : allSorted

                              return (
                                <>
                                  <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span>Montants recherches :</span>
                                    {p.advance_amount > 0 && <span className="rounded bg-accent-blue/10 px-1.5 py-0.5 font-mono text-accent-blue">Acompte {fmt(p.advance_amount)}</span>}
                                    {p.remaining_salary > 0 && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 font-mono text-purple-400">Solde {fmt(p.remaining_salary)}</span>}
                                    <span className="rounded bg-accent-green/10 px-1.5 py-0.5 font-mono text-accent-green">Net {fmt(p.net_after_tax || p.net_salary)}</span>
                                  </div>

                                  <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                                    <input
                                      type="text"
                                      value={bankSearch}
                                      onChange={(e) => setBankSearch(e.target.value)}
                                      placeholder="Rechercher par libelle..."
                                      className="input-field w-full pl-9 text-sm"
                                    />
                                  </div>

                                  <div className="max-h-48 space-y-1 overflow-y-auto">
                                    {filtered.length === 0 && (
                                      <p className="py-4 text-center text-sm text-gray-500">Aucune transaction non rapprochee.</p>
                                    )}
                                    {filtered.map((tx: any) => {
                                      const isAmountMatch = amounts.some(amt => Math.abs(tx.amount - amt) <= 1)
                                      const isSelected = selectedTxIds.includes(tx.id)
                                      return (
                                        <label
                                          key={tx.id}
                                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-all hover:border-accent-green/50 ${
                                            isSelected ? 'border-accent-green/50 bg-accent-green/5' : isAmountMatch ? 'border-accent-green/20 bg-accent-green/5' : 'border-dark-border bg-dark-card'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => {
                                              setSelectedTxIds((prev) =>
                                                prev.includes(tx.id) ? prev.filter((id) => id !== tx.id) : [...prev, tx.id]
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
                                          <div className="shrink-0 text-right">
                                            <span className={`font-mono text-sm font-medium ${
                                              tx.type === 'debit' ? 'text-accent-red' : 'text-accent-green'
                                            }`}>
                                              {tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' \u20AC'}
                                            </span>
                                            {isAmountMatch && (
                                              <span className="ml-2 rounded bg-accent-green/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-green">
                                                MATCH
                                              </span>
                                            )}
                                          </div>
                                        </label>
                                      )
                                    })}
                                  </div>

                                  {selectedTxIds.length > 0 && (
                                    <div className="flex items-center justify-end gap-2">
                                      <span className="text-xs text-gray-500">{selectedTxIds.length} transaction(s) selectionnee(s)</span>
                                      <button
                                        onClick={() => handleBankMatch(p.id)}
                                        disabled={bankMatching}
                                        className="flex items-center gap-1.5 rounded-lg bg-accent-green px-3 py-1.5 text-xs font-semibold text-dark-bg hover:bg-accent-green/90 transition-colors disabled:opacity-50"
                                      >
                                        {bankMatching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                        Confirmer le rapprochement
                                      </button>
                                    </div>
                                  )}
                                </>
                              )
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                  <tr className="border-t-2 border-dark-border bg-dark-input/30 font-bold">
                    <td className="px-4 py-3 text-gray-300" colSpan={2}>TOTAL ({payslips.length} bulletins)</td>
                    <td className="px-4 py-3 text-right font-mono text-white">{fmt(totalBrut)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent-green">{fmt(totalNet)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent-orange">{fmt(totalCharges)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent-blue">{fmt(totalAcomptes)}</td>
                    <td className="px-4 py-3 text-right font-mono text-purple-400">{fmt(totalSoldes)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
