import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'

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

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/tiff']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Type de fichier non supporté. Formats acceptés : PDF, JPG, PNG, TIFF' },
        { status: 400 }
      )
    }

    // Upload to Firebase Storage
    const fileExt = file.name.split('.').pop()
    const fileName = `invoices/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.${fileExt}`

    const bucket = adminStorage.bucket()
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const fileRef = bucket.file(fileName)

    await fileRef.save(fileBuffer, {
      metadata: { contentType: file.type },
    })

    // Create invoice document in Firestore
    const invoiceRef = adminDb.collection('invoices').doc()
    const invoiceData = {
      id: invoiceRef.id,
      user_id: decoded.uid,
      file_name: file.name,
      file_path: fileName,
      file_type: file.type,
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

    return NextResponse.json({ success: true, invoice: invoiceData })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
