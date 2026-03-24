import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; txId: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    const txDoc = await adminDb.collection('bankTransactions').doc(params.txId).get()
    if (!txDoc.exists) {
      return NextResponse.json({ error: 'Transaction non trouvée' }, { status: 404 })
    }

    const txData = txDoc.data()!
    if (txData.statement_id !== params.id) {
      return NextResponse.json({ error: 'Transaction n\'appartient pas à ce relevé' }, { status: 400 })
    }

    const update: Record<string, unknown> = {}

    if (body.status === 'ignored') {
      update.match_status = 'ignored'
      update.matched_invoice_id = null
      update.matched_revenue_id = null
      update.match_method = 'manual'
    } else if (body.status === 'unmatched') {
      update.match_status = 'unmatched'
      update.matched_invoice_id = null
      update.matched_revenue_id = null
      update.match_confidence = null
      update.match_method = null
    } else if (body.status === 'matched' && body.matched_entity) {
      update.match_status = 'matched'
      update.match_method = 'manual'
      update.match_confidence = 1.0
      if (body.matched_entity.type === 'invoice') {
        update.matched_invoice_id = body.matched_entity.id
      } else {
        update.matched_revenue_id = body.matched_entity.id
      }
    }

    if (Object.keys(update).length > 0) {
      await adminDb.collection('bankTransactions').doc(params.txId).update(update)
    }

    const updated = await adminDb.collection('bankTransactions').doc(params.txId).get()
    return NextResponse.json({ success: true, transaction: { id: updated.id, ...updated.data() } })
  } catch (error) {
    console.error('PATCH transaction error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
