import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { PDFDocument } from 'pdf-lib'

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/tiff']

async function convertImageToPdf(imageBuffer: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()

  let image
  if (mimeType === 'image/png') {
    image = await pdfDoc.embedPng(imageBuffer)
  } else {
    // JPEG, TIFF (pdf-lib handles JPEG natively, TIFF will be attempted as JPEG)
    image = await pdfDoc.embedJpg(imageBuffer)
  }

  const { width, height } = image.scale(1)
  // Fit to A4 proportions if needed, keeping aspect ratio
  const maxW = 595 // A4 width in points
  const maxH = 842 // A4 height in points
  const scale = Math.min(maxW / width, maxH / height, 1)
  const pageW = width * scale
  const pageH = height * scale

  const page = pdfDoc.addPage([pageW, pageH])
  page.drawImage(image, { x: 0, y: 0, width: pageW, height: pageH })

  return await pdfDoc.save()
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })
    }

    const allowedTypes = ['application/pdf', ...IMAGE_TYPES]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Type de fichier non supporté. Formats acceptés : PDF, JPG, PNG, TIFF' },
        { status: 400 }
      )
    }

    const rawBytes = new Uint8Array(await file.arrayBuffer())
    let contentType = file.type
    let originalName = file.name
    const isImage = IMAGE_TYPES.includes(file.type)

    let uploadBytes: Uint8Array | Buffer = Buffer.from(rawBytes)

    // Convert images to PDF automatically
    if (isImage) {
      uploadBytes = await convertImageToPdf(rawBytes, file.type)
      contentType = 'application/pdf'
      originalName = originalName.replace(/\.(jpe?g|png|tiff?)$/i, '.pdf')
    }

    // Upload to Firebase Storage (always as PDF now)
    const fileName = `invoices/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.pdf`

    const bucket = adminStorage.bucket()
    const fileRef = bucket.file(fileName)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fileRef.save(Buffer.from(uploadBytes as any), {
      metadata: { contentType },
    })

    // Create invoice document in Firestore
    const invoiceRef = adminDb.collection('invoices').doc()
    const invoiceData = {
      id: invoiceRef.id,
      user_id: decoded.uid,
      file_name: originalName,
      file_path: fileName,
      file_type: contentType,
      document_type: 'expense',
      revenue_source: null,
      supplier_name: null,
      supplier_siret: null,
      invoice_number: null,
      invoice_date: null,
      due_date: null,
      total_ht: null,
      total_tva: null,
      total_ttc: null,
      currency: 'EUR',
      status: 'pending',
      raw_extraction: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await invoiceRef.set(invoiceData)

    return NextResponse.json({ success: true, invoice: invoiceData, converted: isImage })
  } catch (error) {
    console.error('Upload error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
