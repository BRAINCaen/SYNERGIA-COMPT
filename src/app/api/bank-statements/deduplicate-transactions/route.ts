export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Find duplicate bank transactions (same date + amount + label/reference).
 * Typical cause: a bank statement uploaded twice.
 * Priority: keeps matched transactions, deletes unmatched duplicates.
 */
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const { dry_run = false } = await request.json().catch(() => ({}))

    const snap = await adminDb
      .collection('bankTransactions')
      .where('user_id', '==', decoded.uid)
      .get()

    // Normalize label: uppercase, strip accents, collapse whitespace, remove non-alphanumeric
    const normalizeLabel = (s: string) =>
      s.toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    // Group transactions by fingerprint
    type Doc = FirebaseFirestore.QueryDocumentSnapshot
    const groups = new Map<string, Doc[]>()

    for (const doc of snap.docs) {
      const data = doc.data()
      const date = (data.date || '').toString().slice(0, 10)
      const amount = data.amount != null ? Number(data.amount).toFixed(2) : ''
      const label = normalizeLabel((data.label || '').toString())
      const type = data.type || ''
      if (!date || !amount || !label) continue

      // Fingerprint: date + amount + type + normalized label
      const fp = `${date}|${type}|${amount}|${label}`
      if (!groups.has(fp)) groups.set(fp, [])
      groups.get(fp)!.push(doc)
    }

    // Find duplicates — keep the best candidate in each group
    const toDelete: Doc[] = []
    const duplicateExamples: string[] = []

    for (const [fp, docs] of groups.entries()) {
      if (docs.length < 2) continue

      // Sort: matched first (keep matched), then by created_at desc (keep the newer if untied)
      docs.sort((a, b) => {
        const aMatched = a.data().match_status === 'matched' ? 1 : 0
        const bMatched = b.data().match_status === 'matched' ? 1 : 0
        if (aMatched !== bMatched) return bMatched - aMatched
        const aCreated = a.data().created_at || ''
        const bCreated = b.data().created_at || ''
        return bCreated.localeCompare(aCreated)
      })

      // Keep docs[0], delete the rest (but only if they are unmatched to avoid losing links)
      for (let i = 1; i < docs.length; i++) {
        const dup = docs[i]
        // Only delete if duplicate is unmatched (safety)
        if (dup.data().match_status !== 'matched') {
          toDelete.push(dup)
          if (duplicateExamples.length < 10) {
            const d = dup.data()
            duplicateExamples.push(`${d.date} ${d.label?.slice(0, 40)} ${d.amount}EUR`)
          }
        }
      }
    }

    if (dry_run) {
      return NextResponse.json({
        success: true,
        dry_run: true,
        duplicates_found: toDelete.length,
        examples: duplicateExamples,
      })
    }

    // Delete in batches of 490
    let deleted = 0
    for (let i = 0; i < toDelete.length; i += 490) {
      const chunk = toDelete.slice(i, i + 490)
      const batch = adminDb.batch()
      chunk.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      deleted += chunk.length
    }

    return NextResponse.json({
      success: true,
      deleted,
      examples: duplicateExamples,
    })
  } catch (error) {
    console.error('Deduplicate bank transactions error:', error)
    const msg = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
