import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Compute alert data for a given month (YYYY-MM) and user.
 * Returns null if no bank transaction data exists for that month.
 */
async function computeAlertForMonth(userId: string, month: string) {
  const startDate = `${month}-01`
  // End date: first day of next month
  const [year, m] = month.split('-').map(Number)
  const nextMonth = m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`
  const endDate = `${nextMonth}-01`

  // Get all bank transactions for the month
  const txSnap = await adminDb
    .collection('bankTransactions')
    .where('user_id', '==', userId)
    .where('date', '>=', startDate)
    .where('date', '<', endDate)
    .get()

  if (txSnap.empty) {
    return null
  }

  const transactions = txSnap.docs.map((doc) => doc.data())
  const totalTransactions = transactions.length

  const unmatchedDebits = transactions.filter(
    (t) => t.match_status === 'unmatched' && t.type === 'debit'
  ).length

  const unmatchedCredits = transactions.filter(
    (t) => t.match_status === 'unmatched' && t.type === 'credit'
  ).length

  const totalUnmatched = unmatchedDebits + unmatchedCredits

  // Count invoices in that month with no matching bank transaction
  const invoiceSnap = await adminDb
    .collection('invoices')
    .where('user_id', '==', userId)
    .where('invoice_date', '>=', startDate)
    .where('invoice_date', '<', endDate)
    .get()

  let missingInvoices = 0
  for (const doc of invoiceSnap.docs) {
    const inv = doc.data()
    // Check if this invoice has a matching bank transaction
    const matchSnap = await adminDb
      .collection('bankTransactions')
      .where('user_id', '==', userId)
      .where('matched_invoice_id', '==', doc.id)
      .limit(1)
      .get()

    if (matchSnap.empty) {
      missingInvoices++
    }
  }

  const reconciliationRate =
    totalTransactions > 0
      ? Math.round(((totalTransactions - totalUnmatched) / totalTransactions) * 10000) / 100
      : 0

  return {
    month,
    user_id: userId,
    total_transactions: totalTransactions,
    unmatched_debits: unmatchedDebits,
    unmatched_credits: unmatchedCredits,
    missing_invoices: missingInvoices,
    reconciliation_rate: reconciliationRate,
    is_dismissed: false,
    computed_at: new Date().toISOString(),
  }
}

/**
 * Get or compute the monthly alert for a given month + user.
 * Uses Firestore as cache.
 */
async function getOrComputeAlert(userId: string, month: string) {
  const docId = `${userId}_${month}`
  const alertDoc = await adminDb.collection('monthlyAlerts').doc(docId).get()

  if (alertDoc.exists) {
    return { id: alertDoc.id, ...alertDoc.data() }
  }

  // Compute and cache
  const alertData = await computeAlertForMonth(userId, month)
  if (!alertData) {
    return null
  }

  await adminDb.collection('monthlyAlerts').doc(docId).set(alertData)
  return { id: docId, ...alertData }
}

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const now = new Date()
    // Previous month
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

    // Current month
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const [prevAlert, currentAlert] = await Promise.all([
      getOrComputeAlert(decoded.uid, prevMonth),
      getOrComputeAlert(decoded.uid, currentMonth),
    ])

    return NextResponse.json({
      previous_month: prevAlert,
      current_month: currentAlert,
    })
  } catch (error) {
    console.error('GET alerts error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
