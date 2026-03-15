'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuthFetch } from '@/lib/firebase/auth-context'
import { StatusBadge } from '@/components/ui/Badge'
import { FileText, Search, Filter } from 'lucide-react'
import type { Invoice, InvoiceStatus } from '@/types'

export default function InvoiceList() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const authFetch = useAuthFetch()

  useEffect(() => {
    fetchInvoices()
  }, [statusFilter])

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const url = statusFilter === 'all'
        ? '/api/invoices'
        : `/api/invoices?status=${statusFilter}`
      const res = await authFetch(url)
      if (res.ok) {
        const data = await res.json()
        setInvoices(data)
      }
    } catch (e) {
      console.error('Fetch invoices error:', e)
    }
    setLoading(false)
  }

  const filtered = invoices.filter((inv) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      inv.file_name.toLowerCase().includes(q) ||
      inv.supplier_name?.toLowerCase().includes(q) ||
      inv.invoice_number?.toLowerCase().includes(q)
    )
  })

  const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('fr-FR')
  }

  const formatAmount = (amount: number | null) => {
    if (amount == null) return '-'
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par fournisseur, fichier, n° facture..."
            className="input-field pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
            className="input-field w-auto"
          >
            <option value="all">Tous les statuts</option>
            <option value="pending">En attente</option>
            <option value="processing">Traitement</option>
            <option value="classified">Classifié</option>
            <option value="validated">Validé</option>
            <option value="exported">Exporté</option>
            <option value="error">Erreur</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-gray-500">
            <FileText className="mb-3 h-12 w-12 text-gray-300" />
            <p className="text-sm">Aucune facture trouvée</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fichier</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fournisseur</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">N° Facture</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Montant TTC</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((invoice) => (
                <tr key={invoice.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${invoice.id}`} className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700">
                      <FileText className="h-4 w-4" />
                      <span className="max-w-[200px] truncate">{invoice.file_name}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{invoice.supplier_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{invoice.invoice_number || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(invoice.invoice_date)}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatAmount(invoice.total_ttc)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={invoice.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
