import { adminDb } from '@/lib/firebase/admin'

/**
 * Write an immutable audit log entry to Firestore.
 */
export async function writeAuditLog(params: {
  action: string
  invoice_id: string
  user_id: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}) {
  await adminDb.collection('auditLogs').add({
    action: params.action,
    invoice_id: params.invoice_id,
    user_id: params.user_id,
    before: params.before || null,
    after: params.after || null,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Save an AI correction for learning. When a user manually corrects
 * a classification, we record it so AI can improve over time.
 */
export async function saveAICorrection(params: {
  supplier_name: string
  original_account: string
  corrected_account: string
  description_keywords: string
  amount_ht: number
}) {
  await adminDb.collection('aiCorrections').add({
    supplier_name: params.supplier_name,
    original_account: params.original_account,
    corrected_account: params.corrected_account,
    description_keywords: params.description_keywords,
    amount_ht: params.amount_ht,
    created_at: new Date().toISOString(),
  })
}

/**
 * Get past AI corrections for a supplier to improve classification.
 */
export async function getCorrectionsForSupplier(supplierName: string) {
  const snap = await adminDb
    .collection('aiCorrections')
    .where('supplier_name', '==', supplierName)
    .orderBy('created_at', 'desc')
    .limit(20)
    .get()

  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}
