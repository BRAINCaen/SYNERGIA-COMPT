import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { writeAuditLog, saveAICorrection } from '@/lib/audit'

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

    // Get invoice before update for audit
    const invoiceDocBefore = await adminDb.collection('invoices').doc(params.id).get()
    const invoiceBefore = invoiceDocBefore.data()!
    const previousStatus = invoiceBefore.status

    // Update invoice status to validated
    await adminDb.collection('invoices').doc(params.id).update({
      status: 'validated',
      updated_at: new Date().toISOString(),
    })

    const invoiceDoc = await adminDb.collection('invoices').doc(params.id).get()
    const invoice = invoiceDoc.data()!

    // Audit log: status change to validated
    await writeAuditLog({
      action: 'validate',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: { status: previousStatus },
      after: { status: 'validated', lines: lines.map((l) => ({ id: l.id, pcg_code: l.pcg_code })) },
    })

    // AI Corrections: save any manual corrections for learning
    const existingLinesSnap = await adminDb
      .collection('invoice_lines')
      .where('invoice_id', '==', params.id)
      .get()

    for (const lineDoc of existingLinesSnap.docs) {
      const lineData = lineDoc.data()
      const lineUpdate = lines.find((l) => l.id === lineDoc.id)
      if (
        lineUpdate &&
        lineUpdate.manually_corrected &&
        lineData.pcg_code &&
        lineUpdate.pcg_code !== lineData.pcg_code
      ) {
        await saveAICorrection({
          supplier_name: invoice.supplier_name || '',
          original_account: lineData.pcg_code,
          corrected_account: lineUpdate.pcg_code,
          description_keywords: lineData.description || '',
          amount_ht: lineData.total_ht || 0,
        })
      }
    }

    // Update supplier with full line mappings (learning)
    if (invoice.supplier_name && lines.length > 0) {
      // Build line mappings: description → pcg_code/label/journal
      const lineMappings = lines.map((l) => ({
        description: l.pcg_label || '',
        pcg_code: l.pcg_code,
        pcg_label: l.pcg_label,
        journal_code: l.journal_code,
      }))

      // Get full line data for descriptions
      const fullLinesSnap = await adminDb
        .collection('invoice_lines')
        .where('invoice_id', '==', params.id)
        .get()

      const fullLineMappings = fullLinesSnap.docs.map((doc) => {
        const data = doc.data()
        const lineUpdate = lines.find((l) => l.id === doc.id)
        return {
          description: data.description || '',
          pcg_code: lineUpdate?.pcg_code || data.pcg_code,
          pcg_label: lineUpdate?.pcg_label || data.pcg_label,
          journal_code: lineUpdate?.journal_code || data.journal_code,
        }
      })

      const supplierSnap = await adminDb
        .collection('suppliers')
        .where('name', '==', invoice.supplier_name)
        .limit(1)
        .get()

      if (!supplierSnap.empty) {
        const existingData = supplierSnap.docs[0].data()
        const existingMappings = existingData.line_mappings || []

        // Merge: update existing mappings, add new ones
        const mergedMappings = [...existingMappings]
        for (const newMapping of fullLineMappings) {
          const existingIdx = mergedMappings.findIndex(
            (m: { description: string }) => m.description.toLowerCase() === newMapping.description.toLowerCase()
          )
          if (existingIdx >= 0) {
            mergedMappings[existingIdx] = newMapping
          } else {
            mergedMappings.push(newMapping)
          }
        }

        await supplierSnap.docs[0].ref.update({
          default_pcg_code: lines[0].pcg_code,
          line_mappings: mergedMappings,
          auto_classify: existingData.auto_classify || false,
          last_used_at: new Date().toISOString(),
        })
      } else {
        await adminDb.collection('suppliers').add({
          name: invoice.supplier_name,
          siret: invoice.supplier_siret || null,
          default_pcg_code: lines[0].pcg_code,
          line_mappings: fullLineMappings,
          auto_classify: false,
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
