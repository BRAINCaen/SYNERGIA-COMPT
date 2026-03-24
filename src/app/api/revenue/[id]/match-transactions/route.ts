import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const revenueDoc = await adminDb.collection('revenueEntries').doc(params.id).get()
    if (!revenueDoc.exists) {
      return NextResponse.json({ error: 'Encaissement non trouve' }, { status: 404 })
    }

    const revenue = revenueDoc.data()!
    if (revenue.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 403 })
    }

    const body = await request.json()
    const transactionIds: string[] = body.transaction_ids

    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json(
        { error: 'transaction_ids doit etre un tableau non vide' },
        { status: 400 }
      )
    }

    const batch = adminDb.batch()

    for (const txId of transactionIds) {
      const txRef = adminDb.collection('bankTransactions').doc(txId)
      batch.update(txRef, {
        match_status: 'matched',
        matched_revenue_id: params.id,
        match_method: 'manual',
      })
    }

    const existingIds: string[] = revenue.matched_transaction_ids || []
    const mergedIds = [...new Set([...existingIds, ...transactionIds])]

    batch.update(adminDb.collection('revenueEntries').doc(params.id), {
      matched_transaction_ids: mergedIds,
      updated_at: new Date().toISOString(),
    })

    await batch.commit()

    await writeAuditLog({
      action: 'revenue.match_transactions',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: { matched_transaction_ids: existingIds },
      after: { matched_transaction_ids: mergedIds, new_matches: transactionIds },
    })

    return NextResponse.json({
      success: true,
      matched_transaction_ids: mergedIds,
    })
  } catch (error) {
    console.error('POST revenue match-transactions error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
