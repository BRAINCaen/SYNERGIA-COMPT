export const dynamic = 'force-dynamic'

import AppLayout from '@/components/layout/AppLayout'
import InvoiceUploader from '@/components/invoice/InvoiceUploader'

export default function UploadPage() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Uploader des factures
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Ajoutez vos factures pour extraction et classification automatique par IA
          </p>
        </div>
        <InvoiceUploader />
      </div>
    </AppLayout>
  )
}
