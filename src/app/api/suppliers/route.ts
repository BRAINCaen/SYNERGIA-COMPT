import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// GET: list all suppliers
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const snap = await adminDb.collection('suppliers').orderBy('last_used_at', 'desc').get()
    const suppliers = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

    return NextResponse.json(suppliers)
  } catch (error) {
    console.error('GET suppliers error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
