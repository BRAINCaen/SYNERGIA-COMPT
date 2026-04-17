export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * PATCH /api/invoices/[id]/lines/[lineId]
 * Update a single invoice line (for auto-save on classification changes).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; lineId: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const body = await request.json()

    // Whitelist updatable fields
    const allowedFields = [
      'pcg_code', 'pcg_label', 'journal_code', 'manually_corrected',
      'is_immobilization', 'amortization_rate', 'description',
      'total_ht', 'tva_rate', 'tva_amount', 'total_ttc',
    ]

    const updates: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Aucun champ a mettre a jour' }, { status: 400 })
    }

    // Verify the line belongs to an invoice owned by the user
    const lineDoc = await adminDb.collection('invoice_lines').doc(params.lineId).get()
    if (!lineDoc.exists) {
      return NextResponse.json({ error: 'Ligne non trouvee' }, { status: 404 })
    }
    const lineData = lineDoc.data()!
    if (lineData.invoice_id !== params.id) {
      return NextResponse.json({ error: 'Ligne n\'appartient pas a cette facture' }, { status: 400 })
    }

    // Check invoice ownership
    const invoiceDoc = await adminDb.collection('invoices').doc(params.id).get()
    if (!invoiceDoc.exists || invoiceDoc.data()?.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Facture non trouvee' }, { status: 404 })
    }

    await adminDb.collection('invoice_lines').doc(params.lineId).update(updates)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update line error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
