export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import RevenueDetail from '@/components/revenue/RevenueDetail'

export default function RevenueDetailPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <AppLayout>
      <RevenueDetail revenueId={params.id} />
    </AppLayout>
  )
}
