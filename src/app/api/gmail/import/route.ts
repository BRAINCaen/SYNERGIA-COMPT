export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const { message_id, attachment_id, filename } = await request.json()

    if (!message_id || !attachment_id || !filename) {
      return NextResponse.json(
        { error: 'Parametres manquants: message_id, attachment_id, filename' },
        { status: 400 }
      )
    }

    // Get stored tokens
    const tokenDoc = await adminDb.collection('gmailTokens').doc(decoded.uid).get()
    if (!tokenDoc.exists) {
      return NextResponse.json({ error: 'Gmail non connecte' }, { status: 400 })
    }

    const tokenData = tokenDoc.data()!

    // Download attachment via direct fetch (no googleapis needed)
    const attachRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/attachments/${attachment_id}`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    )

    if (!attachRes.ok) {
      const err = await attachRes.json().catch(() => ({}))
      const errMsg = err.error?.message || `Gmail API error ${attachRes.status}`
      if (errMsg.includes('invalid_grant') || errMsg.includes('Token has been expired')) {
        return NextResponse.json(
          { error: 'Session Gmail expiree. Veuillez vous reconnecter.', reconnect: true },
          { status: 401 }
        )
      }
      return NextResponse.json({ error: errMsg }, { status: 500 })
    }

    const attachData = await attachRes.json()

    if (!attachData.data) {
      return NextResponse.json({ error: 'Piece jointe vide' }, { status: 400 })
    }

    // Gmail returns base64url encoded data
    const pdfBuffer = Buffer.from(attachData.data, 'base64url')

    // Upload to Firebase Storage
    const storagePath = `invoices/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.pdf`
    const bucket = adminStorage.bucket()
    const fileRef = bucket.file(storagePath)

    await fileRef.save(pdfBuffer, {
      metadata: { contentType: 'application/pdf' },
    })

    // Create invoice document in Firestore
    const invoiceRef = adminDb.collection('invoices').doc()
    const invoiceData = {
      id: invoiceRef.id,
      user_id: decoded.uid,
      file_name: filename,
      file_path: storagePath,
      file_type: 'application/pdf',
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
      source: 'gmail',
      gmail_message_id: message_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await invoiceRef.set(invoiceData)

    return NextResponse.json({ success: true, invoice: invoiceData })
  } catch (error) {
    console.error('Gmail import error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    if (message.includes('invalid_grant') || message.includes('Token has been expired')) {
      return NextResponse.json(
        { error: 'Session Gmail expiree. Veuillez vous reconnecter.', reconnect: true },
        { status: 401 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
