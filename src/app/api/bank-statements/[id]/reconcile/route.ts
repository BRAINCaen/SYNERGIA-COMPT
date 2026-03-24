import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

/**
 * Normalize a transaction label for supplier matching.
 * Removes common French bank prefixes and normalizes whitespace.
 */
function normalizeLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/^(CB |PRLV |VIR |CHQ |PRELEVEMENT |VIREMENT |CHEQUE )/g, '')
    .replace(/\d{2}\/\d{2}\/?\d{0,4}/g, '') // remove dates in label
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if two dates are within a given number of days.
 */
function withinDays(dateA: string, dateB: string, days: number): boolean {
  const a = new Date(dateA).getTime()
  const b = new Date(dateB).getTime()
  if (isNaN(a) || isNaN(b)) return false
  return Math.abs(a - b) <= days * 24 * 60 * 60 * 1000
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Verify statement exists
    const statementDoc = await adminDb.collection('bankStatements').doc(params.id).get()
    if (!statementDoc.exists) {
      return NextResponse.json({ error: 'Relevé non trouvé' }, { status: 404 })
    }

    // Get all transactions for this statement (filter in JS to avoid composite index)
    const allTransSnap = await adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)
      .get()
    const transSnap = { docs: allTransSnap.docs.filter(d => d.data().match_status === 'unmatched'), size: 0 }
    transSnap.size = transSnap.docs.length

    // Load ALL invoices and revenue entries ONCE (avoid N+1 queries)
    const allInvoicesSnap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()
    const allRevenueSnap = await adminDb
      .collection('revenueEntries')
      .where('user_id', '==', decoded.uid)
      .get()

    let matchedCount = 0
    let unmatchedCount = 0
    const total = transSnap.size

    // Process in batches of 490
    const docs = transSnap.docs
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490)
      const batch = adminDb.batch()
      let batchHasWrites = false

      for (const doc of chunk) {
        const txn = doc.data()

        if (txn.type === 'debit') {
          // Match against pre-loaded invoices by amount (within 0.01 EUR)
          const invoicesSnap = { docs: allInvoicesSnap.docs.filter(d => {
            const ttc = d.data().total_ttc
            return ttc != null && Math.abs(ttc - txn.amount) <= 0.01
          })}

          // Filter by status and date proximity
          const validInvoices = invoicesSnap.docs.filter((invDoc) => {
            const inv = invDoc.data()
            const validStatuses = ['validated', 'exported', 'classified']
            if (!validStatuses.includes(inv.status)) return false
            if (inv.invoice_date && txn.date) {
              return withinDays(inv.invoice_date, txn.date, 45)
            }
            return true
          })

          if (validInvoices.length === 1) {
            // Exact single match by amount + date proximity
            batch.update(doc.ref, {
              match_status: 'matched',
              matched_invoice_id: validInvoices[0].id,
              match_confidence: 0.95,
              match_method: 'auto',
            })
            batchHasWrites = true
            matchedCount++
            continue
          }

          // Try supplier name matching
          if (validInvoices.length > 1) {
            const normalizedLabel = normalizeLabel(txn.label)
            const supplierMatch = validInvoices.find((invDoc) => {
              const inv = invDoc.data()
              if (!inv.supplier_name) return false
              const normalizedSupplier = inv.supplier_name.toUpperCase().trim()
              return (
                normalizedLabel.includes(normalizedSupplier) ||
                normalizedSupplier.includes(normalizedLabel)
              )
            })

            if (supplierMatch) {
              batch.update(doc.ref, {
                match_status: 'matched',
                matched_invoice_id: supplierMatch.id,
                match_confidence: 0.85,
                match_method: 'auto',
              })
              batchHasWrites = true
              matchedCount++
              continue
            }
          }

          // No match for debit
          unmatchedCount++
        } else if (txn.type === 'credit') {
          // Match against pre-loaded revenue entries by amount
          const revenueSnap = { docs: allRevenueSnap.docs.filter(d => {
            const ttc = d.data().amount_ttc
            return ttc != null && Math.abs(ttc - txn.amount) <= 0.01
          })}

          // Filter by date proximity
          const validRevenues = revenueSnap.docs.filter((revDoc) => {
            const rev = revDoc.data()
            if (rev.date && txn.date) {
              return withinDays(rev.date, txn.date, 45)
            }
            return true
          })

          if (validRevenues.length === 1) {
            batch.update(doc.ref, {
              match_status: 'matched',
              matched_revenue_id: validRevenues[0].id,
              match_confidence: 0.95,
              match_method: 'auto',
            })
            batchHasWrites = true
            matchedCount++
            continue
          }

          // No match for credit
          unmatchedCount++
        } else {
          unmatchedCount++
        }
      }

      if (batchHasWrites) {
        await batch.commit()
      }
    }

    // Audit log
    await writeAuditLog({
      action: 'bank_reconcile_auto',
      invoice_id: params.id,
      user_id: decoded.uid,
      after: { matched: matchedCount, unmatched: unmatchedCount, total },
    })

    return NextResponse.json({
      success: true,
      matched: matchedCount,
      unmatched: unmatchedCount,
      total,
    })
  } catch (error) {
    console.error('Reconcile error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
