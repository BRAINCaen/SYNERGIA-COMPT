import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { annotatePdfWithPCG } from '@/lib/pdf-utils'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const invoiceDoc = await adminDb.collection('invoices').doc(params.id).get()
    if (!invoiceDoc.exists) {
      return NextResponse.json({ error: 'Facture non trouvée' }, { status: 404 })
    }

    const invoice = invoiceDoc.data()!

    if (invoice.file_type !== 'application/pdf') {
      return NextResponse.json(
        { error: "L'annotation n'est disponible que pour les fichiers PDF" },
        { status: 400 }
      )
    }

    // Download original PDF from Firebase Storage
    const bucket = adminStorage.bucket()
    const [fileBuffer] = await bucket.file(invoice.file_path).download()
    const pdfBytes = new Uint8Array(fileBuffer)

    // Get lines
    const linesSnap = await adminDb
      .collection('invoice_lines')
      .where('invoice_id', '==', params.id)
      .get()

    const annotations = linesSnap.docs
      .map((doc) => doc.data())
      .filter((line) => line.pcg_code)
      .map((line) => ({
        lineDescription: line.description,
        pcgCode: line.pcg_code,
        pcgLabel: line.pcg_label || '',
      }))

    const annotatedPdf = await annotatePdfWithPCG(pdfBytes, annotations)

    return new NextResponse(Buffer.from(annotatedPdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="annotated_${invoice.file_name}"`,
      },
    })
  } catch (error) {
    console.error('Annotate error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
