export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
import { fingerprint, sameLineFingerprint, isPrefixOrSuperset } from '@/lib/bank-tx-validator'

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

    // Group transactions by fingerprint \u2014 uses the SHARED bank-tx-validator helper
    // so insertion-time dedup and retroactive dedup behave identically.
    // Two-pass detection :
    // PASS 1 : exact fingerprint (date+type+amount+normalized-label) -> releve uploade 2x
    // PASS 2 : same-line fingerprint (date+type+amount only) -> 1 ligne PDF coupee en 2
    //         par Claude Vision (ex "PAIEMENT CB ... IRELAND" + "WWW.3MINUTESPIZZ" sur le
    //         meme mouvement). On confirme par isPrefixOrSuperset() pour eviter les faux
    //         positifs (ex 2 abonnements distincts de 9,99 EUR le meme jour).
    type Doc = FirebaseFirestore.QueryDocumentSnapshot
    const groups = new Map<string, Doc[]>()
    const sameLineGroups = new Map<string, Doc[]>()

    for (const doc of snap.docs) {
      const data = doc.data()
      const date = (data.date || '').toString().slice(0, 10)
      const amount = Number(data.amount) || 0
      const type = (data.type as 'debit' | 'credit') || 'debit'
      const label = (data.label || '').toString()
      if (!date || amount === 0 || !label) continue

      const fp = fingerprint(date, type, amount, label)
      if (!groups.has(fp)) groups.set(fp, [])
      groups.get(fp)!.push(doc)

      const slFp = sameLineFingerprint(date, type, amount)
      if (!sameLineGroups.has(slFp)) sameLineGroups.set(slFp, [])
      sameLineGroups.get(slFp)!.push(doc)
    }

    const sortByKeepability = (a: Doc, b: Doc) => {
      const da = a.data(); const db = b.data()
      const aMatched = da.match_status === 'matched' ? 1 : 0
      const bMatched = db.match_status === 'matched' ? 1 : 0
      if (aMatched !== bMatched) return bMatched - aMatched
      const aLen = (da.label || '').length
      const bLen = (db.label || '').length
      if (aLen !== bLen) return bLen - aLen
      return (db.created_at || '').localeCompare(da.created_at || '')
    }

    const toDelete: Doc[] = []
    const toDeleteIds = new Set<string>()
    const duplicateExamples: string[] = []

    // PASS 1 : exact match
    for (const [, docs] of groups.entries()) {
      if (docs.length < 2) continue
      docs.sort(sortByKeepability)
      for (let i = 1; i < docs.length; i++) {
        const dup = docs[i]
        if (dup.data().match_status !== 'matched' && !toDeleteIds.has(dup.id)) {
          toDelete.push(dup)
          toDeleteIds.add(dup.id)
          if (duplicateExamples.length < 10) {
            const d = dup.data()
            duplicateExamples.push(`[exact] ${d.date} ${d.label?.slice(0, 40)} ${d.amount}EUR`)
          }
        }
      }
    }

    // PASS 2 : same-line prefix dedup (parser row-split bug)
    let prefixMerged = 0
    for (const [, docs] of sameLineGroups.entries()) {
      if (docs.length < 2) continue
      const alive = docs.filter((d) => !toDeleteIds.has(d.id))
      if (alive.length < 2) continue
      alive.sort(sortByKeepability) // longest label first (most informative survives)
      const keepers: Doc[] = []
      for (const candidate of alive) {
        const candidateLabel = (candidate.data().label || '').toString()
        const isPrefixDup = keepers.some((k) =>
          isPrefixOrSuperset((k.data().label || '').toString(), candidateLabel)
        )
        if (isPrefixDup && candidate.data().match_status !== 'matched' && !toDeleteIds.has(candidate.id)) {
          toDelete.push(candidate)
          toDeleteIds.add(candidate.id)
          prefixMerged++
          if (duplicateExamples.length < 10) {
            const d = candidate.data()
            duplicateExamples.push(`[prefix] ${d.date} ${d.label?.slice(0, 40)} ${d.amount}EUR`)
          }
        } else {
          keepers.push(candidate)
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
      prefix_merged: prefixMerged,
      examples: duplicateExamples,
    })
  } catch (error) {
    console.error('Deduplicate bank transactions error:', error)
    const msg = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
