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

    const body = await request.json().catch(() => ({})) as { pdf_url?: string }

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

    // Download PDF — prefer signed URL from client, fallback to Storage Admin
    let pdfBytes: Uint8Array
    if (body.pdf_url) {
      const pdfRes = await fetch(body.pdf_url)
      if (!pdfRes.ok) throw new Error(`Erreur téléchargement PDF: ${pdfRes.status}`)
      pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())
    } else {
      const bucket = adminStorage.bucket()
      const [fileBuffer] = await bucket.file(invoice.file_path).download()
      pdfBytes = new Uint8Array(fileBuffer)
    }

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
        reasoning: line.reasoning || null,
        totalHt: line.total_ht || null,
        tvaRate: line.tva_rate || null,
        journalCode: line.journal_code || null,
        confidenceScore: line.confidence_score || null,
        isImmobilization: line.is_immobilization || false,
        classificationMethod: line.classification_method || null,
      }))

    const annotatedPdf = await annotatePdfWithPCG(pdfBytes, annotations)

    return new NextResponse(Buffer.from(annotatedPdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="annotated_${invoice.file_name}"`,
      },
    })
  } catch (error) {
    console.error('Annotate error:', error instanceof Error ? error.message : error, error instanceof Error ? error.stack : '')
    return NextResponse.json({ error: `Erreur annotation: ${error instanceof Error ? error.message : 'inconnue'}` }, { status: 500 })
  }
}
