export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { BOEHME_PCG } from '@/data/boehme-pcg'

/**
 * Fix outdated pcg_label values on all invoice_lines.
 * Uses the current BOEHME_PCG chart as source of truth.
 * Maps pcg_code -> official label and updates any line with wrong label.
 */
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    // Build lookup: code → official label
    const codeToLabel = new Map<string, string>()
    for (const acc of BOEHME_PCG) {
      codeToLabel.set(acc.code, acc.label)
    }

    // Get all invoices for this user
    const invoicesSnap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()
    const invoiceIds = new Set(invoicesSnap.docs.map(d => d.id))

    if (invoiceIds.size === 0) {
      return NextResponse.json({ success: true, updated: 0, total: 0 })
    }

    // Get all invoice_lines — we'll filter by invoice ownership
    const linesSnap = await adminDb.collection('invoice_lines').get()

    let updated = 0
    const examples: string[] = []
    const now = new Date().toISOString()

    // Process in batches of 490
    const docs = linesSnap.docs
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490)
      const batch = adminDb.batch()
      let batchHasUpdates = false

      for (const doc of chunk) {
        const data = doc.data()
        // Only process lines belonging to this user's invoices
        if (!invoiceIds.has(data.invoice_id)) continue
        if (!data.pcg_code) continue

        const officialLabel = codeToLabel.get(data.pcg_code)
        if (!officialLabel) continue

        // Update if label differs
        if (data.pcg_label !== officialLabel) {
          batch.update(doc.ref, {
            pcg_label: officialLabel,
            updated_at: now,
          })
          batchHasUpdates = true
          updated++
          if (examples.length < 10) {
            examples.push(`${data.pcg_code}: "${data.pcg_label}" → "${officialLabel}"`)
          }
        }
      }

      if (batchHasUpdates) await batch.commit()
    }

    return NextResponse.json({
      success: true,
      updated,
      examples,
    })
  } catch (error) {
    console.error('Fix labels error:', error)
    const msg = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
