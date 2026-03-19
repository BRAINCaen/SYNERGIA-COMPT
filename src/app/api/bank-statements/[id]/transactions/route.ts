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

    const snap = await adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)
      .get()

    let transactions = snap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data(),
    })) as any[]

    if (matchStatus) transactions = transactions.filter(t => t.match_status === matchStatus)
    if (type) transactions = transactions.filter(t => t.type === type)
    transactions.sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('GET transactions error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
