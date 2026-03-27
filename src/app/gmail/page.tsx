export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import GmailClient from './GmailClient'

export default function GmailPage() {
  return (
    <AppLayout>
      <GmailClient />
    </AppLayout>
  )
}
