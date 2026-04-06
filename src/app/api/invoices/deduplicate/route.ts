export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    // Build a fingerprint for each invoice
    const seen = new Map<string, { id: string; created_at: string }>()
    const duplicateIds: string[] = []
    const duplicateDetails: string[] = []

    for (const doc of snap.docs) {
      const data = doc.data()

      // Build fingerprint from: supplier + invoice_number + total_ttc + invoice_date
      const supplier = (data.supplier_name || '').toString().toUpperCase().trim()
      const invoiceNum = (data.invoice_number || '').toString().trim()
      const totalTtc = data.total_ttc != null ? Number(data.total_ttc).toFixed(2) : ''
      const date = (data.invoice_date || '').toString().slice(0, 7) // YYYY-MM

      // Need at least 2 matching fields to consider duplicate
      if (!supplier && !invoiceNum) continue

      const fingerprint = `${supplier}|${invoiceNum}|${totalTtc}|${date}`

      if (seen.has(fingerprint)) {
        // This is a duplicate — keep the older one (first seen), delete this one
        duplicateIds.push(doc.id)
        duplicateDetails.push(`${data.file_name || doc.id} (${supplier} ${totalTtc}EUR ${invoiceNum})`)
      } else {
        seen.set(fingerprint, { id: doc.id, created_at: data.created_at || '' })
      }
    }

    if (duplicateIds.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        total: snap.docs.length,
        message: 'Aucun doublon trouve',
      })
    }

    // Delete duplicates: files from storage + lines + invoice docs
    const bucket = adminStorage.bucket()
    let deleted = 0

    for (const id of duplicateIds) {
      try {
        const doc = await adminDb.collection('invoices').doc(id).get()
        if (!doc.exists) continue
        const data = doc.data()!

        // Delete file from storage
        if (data.file_path) {
          try { await bucket.file(data.file_path).delete() } catch { /* ignore */ }
        }

        // Delete associated lines
        const linesSnap = await adminDb.collection('invoice_lines').where('invoice_id', '==', id).get()
        if (!linesSnap.empty) {
          const batch = adminDb.batch()
          linesSnap.docs.forEach((d) => batch.delete(d.ref))
          await batch.commit()
        }

        // Delete invoice
        await adminDb.collection('invoices').doc(id).delete()
        deleted++
      } catch (e) {
        console.error(`Error deleting duplicate ${id}:`, e)
      }
    }

    return NextResponse.json({
      success: true,
      deleted,
      total: snap.docs.length,
      remaining: snap.docs.length - deleted,
      details: duplicateDetails.slice(0, 20),
    })
  } catch (error) {
    console.error('Deduplicate error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
