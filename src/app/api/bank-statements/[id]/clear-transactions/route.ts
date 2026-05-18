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

    // Batch delete (490 per batch)
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

    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    console.error('Clear transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
