export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Build a clean, standardized filename from invoice data.
 * Format: FOURNISSEUR-MONTANT€-YYYYMMDD-NUMFACTURE.pdf
 * Example: NETLIFY_INC-19,00€-20260131-TAKJBC00009.pdf
 */
function buildFileName(invoice: Record<string, unknown>): string | null {
  const supplier = (invoice.supplier_name as string) || null
  const totalTtc = invoice.total_ttc as number | null
  const date = (invoice.invoice_date as string) || (invoice.created_at as string) || null
  const invoiceNumber = (invoice.invoice_number as string) || null
  const currentName = (invoice.file_name as string) || ''
  const ext = currentName.includes('.') ? currentName.split('.').pop()?.toLowerCase() || 'pdf' : 'pdf'

  // Need at least supplier or amount to rename
  if (!supplier && totalTtc == null) return null

  const parts: string[] = []

  // Supplier name (clean, uppercase, max 40 chars)
  if (supplier) {
    const clean = supplier
      .toUpperCase()
      .replace(/[^A-Z0-9\sÀ-Ü]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 40)
    parts.push(clean)
  }

  // Amount
  if (totalTtc != null) {
    parts.push(`${totalTtc.toFixed(2).replace('.', ',')}EUR`)
  }

  // Date (YYYYMMDD)
  if (date) {
    const d = date.slice(0, 10).replace(/-/g, '')
    if (d.length === 8) parts.push(d)
  }

  // Invoice number (clean)
  if (invoiceNumber) {
    const cleanNum = invoiceNumber.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)
    if (cleanNum) parts.push(cleanNum)
  }

  if (parts.length === 0) return null

  return `${parts.join('-')}.${ext}`
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    // Get ALL invoices for user
    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    let renamed = 0
    let skipped = 0
    const now = new Date().toISOString()

    // Process in batches of 490 (Firestore limit is 500 per batch)
    const docs = snap.docs
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490)
      const batch = adminDb.batch()

      for (const doc of chunk) {
        const data = doc.data()
        const newName = buildFileName(data)

        if (!newName) {
          skipped++
          continue
        }

        // Don't rename if already well-formatted (has supplier name + amount)
        const currentName = (data.file_name as string) || ''
        if (currentName === newName) {
          skipped++
          continue
        }

        batch.update(doc.ref, {
          file_name: newName,
          updated_at: now,
        })
        renamed++
      }

      await batch.commit()
    }

    return NextResponse.json({
      success: true,
      renamed,
      skipped,
      total: docs.length,
    })
  } catch (error) {
    console.error('Batch rename error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
