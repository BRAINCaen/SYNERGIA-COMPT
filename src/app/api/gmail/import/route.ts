import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
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
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const appUrl = process.env.NEXT_PUBLIC_APP_URL

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${appUrl}/api/gmail/callback`
    )

    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || undefined,
      expiry_date: tokenData.expiry_date || undefined,
    })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    // Download attachment
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: message_id,
      id: attachment_id,
    })

    if (!attachment.data.data) {
      return NextResponse.json({ error: 'Piece jointe vide' }, { status: 400 })
    }

    // Decode base64url data
    const pdfBuffer = Buffer.from(attachment.data.data, 'base64url')

    // Upload to Firebase Storage
    const storagePath = `invoices/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.pdf`
    const bucket = adminStorage.bucket()
    const fileRef = bucket.file(storagePath)

    await fileRef.save(pdfBuffer, {
      metadata: { contentType: 'application/pdf' },
    })

    // Create invoice document in Firestore (same structure as manual upload)
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

    // Update tokens if refreshed
    const credentials = oauth2Client.credentials
    if (credentials.access_token && credentials.access_token !== tokenData.access_token) {
      await adminDb.collection('gmailTokens').doc(decoded.uid).update({
        access_token: credentials.access_token,
        expiry_date: credentials.expiry_date || null,
        updated_at: new Date().toISOString(),
      })
    }

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
