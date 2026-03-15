export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let query: FirebaseFirestore.Query = adminDb.collection('invoices').orderBy('created_at', 'desc')

    if (status && status !== 'all') {
      query = query.where('status', '==', status)
    }

    const snap = await query.get()
    const invoices = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    return NextResponse.json(invoices)
  } catch (error) {
    console.error('GET invoices error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
