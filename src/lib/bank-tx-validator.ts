/**
 * Shared deterministic corrections + dedup helpers for bank transaction ingestion.
 * Applied identically across PDF (analyze), CSV/Excel (upload), and save-transactions.
 *
 * Goal : eliminate parser errors (wrong debit/credit sense, duplicates) that
 * make manual reconciliation impossible.
 */

/**
 * Forces the type based on the label when the pattern is non-ambiguous.
 * Returns 'debit' | 'credit' | null (null = trust the upstream parser).
 */
export function forceTypeFromLabel(label: string): 'debit' | 'credit' | null {
  const u = (label || '').toUpperCase()

  // Forced CREDIT (recettes)
  if (/^REMCB|REMISE CHEQUE|REMISE TICKET|REMISE ANCV/.test(u)) return 'credit'
  if (/VIR (SEPA )?(INST )?PAYPAL|VIR PAYPAL PTE/.test(u)) return 'credit'
  if (/VIR (SEPA |INST )?(EDENRED|CAP LOISIRS|LUDOBOX|FUNBOOKER|ASP |DRFIP|EUROFEU|ORANGE|SOCOTEC)/.test(u)) return 'credit'

  // Forced DEBIT (depenses)
  if (/^PRLV |^PAIEMENT CB|^FRAIS |^COMCB|^ECH PRET|^INTERETS|FACT SGT|PLAN SANTE|TNS PREVOYANCE|COMPLEMENTAIRE SANTE|AUTOMOBILE PRO/.test(u)) return 'debit'
  if (/^VIR (SEPA |INST )?ACOMPTE|^VIR (SEPA |INST )?SALAIRE|^VIR (SEPA )?LOYER|^VIR (SEPA )?FORFAIT|^VIR (SEPA )?INDEMNITES/.test(u)) return 'debit'
  if (/VIR (SEPA )?BOEHME ALLAN|VIR (SEPA )?ALLAN BOEHME/.test(u)) return 'debit'

  return null
}

/**
 * Normalize a label for dedup fingerprinting :
 * - uppercase + strip accents
 * - strip variable refs (REF/NUM/ID/RUM/VU.../CU.../SCT...)
 * - strip long numbers (8+ digits = IDs)
 * - first 40 chars
 */
export function normalizeLabel(s: string): string {
  return (s || '').toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(REF|NUM|ID|RUM|VU\d+|CU\d+|SCT\w+)\s*\S*/gi, '')
    .replace(/\d{8,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

/**
 * Fingerprint a transaction for dedup.
 * Two transactions with the same fingerprint are considered duplicates.
 */
export function fingerprint(
  date: string,
  type: 'debit' | 'credit',
  amount: number,
  label: string
): string {
  const dateKey = (date || '').toString().slice(0, 10)
  return `${dateKey}|${type}|${amount.toFixed(2)}|${normalizeLabel(label)}`
}
