import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// Auto-match rules: "transactions containing PATTERN → match with DOCUMENT_ID"
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const snap = await adminDb
      .collection('autoMatchRules')
      .where('user_id', '==', decoded.uid)
      .get()

    const rules = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))

    return NextResponse.json({ rules })
  } catch (error) {
    console.error('GET auto-match-rules error:', error)
    return NextResponse.json({ rules: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await request.json()
    const { pattern, match_type, document_id, document_type, document_name, description } = body

    if (!pattern || !document_id) {
      return NextResponse.json({ error: 'pattern et document_id requis' }, { status: 400 })
    }

    const ref = adminDb.collection('autoMatchRules').doc()
    const rule = {
      id: ref.id,
      user_id: decoded.uid,
      pattern: pattern.toUpperCase(),
      match_type: match_type || 'contains', // contains | starts_with | exact
      document_id,
      document_type: document_type || 'invoice', // invoice | revenue | payslip
      document_name: document_name || '',
      description: description || `Transactions "${pattern}" → ${document_name || document_id}`,
      is_active: true,
      created_at: new Date().toISOString(),
    }

    await ref.set(rule)
    return NextResponse.json({ success: true, rule })
  } catch (error) {
    console.error('POST auto-match-rules error:', error)
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
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    await adminDb.collection('autoMatchRules').doc(id).delete()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE auto-match-rules error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
