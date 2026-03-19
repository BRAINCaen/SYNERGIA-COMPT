import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Verify statement exists
    const statementDoc = await adminDb.collection('bankStatements').doc(params.id).get()
    if (!statementDoc.exists) {
      return NextResponse.json({ error: 'Relevé non trouvé' }, { status: 404 })
    }

    // Build query with optional filters
    const { searchParams } = new URL(request.url)
    const matchStatus = searchParams.get('match_status')
    const type = searchParams.get('type')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)

    if (matchStatus) {
      query = query.where('match_status', '==', matchStatus)
    }

    if (type) {
      query = query.where('type', '==', type)
    }

    query = query.orderBy('date', 'asc')

    const snap = await query.get()
    const transactions = snap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data(),
    }))

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('GET transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
