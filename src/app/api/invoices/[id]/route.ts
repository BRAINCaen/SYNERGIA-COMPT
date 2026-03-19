import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const invoiceDoc = await adminDb.collection('invoices').doc(params.id).get()
    if (!invoiceDoc.exists) {
      return NextResponse.json({ error: 'Facture non trouvée' }, { status: 404 })
    }

    const invoice = invoiceDoc.data()!

    // Get lines
    const linesSnap = await adminDb
      .collection('invoice_lines')
      .where('invoice_id', '==', params.id)
      .get()

    const lines = linesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    // Get signed URL for file
    let fileUrl = null
    try {
      const bucket = adminStorage.bucket()
      const [url] = await bucket.file(invoice.file_path).getSignedUrl({
        action: 'read',
        expires: Date.now() + 3600 * 1000,
      })
      fileUrl = url
    } catch (e) {
      console.error('Error getting signed URL:', e)
    }

    return NextResponse.json({
      id: invoiceDoc.id,
      ...invoice,
      file_url: fileUrl,
      lines,
    })
  } catch (error) {
    console.error('GET invoice error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    body.updated_at = new Date().toISOString()

    // Get before state for audit
    const beforeDoc = await adminDb.collection('invoices').doc(params.id).get()
    const beforeData = beforeDoc.exists ? beforeDoc.data()! : null

    await adminDb.collection('invoices').doc(params.id).update(body)

    const updated = await adminDb.collection('invoices').doc(params.id).get()

    // Audit log for any update
    if (beforeData) {
      await writeAuditLog({
        action: 'update',
        invoice_id: params.id,
        user_id: decoded.uid,
        before: { status: beforeData.status, ...Object.fromEntries(Object.keys(body).filter(k => k !== 'updated_at').map(k => [k, beforeData[k]])) },
        after: Object.fromEntries(Object.keys(body).filter(k => k !== 'updated_at').map(k => [k, body[k]])),
      })
    }

    return NextResponse.json({ id: updated.id, ...updated.data() })
  } catch (error) {
    console.error('PATCH invoice error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const invoiceDoc = await adminDb.collection('invoices').doc(params.id).get()
    if (invoiceDoc.exists) {
      const data = invoiceDoc.data()!
      // Delete file from storage
      try {
        const bucket = adminStorage.bucket()
        await bucket.file(data.file_path).delete()
      } catch (e) {
        console.error('Error deleting file:', e)
      }

      // Delete lines
      const linesSnap = await adminDb
        .collection('invoice_lines')
        .where('invoice_id', '==', params.id)
        .get()
      const batch = adminDb.batch()
      linesSnap.docs.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()

      // Audit log for deletion
      await writeAuditLog({
        action: 'delete',
        invoice_id: params.id,
        user_id: decoded.uid,
        before: { status: data.status, supplier_name: data.supplier_name, file_name: data.file_name },
        after: null,
      })

      // Delete invoice
      await adminDb.collection('invoices').doc(params.id).delete()
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE invoice error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
