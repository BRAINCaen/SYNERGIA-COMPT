import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { lines } = await request.json()

    if (!lines?.length) {
      return NextResponse.json({ error: 'Aucune ligne' }, { status: 400 })
    }

    // Filter out lines with zero amounts
    const filteredLines = lines.filter((l: { total_ht?: number; total_ttc?: number }) =>
      (l.total_ht || 0) > 0 || (l.total_ttc || 0) > 0
    )

    if (filteredLines.length === 0) {
      return NextResponse.json({ error: 'Aucune ligne avec un montant > 0' }, { status: 400 })
    }

    // IMPORTANT: Delete existing lines first to avoid duplicates on rescan
    const existingLines = await adminDb
      .collection('invoice_lines')
      .where('invoice_id', '==', params.id)
      .get()

    if (!existingLines.empty) {
      const delBatch = adminDb.batch()
      existingLines.docs.forEach((d) => delBatch.delete(d.ref))
      await delBatch.commit()
    }

    const batch = adminDb.batch()
    const createdLines: Record<string, unknown>[] = []

    for (const line of filteredLines) {
      const lineRef = adminDb.collection('invoice_lines').doc()
      const lineData = {
        id: lineRef.id,
        invoice_id: params.id,
        description: line.description,
        quantity: line.quantity || null,
        unit_price: line.unit_price || null,
        total_ht: line.total_ht,
        tva_rate: line.tva_rate || null,
        tva_amount: line.tva_amount || null,
        total_ttc: line.total_ttc || null,
        pcg_code: line.pcg_code || null,
        pcg_label: line.pcg_label || null,
        confidence_score: line.confidence_score || null,
        manually_corrected: false,
        journal_code: line.journal_code || null,
      }
      batch.set(lineRef, lineData)
      createdLines.push(lineData)
    }

    await batch.commit()

    return NextResponse.json({ success: true, lines: createdLines })
  } catch (error) {
    console.error('Insert lines error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const linesSnap = await adminDb
      .collection('invoice_lines')
      .where('invoice_id', '==', params.id)
      .get()

    const lines = linesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    return NextResponse.json(lines)
  } catch (error) {
    console.error('Get lines error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
