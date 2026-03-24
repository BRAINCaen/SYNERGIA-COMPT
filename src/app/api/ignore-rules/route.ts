import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const snapshot = await adminDb
      .collection('ignoreRules')
      .where('user_id', '==', decoded.uid)
      .get()

    const rules = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))

    return NextResponse.json({ rules })
  } catch (error) {
    console.error('GET ignore-rules error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { pattern, match_type, description } = await request.json()

    if (!pattern || !match_type) {
      return NextResponse.json(
        { error: 'pattern et match_type requis' },
        { status: 400 }
      )
    }

    if (!['contains', 'starts_with', 'exact'].includes(match_type)) {
      return NextResponse.json(
        { error: 'match_type invalide (contains | starts_with | exact)' },
        { status: 400 }
      )
    }

    const ref = adminDb.collection('ignoreRules').doc()
    const rule = {
      id: ref.id,
      user_id: decoded.uid,
      pattern: pattern.toUpperCase(),
      match_type,
      description: description || '',
      created_at: new Date().toISOString(),
    }

    await ref.set(rule)

    return NextResponse.json({ success: true, rule })
  } catch (error) {
    console.error('POST ignore-rules error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const ruleId = searchParams.get('id')

    if (!ruleId) {
      return NextResponse.json({ error: 'id requis' }, { status: 400 })
    }

    const doc = await adminDb.collection('ignoreRules').doc(ruleId).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Règle non trouvée' }, { status: 404 })
    }

    const data = doc.data()!
    if (data.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    await adminDb.collection('ignoreRules').doc(ruleId).delete()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE ignore-rules error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
