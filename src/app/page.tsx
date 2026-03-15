'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileText, Upload, CheckCircle, Download, Clock, AlertTriangle, Loader2,
} from 'lucide-react'

interface Stats {
  total: number
  pending: number
  processing: number
  classified: number
  validated: number
  exported: number
  error: number
}

interface RecentInvoice {
  id: string
  file_name: string
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  total_ttc: number | null
  status: string
  created_at: string
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth()
  const authFetch = useAuthFetch()
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<RecentInvoice[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.push('/login')
      return
    }
    fetchDashboard()
  }, [user, authLoading])

  const fetchDashboard = async () => {
    try {
      const res = await authFetch('/api/invoices/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data.stats)
        setRecent(data.recent)
      }
    } catch (e) {
      console.error('Dashboard fetch error:', e)
    }
    setLoading(false)
  }

  if (authLoading || loading) {
    return (
      <AppLayout>
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      </AppLayout>
    )
  }

  const statCards = [
    { label: 'Total factures', value: stats?.total || 0, icon: FileText, color: 'text-gray-600 bg-gray-100' },
    { label: 'En attente', value: (stats?.pending || 0) + (stats?.classified || 0), icon: Clock, color: 'text-yellow-600 bg-yellow-100' },
    { label: 'Validées', value: stats?.validated || 0, icon: CheckCircle, color: 'text-green-600 bg-green-100' },
    { label: 'Exportées', value: stats?.exported || 0, icon: Download, color: 'text-purple-600 bg-purple-100' },
  ]

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="mt-1 text-sm text-gray-500">Vue d&apos;ensemble de votre comptabilité</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="card flex items-center gap-4">
              <div className={`rounded-xl p-3 ${stat.color}`}>
                <stat.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {(stats?.error || 0) > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <p className="text-sm text-red-700">
              {stats!.error} facture{stats!.error > 1 ? 's' : ''} en erreur.{' '}
              <Link href="/invoices?status=error" className="font-medium underline">Voir</Link>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link href="/invoices/upload" className="card flex items-center gap-4 transition-shadow hover:shadow-md">
            <div className="rounded-xl bg-primary-100 p-3 text-primary-600"><Upload className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-gray-900">Uploader des factures</p>
              <p className="text-sm text-gray-500">PDF, JPG, PNG, TIFF</p>
            </div>
          </Link>
          <Link href="/invoices?status=classified" className="card flex items-center gap-4 transition-shadow hover:shadow-md">
            <div className="rounded-xl bg-yellow-100 p-3 text-yellow-600"><CheckCircle className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-gray-900">Valider les factures</p>
              <p className="text-sm text-gray-500">{stats?.classified || 0} en attente de validation</p>
            </div>
          </Link>
          <Link href="/export" className="card flex items-center gap-4 transition-shadow hover:shadow-md">
            <div className="rounded-xl bg-purple-100 p-3 text-purple-600"><Download className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-gray-900">Exporter</p>
              <p className="text-sm text-gray-500">{stats?.validated || 0} prêtes à exporter</p>
            </div>
          </Link>
        </div>

        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Factures récentes</h2>
            <Link href="/invoices" className="text-sm font-medium text-primary-600 hover:text-primary-700">Voir tout</Link>
          </div>
          {recent.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {recent.map((inv) => (
                <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-6 px-6 transition-colors">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{inv.supplier_name || inv.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {inv.invoice_number || '-'} &middot;{' '}
                        {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('fr-FR') : new Date(inv.created_at).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {inv.total_ttc && (
                      <span className="text-sm font-medium text-gray-900">
                        {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(inv.total_ttc)}
                      </span>
                    )}
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      inv.status === 'validated' ? 'bg-green-100 text-green-700'
                        : inv.status === 'exported' ? 'bg-purple-100 text-purple-700'
                        : inv.status === 'error' ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {inv.status === 'pending' ? 'En attente' : inv.status === 'classified' ? 'Classifié' : inv.status === 'validated' ? 'Validé' : inv.status === 'exported' ? 'Exporté' : inv.status === 'error' ? 'Erreur' : inv.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-gray-500 py-8">
              Aucune facture. Commencez par{' '}
              <Link href="/invoices/upload" className="text-primary-600 underline">uploader une facture</Link>.
            </p>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
