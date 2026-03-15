export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import InvoiceList from '@/components/invoice/InvoiceList'
import Link from 'next/link'
import { Upload } from 'lucide-react'

export default function InvoicesPage() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Factures</h1>
            <p className="mt-1 text-sm text-gray-500">
              Gérez et suivez toutes vos factures
            </p>
          </div>
          <Link href="/invoices/upload" className="btn-primary">
            <Upload className="mr-2 h-4 w-4" />
            Uploader
          </Link>
        </div>
        <InvoiceList />
      </div>
    </AppLayout>
  )
}
