export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Supplier classification rules — learned from user corrections.
 * Collection: supplierRules
 * Doc: { user_id, supplier_name, pcg_code, pcg_label, journal_code, times_confirmed, last_updated }
 */

// GET all rules for user
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) return NextResponse.json({ error: 'Non autorise' }, { status: 401 })

    const snap = await adminDb
      .collection('supplierRules')
      .where('user_id', '==', decoded.uid)
      .get()

    const rules = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    return NextResponse.json({ rules })
  } catch (error) {
    console.error('GET supplier rules error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// POST — learn from a correction: create or update a rule
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) return NextResponse.json({ error: 'Non autorise' }, { status: 401 })

    const body = await request.json()
    const { supplier_name, pcg_code, pcg_label, journal_code } = body

    if (!supplier_name || !pcg_code) {
      return NextResponse.json({ error: 'supplier_name et pcg_code requis' }, { status: 400 })
    }

    // Normalize supplier name (uppercase, trimmed)
    const normalizedName = supplier_name.toUpperCase().trim()

    // Check if rule exists
    const existing = await adminDb
      .collection('supplierRules')
      .where('user_id', '==', decoded.uid)
      .where('supplier_name_normalized', '==', normalizedName)
      .limit(1)
      .get()

    const now = new Date().toISOString()

    if (!existing.empty) {
      // Update existing rule
      const doc = existing.docs[0]
      const prevData = doc.data()
      await doc.ref.update({
        pcg_code,
        pcg_label: pcg_label || prevData.pcg_label,
        journal_code: journal_code || prevData.journal_code || 'AC',
        times_confirmed: (prevData.times_confirmed || 1) + 1,
        last_updated: now,
      })
      return NextResponse.json({ success: true, updated: true, id: doc.id })
    }

    // Create new rule
    const ref = adminDb.collection('supplierRules').doc()
    await ref.set({
      id: ref.id,
      user_id: decoded.uid,
      supplier_name,
      supplier_name_normalized: normalizedName,
      pcg_code,
      pcg_label: pcg_label || '',
      journal_code: journal_code || 'AC',
      times_confirmed: 1,
      created_at: now,
      last_updated: now,
    })

    return NextResponse.json({ success: true, created: true, id: ref.id })
  } catch (error) {
    console.error('POST supplier rule error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// DELETE a rule
export async function DELETE(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) return NextResponse.json({ error: 'Non autorise' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    const doc = await adminDb.collection('supplierRules').doc(id).get()
    if (!doc.exists || doc.data()?.user_id !== decoded.uid) {
      return NextResponse.json({ error: 'Regle non trouvee' }, { status: 404 })
    }

    await doc.ref.delete()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE supplier rule error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
