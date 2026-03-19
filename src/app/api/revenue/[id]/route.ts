import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const doc = await adminDb.collection('revenueEntries').doc(params.id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Entrée de recette non trouvée' }, { status: 404 })
    }

    const data = doc.data()!
    if (data.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    // Get signed URL if file exists
    let fileUrl = null
    if (data.file_path) {
      try {
        const bucket = adminStorage.bucket()
        const [url] = await bucket.file(data.file_path).getSignedUrl({
          action: 'read',
          expires: Date.now() + 3600 * 1000,
        })
        fileUrl = url
      } catch (e) {
        console.error('Erreur lors de la génération de l\'URL signée:', e)
      }
    }

    return NextResponse.json({ id: doc.id, ...data, file_url: fileUrl })
  } catch (error) {
    console.error('GET revenue entry error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const doc = await adminDb.collection('revenueEntries').doc(params.id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Entrée de recette non trouvée' }, { status: 404 })
    }

    const beforeData = doc.data()!
    if (beforeData.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const body = await request.json()

    // Recalculate TVA if amounts provided
    if (body.amount_ht != null && body.amount_ttc != null) {
      body.tva_amount = Math.round((Number(body.amount_ttc) - Number(body.amount_ht)) * 100) / 100
    }

    body.updated_at = new Date().toISOString()

    // Check if status is changing to 'validated'
    const statusChangedToValidated =
      body.status === 'validated' && beforeData.status !== 'validated'

    await adminDb.collection('revenueEntries').doc(params.id).update(body)

    // Write audit log if status changed to validated
    if (statusChangedToValidated) {
      await writeAuditLog({
        action: 'validate_revenue',
        invoice_id: params.id,
        user_id: decoded.uid,
        before: { status: beforeData.status },
        after: { status: 'validated' },
      })
    }

    const updated = await adminDb.collection('revenueEntries').doc(params.id).get()
    return NextResponse.json({ id: updated.id, ...updated.data() })
  } catch (error) {
    console.error('PUT revenue entry error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const doc = await adminDb.collection('revenueEntries').doc(params.id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Entrée de recette non trouvée' }, { status: 404 })
    }

    const data = doc.data()!
    if (data.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    // Delete file from Storage if exists
    if (data.file_path) {
      try {
        const bucket = adminStorage.bucket()
        await bucket.file(data.file_path).delete()
      } catch (e) {
        console.error('Erreur lors de la suppression du fichier:', e)
      }
    }

    // Audit log
    await writeAuditLog({
      action: 'delete_revenue',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: {
        status: data.status,
        source: data.source,
        amount_ttc: data.amount_ttc,
        description: data.description,
      },
      after: null,
    })

    await adminDb.collection('revenueEntries').doc(params.id).delete()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE revenue entry error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
