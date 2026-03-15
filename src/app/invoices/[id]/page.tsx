export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import InvoiceDetail from '@/components/invoice/InvoiceDetail'
import { pcgAccounts } from '@/data/pcg-accounts'

export default function InvoiceDetailPage({
  params,
}: {
  params: { id: string }
}) {
  return (
    <AppLayout>
      <InvoiceDetail invoiceId={params.id} pcgAccounts={pcgAccounts} />
    </AppLayout>
  )
}
