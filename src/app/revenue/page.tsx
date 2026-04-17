export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import RevenueClient from './RevenueClient'

export default function RevenuePage() {
  return (
    <Suspense fallback={null}>
      <RevenueClient />
    </Suspense>
  )
}
