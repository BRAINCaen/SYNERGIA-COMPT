import type { InvoiceStatus } from '@/types'

const statusConfig: Record<InvoiceStatus, { label: string; className: string }> = {
  pending: {
    label: 'En attente',
    className: 'bg-gray-100 text-gray-700',
  },
  processing: {
    label: 'Traitement',
    className: 'bg-blue-100 text-blue-700',
  },
  classified: {
    label: 'Classifié',
    className: 'bg-yellow-100 text-yellow-700',
  },
  validated: {
    label: 'Validé',
    className: 'bg-green-100 text-green-700',
  },
  exported: {
    label: 'Exporté',
    className: 'bg-purple-100 text-purple-700',
  },
  error: {
    label: 'Erreur',
    className: 'bg-red-100 text-red-700',
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
      ? 'bg-green-100 text-green-700'
      : pct >= 60
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-red-100 text-red-700'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {pct}%
    </span>
  )
}
