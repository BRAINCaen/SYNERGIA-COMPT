export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import ExportClient from './ExportClient'

export default function ExportPage() {
  return (
    <AppLayout>
      <ExportClient />
    </AppLayout>
  )
}
