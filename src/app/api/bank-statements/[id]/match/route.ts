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

    // Build update — SUPPORTS MULTI-INVOICE MATCH (1 transaction = N invoices)
    const existingInvoiceId = txnData.matched_invoice_id as string | null
    const existingAdditional = Array.isArray(txnData.additional_invoice_ids) ? txnData.additional_invoice_ids : []
    const existingRevenueId = txnData.matched_revenue_id as string | null
    const existingAdditionalRev = Array.isArray(txnData.additional_revenue_ids) ? txnData.additional_revenue_ids : []

    const updateData: Record<string, unknown> = {
      match_status: 'matched',
      match_confidence: 1.0,
      match_method: 'manual',
    }

    if (invoice_id) {
      if (!existingInvoiceId) {
        // First match — set primary
        updateData.matched_invoice_id = invoice_id
      } else if (existingInvoiceId === invoice_id || existingAdditional.includes(invoice_id)) {
        // Already linked, no-op
      } else {
        // Additional match — add to array
        updateData.additional_invoice_ids = [...existingAdditional, invoice_id]
      }
    }
    if (revenue_id) {
      if (!existingRevenueId) {
        updateData.matched_revenue_id = revenue_id
      } else if (existingRevenueId === revenue_id || existingAdditionalRev.includes(revenue_id)) {
        // Already linked
      } else {
        updateData.additional_revenue_ids = [...existingAdditionalRev, revenue_id]
      }
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
    const { transaction_id, invoice_id, revenue_id } = body as { transaction_id: string; invoice_id?: string; revenue_id?: string }

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

    // If invoice_id or revenue_id is specified, only remove that specific link
    // Otherwise, fully unmatch the transaction
    const update: Record<string, unknown> = {}
    const existingAdditional = Array.isArray(txnData.additional_invoice_ids) ? txnData.additional_invoice_ids : []
    const existingAdditionalRev = Array.isArray(txnData.additional_revenue_ids) ? txnData.additional_revenue_ids : []

    if (invoice_id) {
      if (txnData.matched_invoice_id === invoice_id) {
        // Removing the primary — promote first additional if any
        if (existingAdditional.length > 0) {
          update.matched_invoice_id = existingAdditional[0]
          update.additional_invoice_ids = existingAdditional.slice(1)
        } else {
          update.matched_invoice_id = null
        }
      } else if (existingAdditional.includes(invoice_id)) {
        update.additional_invoice_ids = existingAdditional.filter((id: string) => id !== invoice_id)
      }
    } else if (revenue_id) {
      if (txnData.matched_revenue_id === revenue_id) {
        if (existingAdditionalRev.length > 0) {
          update.matched_revenue_id = existingAdditionalRev[0]
          update.additional_revenue_ids = existingAdditionalRev.slice(1)
        } else {
          update.matched_revenue_id = null
        }
      } else if (existingAdditionalRev.includes(revenue_id)) {
        update.additional_revenue_ids = existingAdditionalRev.filter((id: string) => id !== revenue_id)
      }
    } else {
      // Full unmatch
      update.matched_invoice_id = null
      update.matched_revenue_id = null
      update.additional_invoice_ids = []
      update.additional_revenue_ids = []
    }

    // After applying, check if any links remain
    const newInvoiceId = 'matched_invoice_id' in update ? update.matched_invoice_id : txnData.matched_invoice_id
    const newAdditional = 'additional_invoice_ids' in update ? update.additional_invoice_ids : existingAdditional
    const newRevenueId = 'matched_revenue_id' in update ? update.matched_revenue_id : txnData.matched_revenue_id
    const newAdditionalRev = 'additional_revenue_ids' in update ? update.additional_revenue_ids : existingAdditionalRev

    const hasAnyLink = newInvoiceId || (Array.isArray(newAdditional) && newAdditional.length > 0) ||
      newRevenueId || (Array.isArray(newAdditionalRev) && newAdditionalRev.length > 0)

    if (!hasAnyLink) {
      update.match_status = 'unmatched'
      update.match_confidence = null
      update.match_method = null
    }

    await adminDb.collection('bankTransactions').doc(transaction_id).update(update)

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
