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

    const payslipDoc = await adminDb.collection('payslips').doc(params.id).get()
    if (!payslipDoc.exists) {
      return NextResponse.json({ error: 'Bulletin non trouve' }, { status: 404 })
    }

    const payslip = payslipDoc.data()!
    if (payslip.user_id !== decoded.uid) {
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

    // Update each bank transaction to mark as matched
    const batch = adminDb.batch()

    for (const txId of transactionIds) {
      const txRef = adminDb.collection('bankTransactions').doc(txId)
      batch.update(txRef, {
        match_status: 'matched',
        matched_payslip_id: params.id,
        match_method: 'manual',
      })
    }

    // Update payslip with matched transaction IDs
    const existingIds: string[] = payslip.matched_transaction_ids || []
    const mergedIds = [...new Set([...existingIds, ...transactionIds])]

    batch.update(adminDb.collection('payslips').doc(params.id), {
      matched_transaction_ids: mergedIds,
      updated_at: new Date().toISOString(),
    })

    await batch.commit()

    await writeAuditLog({
      action: 'payslip.match_transactions',
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
    console.error('POST match-transactions error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
