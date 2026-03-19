import type { InvoiceStatus } from '@/types'

const statusConfig: Record<InvoiceStatus, { label: string; className: string }> = {
  pending: {
    label: 'En attente',
    className: 'bg-gray-700/50 text-gray-300 border border-gray-600',
  },
  processing: {
    label: 'Traitement',
    className: 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30',
  },
  classified: {
    label: 'Classifie',
    className: 'bg-accent-orange/10 text-accent-orange border border-accent-orange/30',
  },
  validated: {
    label: 'Valide',
    className: 'bg-accent-green/10 text-accent-green border border-accent-green/30',
  },
  exported: {
    label: 'Exporte',
    className: 'bg-purple-500/10 text-purple-400 border border-purple-500/30',
  },
  error: {
    label: 'Erreur',
    className: 'bg-accent-red/10 text-accent-red border border-accent-red/30',
  },
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const config = statusConfig[status] || statusConfig.pending
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  )
}

export function ConfidenceBadge({ score }: { score: number | null }) {
  if (score == null) return null
  const pct = Math.round(score * 100)
  const className =
    pct >= 85
      ? 'bg-accent-green/10 text-accent-green border border-accent-green/30'
      : pct >= 65
        ? 'bg-accent-orange/10 text-accent-orange border border-accent-orange/30'
        : 'bg-accent-red/10 text-accent-red border border-accent-red/30'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-mono font-medium ${className}`}
    >
      {pct}%
    </span>
  )
}
