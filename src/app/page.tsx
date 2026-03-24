'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useAuth, useAuthFetch } from '@/lib/firebase/auth-context'
import AppLayout from '@/components/layout/AppLayout'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileText, Upload, CheckCircle, Download, Clock, AlertTriangle, Loader2, Zap, TrendingUp, Landmark, Coins, Users,
} from 'lucide-react'

interface AlertData {
  month: string
  unmatched_debits: number
  unmatched_credits: number
  missing_invoices: number
  total_transactions: number
  reconciliation_rate: number
  is_dismissed: boolean
}

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
  const [alerts, setAlerts] = useState<AlertData[]>([])
  const [unmatchedCount, setUnmatchedCount] = useState(0)
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
      const [statsRes, alertsRes, unmatchedRes] = await Promise.all([
        authFetch('/api/invoices/stats'),
        authFetch('/api/alerts').catch(() => null),
        authFetch('/api/bank-statements/transactions?match_status=unmatched').catch(() => null),
      ])
      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats(data.stats)
        setRecent(data.recent)
      }
      if (alertsRes?.ok) {
        const alertData = await alertsRes.json()
        if (alertData.alerts) setAlerts(alertData.alerts.filter((a: AlertData) => !a.is_dismissed && a.total_transactions > 0))
      }
      if (unmatchedRes?.ok) {
        const unmatchedData = await unmatchedRes.json()
        const txList = Array.isArray(unmatchedData) ? unmatchedData : unmatchedData.transactions || []
        setUnmatchedCount(txList.length)
      }
    } catch (e) {
      console.error('Dashboard fetch error:', e)
    }
    setLoading(false)
  }

  const dismissAlert = async (month: string) => {
    await authFetch(`/api/alerts/${month}/dismiss`, { method: 'POST' })
    setAlerts((prev) => prev.filter((a) => a.month !== month))
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

  const pendingCount = (stats?.pending || 0) + (stats?.classified || 0)

  const statCards = [
    { label: 'Total factures', value: stats?.total || 0, icon: FileText, color: 'text-accent-blue bg-accent-blue/10' },
    { label: 'En attente', value: pendingCount, icon: Clock, color: 'text-accent-orange bg-accent-orange/10', alert: pendingCount > 5 },
    { label: 'Validees', value: stats?.validated || 0, icon: CheckCircle, color: 'text-accent-green bg-accent-green/10' },
    { label: 'Exportees', value: stats?.exported || 0, icon: Download, color: 'text-purple-400 bg-purple-500/10' },
  ]

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: 'bg-gray-700/50 text-gray-300',
      classified: 'bg-accent-orange/10 text-accent-orange',
      validated: 'bg-accent-green/10 text-accent-green',
      exported: 'bg-purple-500/10 text-purple-400',
      error: 'bg-accent-red/10 text-accent-red',
    }
    const labelMap: Record<string, string> = {
      pending: 'En attente',
      classified: 'Classifie',
      validated: 'Valide',
      exported: 'Exporte',
      error: 'Erreur',
    }
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || map.pending}`}>
        {labelMap[status] || status}
      </span>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Tableau de bord</h1>
          <p className="mt-1 text-sm text-gray-500">SARL BOEHME — Comptabilite autonome</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="card flex items-center gap-4">
              <div className={`rounded-xl p-3 ${stat.color}`}>
                <stat.icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-white">{stat.value}</p>
                <p className="text-sm text-gray-500">{stat.label}</p>
              </div>
              {stat.alert && (
                <div className="ml-auto">
                  <span className="flex h-3 w-3 rounded-full bg-accent-red animate-pulse" />
                </div>
              )}
            </div>
          ))}
        </div>

        {alerts.map((alert) => {
          const monthLabel = new Date(alert.month + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
          return (
            <div key={alert.month} className="flex items-start gap-3 rounded-lg border border-accent-orange/30 bg-accent-orange/10 p-4">
              <Landmark className="h-5 w-5 text-accent-orange mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-accent-orange">
                  Rapprochement bancaire — {monthLabel}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  {alert.unmatched_debits > 0 && <>{alert.unmatched_debits} debit{alert.unmatched_debits > 1 ? 's' : ''} non rapproche{alert.unmatched_debits > 1 ? 's' : ''}. </>}
                  {alert.unmatched_credits > 0 && <>{alert.unmatched_credits} credit{alert.unmatched_credits > 1 ? 's' : ''} non rapproche{alert.unmatched_credits > 1 ? 's' : ''}. </>}
                  {alert.missing_invoices > 0 && <>{alert.missing_invoices} facture{alert.missing_invoices > 1 ? 's' : ''} sans mouvement bancaire. </>}
                  Taux de rapprochement : <span className="font-mono font-bold text-accent-orange">{Math.round(alert.reconciliation_rate)}%</span>
                </p>
                <div className="mt-2 flex gap-3">
                  <Link href={`/bank?month=${alert.month}`} className="text-xs font-medium text-accent-orange underline">Voir le detail</Link>
                  <button onClick={() => dismissAlert(alert.month)} className="text-xs text-gray-500 hover:text-gray-300">Ignorer</button>
                </div>
              </div>
            </div>
          )
        })}

        {unmatchedCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
            <Users className="h-5 w-5 text-purple-400" />
            <p className="text-sm text-purple-300">
              <span className="font-mono font-bold text-purple-400">{unmatchedCount}</span> ligne{unmatchedCount > 1 ? 's' : ''} de releve non rapprochee{unmatchedCount > 1 ? 's' : ''}.{' '}
              <Link href="/bank" className="font-medium underline">Voir le releve</Link>
              {' '}&middot;{' '}
              <Link href="/personnel" className="font-medium underline">Frais de personnel</Link>
            </p>
          </div>
        )}

        {(stats?.error || 0) > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-accent-red/30 bg-accent-red/10 p-4">
            <AlertTriangle className="h-5 w-5 text-accent-red" />
            <p className="text-sm text-accent-red">
              {stats!.error} facture{stats!.error > 1 ? 's' : ''} en erreur.{' '}
              <Link href="/invoices?status=error" className="font-medium underline">Voir</Link>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link href="/invoices/upload" className="card flex items-center gap-4 transition-all hover:border-accent-green/50 hover:shadow-lg hover:shadow-accent-green/5">
            <div className="rounded-xl bg-accent-green/10 p-3 text-accent-green"><Upload className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-white">Uploader des factures</p>
              <p className="text-sm text-gray-500">PDF, JPG, PNG, TIFF</p>
            </div>
          </Link>
          <Link href="/invoices?status=classified" className="card flex items-center gap-4 transition-all hover:border-accent-orange/50 hover:shadow-lg hover:shadow-accent-orange/5">
            <div className="rounded-xl bg-accent-orange/10 p-3 text-accent-orange"><CheckCircle className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-white">Valider les factures</p>
              <p className="text-sm text-gray-500">{stats?.classified || 0} en attente de validation</p>
            </div>
          </Link>
          <Link href="/export" className="card flex items-center gap-4 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/5">
            <div className="rounded-xl bg-purple-500/10 p-3 text-purple-400"><Download className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-white">Exporter</p>
              <p className="text-sm text-gray-500">{stats?.validated || 0} pretes a exporter</p>
            </div>
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Link href="/bank" className="card flex items-center gap-4 transition-all hover:border-accent-blue/50 hover:shadow-lg hover:shadow-accent-blue/5">
            <div className="rounded-xl bg-accent-blue/10 p-3 text-accent-blue"><Landmark className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-white">Releves bancaires</p>
              <p className="text-sm text-gray-500">Pointage et rapprochement bancaire</p>
            </div>
          </Link>
          <Link href="/revenue" className="card flex items-center gap-4 transition-all hover:border-accent-green/50 hover:shadow-lg hover:shadow-accent-green/5">
            <div className="rounded-xl bg-accent-green/10 p-3 text-accent-green"><Coins className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-white">Recettes</p>
              <p className="text-sm text-gray-500">TPE, virements, cheques, ANCV</p>
            </div>
          </Link>
          <Link href="/personnel" className="card flex items-center gap-4 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/5">
            <div className="rounded-xl bg-purple-500/10 p-3 text-purple-400"><Users className="h-6 w-6" /></div>
            <div>
              <p className="font-medium text-white">Frais de personnel</p>
              <p className="text-sm text-gray-500">Salaires, acomptes, charges</p>
            </div>
          </Link>
        </div>

        {/* Economies card */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-xl bg-accent-green/10 p-2 text-accent-green">
                <TrendingUp className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Economies estimees</h3>
            </div>
            <p className="text-sm text-gray-400">
              {stats?.validated || 0} factures traitees automatiquement.
              A ~3 min/facture manuelle, vous economisez environ{' '}
              <span className="font-mono font-bold text-accent-green">
                {Math.round(((stats?.validated || 0) * 3) / 60)}h
              </span>{' '}
              de travail comptable.
            </p>
          </div>
          <div className="card">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-xl bg-accent-blue/10 p-2 text-accent-blue">
                <Zap className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Autonomie comptable</h3>
            </div>
            <p className="text-sm text-gray-400">
              Ventilation automatique via IA + plan comptable BOEHME.
              Expert-comptable uniquement pour le bilan annuel et l&apos;attestation de CA.
            </p>
          </div>
        </div>

        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Factures recentes</h2>
            <Link href="/invoices" className="text-sm font-medium text-accent-green hover:text-accent-green/80">Voir tout</Link>
          </div>
          {recent.length > 0 ? (
            <div className="divide-y divide-dark-border">
              {recent.map((inv) => (
                <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center justify-between py-3 hover:bg-dark-hover -mx-6 px-6 transition-colors rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-gray-500" />
                    <div>
                      <p className="text-sm font-medium text-gray-200">{inv.supplier_name || inv.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {inv.invoice_number || '-'} &middot;{' '}
                        {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('fr-FR') : new Date(inv.created_at).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {inv.total_ttc && (
                      <span className="text-sm font-mono font-medium text-gray-200">
                        {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(inv.total_ttc)}
                      </span>
                    )}
                    {statusBadge(inv.status)}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-gray-500 py-8">
              Aucune facture. Commencez par{' '}
              <Link href="/invoices/upload" className="text-accent-green underline">uploader une facture</Link>.
            </p>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
