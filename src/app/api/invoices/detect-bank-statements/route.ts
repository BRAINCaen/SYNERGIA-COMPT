export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Find invoices that are actually bank statements misclassified.
 * Detection: file_name or supplier mentions bank statement keywords.
 */
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    const bankPatterns = [
      /releve.*bancaire/i,
      /releve.*compte/i,
      /bank.*statement/i,
      /extrait.*compte/i,
      /c\/c\s*eurocompte/i,
      /cic.*cygne/i,
      /credit.*mutuel.*cygne/i,
    ]

    const suspects: Array<{
      id: string
      file_name: string
      supplier_name: string | null
      total_ttc: number | null
      invoice_date: string | null
      created_at: string
    }> = []

    for (const doc of snap.docs) {
      const data = doc.data()
      const fileName = (data.file_name || '').toString()
      const supplier = (data.supplier_name || '').toString()
      const combined = `${fileName} ${supplier}`

      const isSuspect = bankPatterns.some((pat) => pat.test(combined))
      if (isSuspect) {
        suspects.push({
          id: doc.id,
          file_name: fileName,
          supplier_name: data.supplier_name || null,
          total_ttc: data.total_ttc || null,
          invoice_date: data.invoice_date || null,
          created_at: data.created_at || '',
        })
      }
    }

    return NextResponse.json({
      success: true,
      count: suspects.length,
      suspects,
    })
  } catch (error) {
    console.error('Detect bank statements error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
