export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    // Build a fingerprint for each invoice
    const seen = new Map<string, { id: string; created_at: string }>()
    const duplicateIds: string[] = []
    const duplicateDetails: string[] = []

    // Normalize supplier name: uppercase, strip accents, remove parenthesized content + special chars
    const normalizeSupplier = (s: string) =>
      s.toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/[^A-Z0-9]/g, '')
        .trim()

    // Get the "supplier core" : the supplier name without role suffixes after a dash.
    // "3 minutes pizza - Chef Christophe" -> "3MINUTESPIZZA"
    // "3 minutes pizza - Chef Pizzaiolo Christophe" -> "3MINUTESPIZZA"
    // "3 minutes pizza" -> "3MINUTESPIZZA"
    // All 3 collapse to the same core -> caught as duplicate when date+amount match.
    const supplierCore = (s: string) => {
      const before = (s || '').split(/\s*[\-\u2014,]\s*/)[0] // cut at first dash/comma
      return normalizeSupplier(before)
    }

    for (const doc of snap.docs) {
      const data = doc.data()

      const supplier = normalizeSupplier((data.supplier_name || '').toString())
      const invoiceNum = (data.invoice_number || '').toString().trim().toUpperCase()
      const totalTtc = data.total_ttc != null ? Number(data.total_ttc).toFixed(2) : ''
      const date = (data.invoice_date || '').toString().slice(0, 7) // YYYY-MM
      const fileName = (data.file_name || '').toString().trim().toLowerCase()
      const gmailMsgId = (data.gmail_message_id || '').toString().trim()

      // Strategy 0: GMAIL match — same gmail message id = same file imported twice
      if (gmailMsgId) {
        const fp = `GMAIL|${gmailMsgId}`
        if (seen.has(fp)) {
          duplicateIds.push(doc.id)
          duplicateDetails.push(`${data.file_name || doc.id} (Gmail ${gmailMsgId.slice(0, 8)}...)`)
          continue
        }
        seen.set(fp, { id: doc.id, created_at: data.created_at || '' })
      }

      // Strategy 0bis: NAME match — for invoices WITHOUT extracted data
      // Two invoices with same file_name and no supplier = likely duplicate uploads
      if (!supplier && !invoiceNum && fileName) {
        const fp = `NAME|${fileName}`
        if (seen.has(fp)) {
          duplicateIds.push(doc.id)
          duplicateDetails.push(`${data.file_name || doc.id} (meme nom, sans donnees)`)
          continue
        }
        seen.set(fp, { id: doc.id, created_at: data.created_at || '' })
      }

      if (!supplier && !invoiceNum) continue

      // Strategy 1: STRONG match — invoice_number + total_ttc + date (same number + same amount + same month)
      // Most reliable: two invoices with same number + amount + month = duplicate
      const strongFingerprint = invoiceNum && totalTtc ? `INV|${invoiceNum}|${totalTtc}|${date}` : null

      // Strategy 2: NORMALIZED supplier match — normalized supplier + invoice_number + amount + month
      const normalizedFingerprint = supplier ? `SUP|${supplier}|${invoiceNum}|${totalTtc}|${date}` : null

      // Strategy 3 : SUPPLIER CORE match - core supplier name (before any dash/comma)
      // + same exact day + same amount. Catches the "3 minutes pizza" + "3 minutes pizza
      // - Chef Christophe" + "3 minutes pizza - Chef Pizzaiolo Christophe" case where the
      // AI extracted slightly different supplier names for the same physical ticket.
      const core = supplierCore((data.supplier_name || '').toString())
      const exactDate = (data.invoice_date || '').toString().slice(0, 10) // YYYY-MM-DD
      const coreFingerprint = core && core.length >= 4 && totalTtc && exactDate
        ? `CORE|${core}|${totalTtc}|${exactDate}`
        : null

      const strongMatch = strongFingerprint && seen.has(strongFingerprint)
      const normalizedMatch = normalizedFingerprint && seen.has(normalizedFingerprint)
      const coreMatch = coreFingerprint && seen.has(coreFingerprint)

      if (strongMatch || normalizedMatch || coreMatch) {
        duplicateIds.push(doc.id)
        duplicateDetails.push(`${data.file_name || doc.id} (${data.supplier_name || '?'} ${totalTtc}EUR ${exactDate}${coreMatch && !strongMatch && !normalizedMatch ? ' [core]' : ''})`)
      } else {
        if (strongFingerprint) seen.set(strongFingerprint, { id: doc.id, created_at: data.created_at || '' })
        if (normalizedFingerprint) seen.set(normalizedFingerprint, { id: doc.id, created_at: data.created_at || '' })
        if (coreFingerprint) seen.set(coreFingerprint, { id: doc.id, created_at: data.created_at || '' })
      }
    }

    if (duplicateIds.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        total: snap.docs.length,
        message: 'Aucun doublon trouve',
      })
    }

    // Delete duplicates: files from storage + lines + invoice docs
    const bucket = adminStorage.bucket()
    let deleted = 0

    for (const id of duplicateIds) {
      try {
        const doc = await adminDb.collection('invoices').doc(id).get()
        if (!doc.exists) continue
        const data = doc.data()!

        // Delete file from storage
        if (data.file_path) {
          try { await bucket.file(data.file_path).delete() } catch { /* ignore */ }
        }

        // Delete associated lines
        const linesSnap = await adminDb.collection('invoice_lines').where('invoice_id', '==', id).get()
        if (!linesSnap.empty) {
          const batch = adminDb.batch()
          linesSnap.docs.forEach((d) => batch.delete(d.ref))
          await batch.commit()
        }

        // Delete invoice
        await adminDb.collection('invoices').doc(id).delete()
        deleted++
      } catch (e) {
        console.error(`Error deleting duplicate ${id}:`, e)
      }
    }

    return NextResponse.json({
      success: true,
      deleted,
      total: snap.docs.length,
      remaining: snap.docs.length - deleted,
      details: duplicateDetails.slice(0, 20),
    })
  } catch (error) {
    console.error('Deduplicate error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
