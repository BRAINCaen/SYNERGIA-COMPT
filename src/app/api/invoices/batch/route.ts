import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export const dynamic = 'force-dynamic'

interface BatchRequestBody {
  action: 'delete' | 'update_status'
  invoice_ids: string[]
  status?: string
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body: BatchRequestBody = await request.json()
    const { action, invoice_ids, status } = body

    if (!action || !invoice_ids || !Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
    }

    if (invoice_ids.length > 500) {
      return NextResponse.json({ error: 'Maximum 500 factures par opération' }, { status: 400 })
    }

    if (action === 'delete') {
      return handleBatchDelete(invoice_ids, decoded.uid)
    }

    if (action === 'update_status') {
      if (!status) {
        return NextResponse.json({ error: 'Statut requis pour la mise à jour' }, { status: 400 })
      }
      const validStatuses = ['pending', 'processing', 'classified', 'validated', 'exported', 'error']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
      }
      return handleBatchStatusUpdate(invoice_ids, status, decoded.uid)
    }

    return NextResponse.json({ error: 'Action non supportée' }, { status: 400 })
  } catch (error) {
    console.error('Batch operation error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

async function handleBatchDelete(invoiceIds: string[], userId: string) {
  const bucket = adminStorage.bucket()
  let deletedCount = 0
  const errors: string[] = []

  // Process in chunks of 10 to avoid overwhelming Firestore
  const chunks = chunkArray(invoiceIds, 10)

  for (const chunk of chunks) {
    // Fetch all invoice documents in the chunk
    const invoiceDocs = await Promise.all(
      chunk.map((id) => adminDb.collection('invoices').doc(id).get())
    )

    for (const invoiceDoc of invoiceDocs) {
      if (!invoiceDoc.exists) continue

      const data = invoiceDoc.data()!
      const invoiceId = invoiceDoc.id

      try {
        // Delete file from storage
        try {
          await bucket.file(data.file_path).delete()
        } catch (e) {
          console.error(`Error deleting file for invoice ${invoiceId}:`, e)
        }

        // Delete associated lines
        const linesSnap = await adminDb
          .collection('invoice_lines')
          .where('invoice_id', '==', invoiceId)
          .get()

        if (!linesSnap.empty) {
          const batch = adminDb.batch()
          linesSnap.docs.forEach((doc) => batch.delete(doc.ref))
          await batch.commit()
        }

        // Audit log
        await writeAuditLog({
          action: 'batch_delete',
          invoice_id: invoiceId,
          user_id: userId,
          before: { status: data.status, supplier_name: data.supplier_name, file_name: data.file_name },
          after: null,
        })

        // Delete the invoice document
        await adminDb.collection('invoices').doc(invoiceId).delete()
        deletedCount++
      } catch (e) {
        console.error(`Error deleting invoice ${invoiceId}:`, e)
        errors.push(invoiceId)
      }
    }
  }

  return NextResponse.json({
    success: true,
    deleted_count: deletedCount,
    errors: errors.length > 0 ? errors : undefined,
  })
}

async function handleBatchStatusUpdate(invoiceIds: string[], status: string, userId: string) {
  let updatedCount = 0
  const errors: string[] = []
  const now = new Date().toISOString()

  // Process in Firestore batch writes (max 500 per batch)
  const chunks = chunkArray(invoiceIds, 500)

  for (const chunk of chunks) {
    try {
      const batch = adminDb.batch()
      for (const id of chunk) {
        const ref = adminDb.collection('invoices').doc(id)
        batch.update(ref, { status, updated_at: now })
      }
      await batch.commit()
      updatedCount += chunk.length
      // Audit logs for batch status update
      for (const id of chunk) {
        await writeAuditLog({
          action: 'batch_status_update',
          invoice_id: id,
          user_id: userId,
          before: null,
          after: { status },
        })
      }
    } catch (e) {
      console.error('Batch status update error:', e)
      // Fallback: update individually
      for (const id of chunk) {
        try {
          await adminDb.collection('invoices').doc(id).update({ status, updated_at: now })
          updatedCount++
        } catch (innerError) {
          console.error(`Error updating invoice ${id}:`, innerError)
          errors.push(id)
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    updated_count: updatedCount,
    errors: errors.length > 0 ? errors : undefined,
  })
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}
