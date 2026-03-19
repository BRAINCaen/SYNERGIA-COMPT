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
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    const { transaction_id, invoice_id, revenue_id } = body

    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id requis' }, { status: 400 })
    }

    if (!invoice_id && !revenue_id) {
      return NextResponse.json(
        { error: 'invoice_id ou revenue_id requis' },
        { status: 400 }
      )
    }

    // Verify transaction exists and belongs to this statement
    const txnDoc = await adminDb.collection('bankTransactions').doc(transaction_id).get()
    if (!txnDoc.exists) {
      return NextResponse.json({ error: 'Transaction non trouvée' }, { status: 404 })
    }

    const txnData = txnDoc.data()!
    if (txnData.statement_id !== params.id) {
      return NextResponse.json(
        { error: 'Transaction n\'appartient pas à ce relevé' },
        { status: 400 }
      )
    }

    // Build update
    const updateData: Record<string, unknown> = {
      match_status: 'matched',
      match_confidence: 1.0,
      match_method: 'manual',
    }

    if (invoice_id) {
      updateData.matched_invoice_id = invoice_id
    }
    if (revenue_id) {
      updateData.matched_revenue_id = revenue_id
    }

    await adminDb.collection('bankTransactions').doc(transaction_id).update(updateData)

    // Audit log
    await writeAuditLog({
      action: 'bank_match_manual',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: {
        transaction_id,
        match_status: txnData.match_status,
      },
      after: {
        transaction_id,
        matched_invoice_id: invoice_id || null,
        matched_revenue_id: revenue_id || null,
        match_method: 'manual',
      },
    })

    const updated = await adminDb.collection('bankTransactions').doc(transaction_id).get()

    return NextResponse.json({
      success: true,
      transaction: { id: updated.id, ...updated.data() },
    })
  } catch (error) {
    console.error('POST match error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
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

    const body = await request.json()
    const { transaction_id } = body

    if (!transaction_id) {
      return NextResponse.json({ error: 'transaction_id requis' }, { status: 400 })
    }

    // Verify transaction exists and belongs to this statement
    const txnDoc = await adminDb.collection('bankTransactions').doc(transaction_id).get()
    if (!txnDoc.exists) {
      return NextResponse.json({ error: 'Transaction non trouvée' }, { status: 404 })
    }

    const txnData = txnDoc.data()!
    if (txnData.statement_id !== params.id) {
      return NextResponse.json(
        { error: 'Transaction n\'appartient pas à ce relevé' },
        { status: 400 }
      )
    }

    // Reset to unmatched
    await adminDb.collection('bankTransactions').doc(transaction_id).update({
      match_status: 'unmatched',
      matched_invoice_id: null,
      matched_revenue_id: null,
      match_confidence: null,
      match_method: null,
    })

    // Audit log
    await writeAuditLog({
      action: 'bank_unmatch',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: {
        transaction_id,
        matched_invoice_id: txnData.matched_invoice_id,
        matched_revenue_id: txnData.matched_revenue_id,
        match_method: txnData.match_method,
      },
      after: {
        transaction_id,
        match_status: 'unmatched',
      },
    })

    const updated = await adminDb.collection('bankTransactions').doc(transaction_id).get()

    return NextResponse.json({
      success: true,
      transaction: { id: updated.id, ...updated.data() },
    })
  } catch (error) {
    console.error('DELETE match error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
