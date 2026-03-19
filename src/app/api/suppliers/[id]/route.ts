import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// PATCH: update supplier (toggle auto_classify, update mappings, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    await adminDb.collection('suppliers').doc(params.id).update(body)

    const updated = await adminDb.collection('suppliers').doc(params.id).get()
    return NextResponse.json({ id: updated.id, ...updated.data() })
  } catch (error) {
    console.error('PATCH supplier error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
