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

    const body = await request.json()
    const { lines } = body as {
      lines: {
        id: string
        pcg_code: string
        pcg_label: string
        journal_code: string
        manually_corrected: boolean
      }[]
    }

    // Update each line
    const batch = adminDb.batch()
    for (const line of lines) {
      const lineRef = adminDb.collection('invoice_lines').doc(line.id)
      batch.update(lineRef, {
        pcg_code: line.pcg_code,
        pcg_label: line.pcg_label,
        journal_code: line.journal_code,
        manually_corrected: line.manually_corrected,
      })
    }
    await batch.commit()

    // Update invoice status to validated
    await adminDb.collection('invoices').doc(params.id).update({
      status: 'validated',
      updated_at: new Date().toISOString(),
    })

    const invoiceDoc = await adminDb.collection('invoices').doc(params.id).get()
    const invoice = invoiceDoc.data()!

    // Update supplier default code (learning)
    if (invoice.supplier_name && lines.length > 0) {
      const mainLine = lines[0]

      const supplierSnap = await adminDb
        .collection('suppliers')
        .where('name', '==', invoice.supplier_name)
        .limit(1)
        .get()

      if (!supplierSnap.empty) {
        await supplierSnap.docs[0].ref.update({
          default_pcg_code: mainLine.pcg_code,
          last_used_at: new Date().toISOString(),
        })
      } else {
        await adminDb.collection('suppliers').add({
          name: invoice.supplier_name,
          siret: invoice.supplier_siret || null,
          default_pcg_code: mainLine.pcg_code,
          last_used_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
      }
    }

    return NextResponse.json({ success: true, invoice: { id: params.id, ...invoice } })
  } catch (error) {
    console.error('Validate error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
