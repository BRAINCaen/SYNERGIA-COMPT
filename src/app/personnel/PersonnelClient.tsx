'use client'

import { useState, useEffect, useMemo } from 'react'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import {
  Users,
  Plus,
  Check,
  Trash2,
  Pencil,
  Upload,
  Download,
  FileText,
  Link2,
  Loader2,
  X,
  AlertCircle,
  UserPlus,
} from 'lucide-react'
import type { Payslip, Employee, BankTransaction } from '@/types'

// ── Helpers ──────────────────────────────────────────
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function generateMonths(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function formatAmount(amount: number | null): string {
  if (amount == null) return '-'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  validated: 'bg-green-500/20 text-green-400 border-green-500/30',
}
const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  validated: 'Valide',
}

// ── Form defaults ───────────────────────────────────
interface PayslipForm {
  employee_id: string
  employee_name: string
  month: string
  gross_salary: string
  net_salary: string
  employer_charges: string
  advance_amount: string
  file: File | null
}

interface EmployeeForm {
  name: string
  role: string
  monthly_gross: string
}

// ── Component ───────────────────────────────────────
export default function PersonnelClient() {
  const authFetch = useAuthFetch()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [unmatchedTransactions, setUnmatchedTransactions] = useState<BankTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth)
  const [employeeFilter, setEmployeeFilter] = useState<string>('all')
  const [showPayslipForm, setShowPayslipForm] = useState(false)
  const [showEmployeeForm, setShowEmployeeForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [matchingPayslipId, setMatchingPayslipId] = useState<string | null>(null)
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([])
  const [matchSaving, setMatchSaving] = useState(false)

  const emptyPayslipForm: PayslipForm = {
    employee_id: '',
    employee_name: '',
    month: month,
    gross_salary: '',
    net_salary: '',
    employer_charges: '',
    advance_amount: '0',
    file: null,
  }
  const [payslipForm, setPayslipForm] = useState<PayslipForm>(emptyPayslipForm)

  const emptyEmployeeForm: EmployeeForm = { name: '', role: '', monthly_gross: '' }
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployeeForm)

  // Fetch data
  useEffect(() => {
    fetchAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [payslipsRes, employeesRes, txRes] = await Promise.all([
        authFetch(`/api/payslips?month=${month}`),
        authFetch('/api/employees'),
        authFetch(`/api/bank-statements/transactions?month=${month}&match_status=unmatched`).catch(() => null),
      ])
      if (payslipsRes.ok) {
        const data = await payslipsRes.json()
        setPayslips(data)
      }
      if (employeesRes.ok) {
        const data = await employeesRes.json()
        setEmployees(data)
      }
      if (txRes?.ok) {
        const data = await txRes.json()
        setUnmatchedTransactions(Array.isArray(data) ? data : data.transactions || [])
      }
    } catch (e) {
      console.error('Fetch personnel error:', e)
    }
    setLoading(false)
  }

  // Computed remaining
  const computedRemaining = useMemo(() => {
    const net = parseFloat(payslipForm.net_salary) || 0
    const advance = parseFloat(payslipForm.advance_amount) || 0
    return net - advance
  }, [payslipForm.net_salary, payslipForm.advance_amount])

  // Filtered payslips
  const filtered = useMemo(() => {
    if (employeeFilter === 'all') return payslips
    return payslips.filter((p) => p.employee_id === employeeFilter || p.employee_name === employeeFilter)
  }, [payslips, employeeFilter])

  // Totals
  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, p) => ({
        gross: acc.gross + p.gross_salary,
        net: acc.net + p.net_salary,
        charges: acc.charges + p.employer_charges,
        advance: acc.advance + p.advance_amount,
        remaining: acc.remaining + p.remaining_salary,
      }),
      { gross: 0, net: 0, charges: 0, advance: 0, remaining: 0 }
    )
  }, [filtered])

  // ── Payslip form handlers ─────────────────────────
  const openAddPayslip = () => {
    setEditingId(null)
    setPayslipForm({ ...emptyPayslipForm, month })
    setShowPayslipForm(true)
  }

  const openEditPayslip = (p: Payslip) => {
    setEditingId(p.id)
    setPayslipForm({
      employee_id: p.employee_id || '',
      employee_name: p.employee_name,
      month: p.month,
      gross_salary: String(p.gross_salary),
      net_salary: String(p.net_salary),
      employer_charges: String(p.employer_charges),
      advance_amount: String(p.advance_amount),
      file: null,
    })
    setShowPayslipForm(true)
  }

  const closePayslipForm = () => {
    setShowPayslipForm(false)
    setEditingId(null)
    setPayslipForm(emptyPayslipForm)
  }

  const handleSavePayslip = async () => {
    setSaving(true)
    try {
      if (editingId) {
        // PATCH existing
        const res = await authFetch(`/api/payslips/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: payslipForm.employee_id || null,
            employee_name: payslipForm.employee_name,
            month: payslipForm.month,
            gross_salary: parseFloat(payslipForm.gross_salary) || 0,
            net_salary: parseFloat(payslipForm.net_salary) || 0,
            employer_charges: parseFloat(payslipForm.employer_charges) || 0,
            advance_amount: parseFloat(payslipForm.advance_amount) || 0,
          }),
        })
        if (res.ok) {
          closePayslipForm()
          await fetchAll()
        }
      } else {
        // POST new with file
        const body = new FormData()
        body.append('employee_id', payslipForm.employee_id)
        body.append('employee_name', payslipForm.employee_name)
        body.append('month', payslipForm.month)
        body.append('gross_salary', payslipForm.gross_salary)
        body.append('net_salary', payslipForm.net_salary)
        body.append('employer_charges', payslipForm.employer_charges)
        body.append('advance_amount', payslipForm.advance_amount || '0')
        if (payslipForm.file) body.append('file', payslipForm.file)

        const res = await authFetch('/api/payslips', { method: 'POST', body })
        if (res.ok) {
          closePayslipForm()
          await fetchAll()
        }
      }
    } catch (e) {
      console.error('Save payslip error:', e)
    }
    setSaving(false)
  }

  const handleValidatePayslip = async (id: string) => {
    try {
      const res = await authFetch(`/api/payslips/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'validated' }),
      })
      if (res.ok) await fetchAll()
    } catch (e) {
      console.error('Validate payslip error:', e)
    }
  }

  const handleDeletePayslip = async (id: string) => {
    if (!confirm('Supprimer ce bulletin de paie ?')) return
    try {
      const res = await authFetch(`/api/payslips/${id}`, { method: 'DELETE' })
      if (res.ok) await fetchAll()
    } catch (e) {
      console.error('Delete payslip error:', e)
    }
  }

  // ── Employee form handlers ────────────────────────
  const handleSaveEmployee = async () => {
    setSaving(true)
    try {
      const res = await authFetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: employeeForm.name,
          role: employeeForm.role || null,
          monthly_gross: employeeForm.monthly_gross ? parseFloat(employeeForm.monthly_gross) : null,
        }),
      })
      if (res.ok) {
        setShowEmployeeForm(false)
        setEmployeeForm(emptyEmployeeForm)
        await fetchAll()
      }
    } catch (e) {
      console.error('Save employee error:', e)
    }
    setSaving(false)
  }

  // ── Match transactions ────────────────────────────
  const openMatchPanel = (payslipId: string) => {
    setMatchingPayslipId(payslipId)
    setSelectedTxIds([])
  }

  const toggleTxSelection = (txId: string) => {
    setSelectedTxIds((prev) =>
      prev.includes(txId) ? prev.filter((id) => id !== txId) : [...prev, txId]
    )
  }

  const handleMatchTransactions = async () => {
    if (!matchingPayslipId || selectedTxIds.length === 0) return
    setMatchSaving(true)
    try {
      const res = await authFetch(`/api/payslips/${matchingPayslipId}/match-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: selectedTxIds }),
      })
      if (res.ok) {
        setMatchingPayslipId(null)
        setSelectedTxIds([])
        await fetchAll()
      }
    } catch (e) {
      console.error('Match transactions error:', e)
    }
    setMatchSaving(false)
  }

  // When employee is selected from dropdown, auto-fill name and gross
  const handleEmployeeSelect = (employeeId: string) => {
    const emp = employees.find((e) => e.id === employeeId)
    if (emp) {
      setPayslipForm((prev) => ({
        ...prev,
        employee_id: emp.id,
        employee_name: emp.name,
        gross_salary: emp.monthly_gross ? String(emp.monthly_gross) : prev.gross_salary,
      }))
    }
  }

  // ── Render ─────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
              <Users className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Frais de personnel</h1>
              <p className="text-sm text-gray-500">Bulletins de paie et charges sociales</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmployeeForm(true)}
              className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              <UserPlus className="h-4 w-4" />
              Nouvel employe
            </button>
            <button onClick={openAddPayslip} className="btn-primary flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Ajouter un bulletin
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
          >
            {generateMonths().map((m) => (
              <option key={m} value={m}>
                {new Date(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEmployeeFilter('all')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                employeeFilter === 'all'
                  ? 'border-accent-green bg-accent-green/10 text-accent-green'
                  : 'border-dark-border text-gray-400 hover:border-gray-500 hover:text-gray-300'
              }`}
            >
              Tous
            </button>
            {employees.filter((e) => e.is_active).map((emp) => (
              <button
                key={emp.id}
                onClick={() => setEmployeeFilter(emp.id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  employeeFilter === emp.id
                    ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                    : 'border-dark-border text-gray-400 hover:border-gray-500 hover:text-gray-300'
                }`}
              >
                {emp.name}
              </button>
            ))}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total brut</p>
            <p className="mt-2 text-xl font-bold font-mono text-gray-200">{formatAmount(totals.gross)}</p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total net</p>
            <p className="mt-2 text-xl font-bold font-mono text-accent-green">{formatAmount(totals.net)}</p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Charges patron</p>
            <p className="mt-2 text-xl font-bold font-mono text-accent-orange">{formatAmount(totals.charges)}</p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Acomptes</p>
            <p className="mt-2 text-xl font-bold font-mono text-accent-blue">{formatAmount(totals.advance)}</p>
          </div>
          <div className="rounded-xl border border-dark-border bg-dark-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Soldes a verser</p>
            <p className="mt-2 text-xl font-bold font-mono text-purple-400">{formatAmount(totals.remaining)}</p>
          </div>
        </div>

        {/* Employee form */}
        {showEmployeeForm && (
          <div className="rounded-xl border border-dark-border bg-dark-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Nouvel employe</h2>
              <button onClick={() => { setShowEmployeeForm(false); setEmployeeForm(emptyEmployeeForm) }} className="text-gray-500 hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Nom complet</label>
                <input
                  type="text"
                  value={employeeForm.name}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })}
                  placeholder="Nom Prenom"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Poste</label>
                <input
                  type="text"
                  value={employeeForm.role}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })}
                  placeholder="Ex: Game master"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Salaire brut mensuel</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={employeeForm.monthly_gross}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, monthly_gross: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleSaveEmployee}
                disabled={saving || !employeeForm.name}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Enregistrer
              </button>
              <button onClick={() => { setShowEmployeeForm(false); setEmployeeForm(emptyEmployeeForm) }} className="btn-secondary">
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Payslip form */}
        {showPayslipForm && (
          <div className="rounded-xl border border-dark-border bg-dark-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                {editingId ? 'Modifier le bulletin' : 'Nouveau bulletin de paie'}
              </h2>
              <button onClick={closePayslipForm} className="text-gray-500 hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Employee */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Employe</label>
                {employees.length > 0 ? (
                  <select
                    value={payslipForm.employee_id}
                    onChange={(e) => handleEmployeeSelect(e.target.value)}
                    className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
                  >
                    <option value="">-- Selectionner --</option>
                    {employees.filter((e) => e.is_active).map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}{emp.role ? ` (${emp.role})` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={payslipForm.employee_name}
                    onChange={(e) => setPayslipForm({ ...payslipForm, employee_name: e.target.value })}
                    placeholder="Nom de l'employe"
                    className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                  />
                )}
              </div>

              {/* Month */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Mois</label>
                <select
                  value={payslipForm.month}
                  onChange={(e) => setPayslipForm({ ...payslipForm, month: e.target.value })}
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-200 focus:border-accent-green focus:outline-none"
                >
                  {generateMonths().map((m) => (
                    <option key={m} value={m}>
                      {new Date(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>

              {/* Gross salary */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Salaire brut</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payslipForm.gross_salary}
                  onChange={(e) => setPayslipForm({ ...payslipForm, gross_salary: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>

              {/* Net salary */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Salaire net</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payslipForm.net_salary}
                  onChange={(e) => setPayslipForm({ ...payslipForm, net_salary: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>

              {/* Employer charges */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Charges patronales</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payslipForm.employer_charges}
                  onChange={(e) => setPayslipForm({ ...payslipForm, employer_charges: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>

              {/* Advance amount */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Acompte verse</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payslipForm.advance_amount}
                  onChange={(e) => setPayslipForm({ ...payslipForm, advance_amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-dark-border bg-dark-input px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-accent-green focus:outline-none"
                />
              </div>

              {/* Remaining (auto) */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-400">Solde a verser</label>
                <div className="flex h-[38px] items-center rounded-lg border border-dark-border bg-dark-input/50 px-3 text-sm font-mono text-accent-green">
                  {formatAmount(computedRemaining)}
                </div>
              </div>

              {/* File upload */}
              {!editingId && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-400">Bulletin PDF</label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-dark-border bg-dark-input px-3 py-2 text-sm text-gray-400 transition-colors hover:border-gray-500">
                    <Upload className="h-4 w-4" />
                    {payslipForm.file ? payslipForm.file.name : 'Choisir un fichier'}
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => setPayslipForm({ ...payslipForm, file: e.target.files?.[0] || null })}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleSavePayslip}
                disabled={saving || !payslipForm.employee_name || !payslipForm.gross_salary || !payslipForm.net_salary}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editingId ? 'Mettre a jour' : 'Enregistrer'}
              </button>
              <button onClick={closePayslipForm} className="btn-secondary">
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Match transactions panel */}
        {matchingPayslipId && (
          <div className="rounded-xl border border-accent-blue/30 bg-dark-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-accent-blue" />
                <h2 className="text-lg font-semibold text-white">Rapprocher des lignes bancaires</h2>
              </div>
              <button onClick={() => { setMatchingPayslipId(null); setSelectedTxIds([]) }} className="text-gray-500 hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-400">
              Selectionnez les lignes de releve bancaire correspondant a ce bulletin (acompte + solde).
            </p>

            {unmatchedTransactions.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune transaction non rapprochee pour ce mois.</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {unmatchedTransactions.map((tx) => (
                  <label
                    key={tx.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedTxIds.includes(tx.id)
                        ? 'border-accent-blue bg-accent-blue/10'
                        : 'border-dark-border hover:border-gray-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTxIds.includes(tx.id)}
                      onChange={() => toggleTxSelection(tx.id)}
                      className="h-4 w-4 rounded border-gray-600 bg-dark-input text-accent-blue focus:ring-accent-blue"
                    />
                    <span className="font-mono text-xs text-gray-400">{tx.date}</span>
                    <span className="flex-1 truncate text-sm text-gray-200">{tx.label}</span>
                    <span className={`font-mono text-sm font-medium ${tx.type === 'debit' ? 'text-accent-red' : 'text-accent-green'}`}>
                      {tx.type === 'debit' ? '-' : '+'}{formatAmount(Math.abs(tx.amount))}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {selectedTxIds.length > 0 && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleMatchTransactions}
                  disabled={matchSaving}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {matchSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Rapprocher {selectedTxIds.length} ligne{selectedTxIds.length > 1 ? 's' : ''}
                </button>
                <span className="text-xs text-gray-500">
                  {selectedTxIds.length} transaction{selectedTxIds.length > 1 ? 's' : ''} selectionnee{selectedTxIds.length > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Payslips table */}
        <div className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-8 w-8 animate-spin text-accent-green" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-gray-500">
              <Users className="mb-3 h-12 w-12 text-gray-600" />
              <p className="text-sm">Aucun bulletin de paie pour cette periode</p>
              <button onClick={openAddPayslip} className="mt-3 text-sm text-accent-green hover:underline">
                Ajouter un bulletin
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Employe</th>
                    <th className="px-4 py-3 text-right">Brut</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3 text-right">Charges</th>
                    <th className="px-4 py-3 text-right">Acompte</th>
                    <th className="px-4 py-3 text-right">Solde</th>
                    <th className="px-4 py-3">Fichier</th>
                    <th className="px-4 py-3">Rapprochement</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-border">
                  {filtered.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-dark-hover">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-200">
                        {p.employee_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-gray-200">
                        {formatAmount(p.gross_salary)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-gray-200">
                        {formatAmount(p.net_salary)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-accent-orange">
                        {formatAmount(p.employer_charges)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-accent-blue">
                        {formatAmount(p.advance_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-medium text-purple-400">
                        {formatAmount(p.remaining_salary)}
                      </td>
                      <td className="px-4 py-3">
                        {p.file_path ? (
                          <span className="inline-flex items-center gap-1 text-xs text-accent-blue">
                            <FileText className="h-3.5 w-3.5" />
                            {p.file_name || 'PDF'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {p.matched_transaction_ids && p.matched_transaction_ids.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/20 px-2.5 py-0.5 text-xs font-medium text-green-400">
                            <Link2 className="h-3 w-3" />
                            {p.matched_transaction_ids.length} ligne{p.matched_transaction_ids.length > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <button
                            onClick={() => openMatchPanel(p.id)}
                            className="inline-flex items-center gap-1 rounded-full border border-accent-orange/30 bg-accent-orange/10 px-2.5 py-0.5 text-xs font-medium text-accent-orange transition-colors hover:bg-accent-orange/20"
                          >
                            <AlertCircle className="h-3 w-3" />
                            Non rapproche
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] || STATUS_STYLES.draft}`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'draft' && (
                            <>
                              <button
                                onClick={() => openEditPayslip(p)}
                                title="Modifier"
                                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-dark-hover hover:text-gray-300"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleValidatePayslip(p.id)}
                                title="Valider"
                                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-accent-green/10 hover:text-accent-green"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeletePayslip(p.id)}
                                title="Supprimer"
                                className="rounded p-1.5 text-gray-500 transition-colors hover:bg-accent-red/10 hover:text-accent-red"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {p.status === 'validated' && (
                            <span className="text-xs text-gray-500">Valide</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="border-t-2 border-dark-border bg-dark-bg/50 font-semibold">
                    <td className="px-4 py-3 text-gray-300">TOTAL</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-200">{formatAmount(totals.gross)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-200">{formatAmount(totals.net)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent-orange">{formatAmount(totals.charges)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent-blue">{formatAmount(totals.advance)}</td>
                    <td className="px-4 py-3 text-right font-mono text-purple-400">{formatAmount(totals.remaining)}</td>
                    <td colSpan={4} />
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
