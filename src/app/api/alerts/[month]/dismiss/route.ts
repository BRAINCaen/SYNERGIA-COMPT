import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function POST(
  request: NextRequest,
  { params }: { params: { month: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const month = params.month
    const monthRegex = /^\d{4}-\d{2}$/
    if (!monthRegex.test(month)) {
      return NextResponse.json(
        { error: 'Format de mois invalide. Utilisez YYYY-MM' },
        { status: 400 }
      )
    }

    const docId = `${decoded.uid}_${month}`
    const alertDoc = await adminDb.collection('monthlyAlerts').doc(docId).get()

    if (!alertDoc.exists) {
      return NextResponse.json(
        { error: 'Aucune alerte trouvée pour ce mois' },
        { status: 404 }
      )
    }

    const data = alertDoc.data()!
    if (data.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    await adminDb.collection('monthlyAlerts').doc(docId).update({
      is_dismissed: true,
      dismissed_at: new Date().toISOString(),
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('POST dismiss alert error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
