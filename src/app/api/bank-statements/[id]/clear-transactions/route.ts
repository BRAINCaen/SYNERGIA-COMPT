export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * DELETE all transactions for a given statement.
 * Useful when a statement was uploaded multiple times with duplicates.
 * The statement itself is kept — only its transactions are deleted so the user
 * can re-trigger parsing without losing the file.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) return NextResponse.json({ error: 'Non autorise' }, { status: 401 })

    // Verify statement ownership
    const stmtDoc = await adminDb.collection('bankStatements').doc(params.id).get()
    if (!stmtDoc.exists || stmtDoc.data()?.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Releve non trouve' }, { status: 404 })
    }

    // Fetch all transactions for this statement
    const txsSnap = await adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)
      .get()

    if (txsSnap.empty) {
      return NextResponse.json({ success: true, deleted: 0 })
    }

    // Collect IDs to unlink from revenues/payslips (which store matched_transaction_ids[])
    const txIdsToUnlink = new Set(txsSnap.docs.map((d) => d.id))

    // Unlink revenues : remove these tx IDs from matched_transaction_ids[]
    const revenuesSnap = await adminDb
      .collection('revenues')
      .where('user_id', '==', decoded.uid)
      .get()
    let revenuesUnlinked = 0
    {
      const batch = adminDb.batch()
      let batchOps = 0
      for (const r of revenuesSnap.docs) {
        const ids: string[] = r.data().matched_transaction_ids || []
        if (ids.length === 0) continue
        const remaining = ids.filter((id) => !txIdsToUnlink.has(id))
        if (remaining.length !== ids.length) {
          batch.update(r.ref, {
            matched_transaction_ids: remaining,
            updated_at: new Date().toISOString(),
          })
          revenuesUnlinked++
          batchOps++
          if (batchOps >= 490) {
            await batch.commit()
            batchOps = 0
          }
        }
      }
      if (batchOps > 0) await batch.commit()
    }

    // Unlink payslips : same logic
    const payslipsSnap = await adminDb
      .collection('payslips')
      .where('user_id', '==', decoded.uid)
      .get()
    let payslipsUnlinked = 0
    {
      const batch = adminDb.batch()
      let batchOps = 0
      for (const p of payslipsSnap.docs) {
        const ids: string[] = p.data().matched_transaction_ids || []
        if (ids.length === 0) continue
        const remaining = ids.filter((id) => !txIdsToUnlink.has(id))
        if (remaining.length !== ids.length) {
          batch.update(p.ref, {
            matched_transaction_ids: remaining,
            updated_at: new Date().toISOString(),
          })
          payslipsUnlinked++
          batchOps++
          if (batchOps >= 490) {
            await batch.commit()
            batchOps = 0
          }
        }
      }
      if (batchOps > 0) await batch.commit()
    }

    // Batch delete transactions (490 per batch)
    let deleted = 0
    const docs = txsSnap.docs
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490)
      const batch = adminDb.batch()
      chunk.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      deleted += chunk.length
    }

    // Reset statement counters
    await adminDb.collection('bankStatements').doc(params.id).update({
      transaction_count: 0,
      total_debits: 0,
      total_credits: 0,
      status: 'pending',
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      deleted,
      revenues_unlinked: revenuesUnlinked,
      payslips_unlinked: payslipsUnlinked,
    })
  } catch (error) {
    console.error('Clear transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
