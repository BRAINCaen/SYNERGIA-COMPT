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
 * Normalize a label for dedup fingerprinting.
 * Goal : two labels referring to the same merchant/operation collide,
 * even if the parser captured slightly different suffixes.
 *
 * Strategy :
 * - uppercase + strip accents + strip punctuation
 * - strip prefixes that don't identify the merchant (SEPA, INST, CB XXXX)
 * - strip generic legal suffixes (SARL, SAS, EURL, SA, EU, FRANCE, ...)
 * - strip variable refs (REF/NUM/ID/RUM/VU.../CU.../SCT...)
 * - strip long numbers (8+ digits = IDs)
 * - keep first 3 meaningful words after the operation type (e.g. "PRLV AMAZON" or
 *   "PAIEMENT CB UBER EATS"), max 25 chars
 */
export function normalizeLabel(s: string): string {
  let n = (s || '').toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[,.\-_/]/g, ' ')
    .replace(/\b(REF|NUM|ID|RUM|VU\d+|CU\d+|SCT\w+)\s*\S*/gi, '')
    .replace(/\d{8,}/g, '')
    .replace(/\bCB\s+\d{2,4}\b/g, '') // strip "CB 0604" card-number suffix
    .replace(/\b(SEPA|INST|INTERNATIONAL)\b/g, '')
    .replace(/\b(SARL|SAS|EURL|SA|SASU|EU|SUCCURSALE|SUCCU|FRANCAISE|FRANCAIS|FRANCE|LIMITED|LTD|LLC|INC|GMBH|SARL,?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Keep operation prefix (PRLV/VIR/PAIEMENT/REMCB) + first 2-3 distinct merchant words
  const parts = n.split(' ').filter(Boolean)
  const opPrefixes = new Set(['PRLV', 'VIR', 'PAIEMENT', 'REMCB', 'COMCB', 'FRAIS', 'ECH', 'INTERETS'])
  const out: string[] = []
  const seenMerchantWords = new Set<string>()
  for (const word of parts) {
    if (opPrefixes.has(word)) {
      out.push(word)
      continue
    }
    if (seenMerchantWords.has(word)) continue // skip duplicate words (parser noise)
    seenMerchantWords.add(word)
    out.push(word)
    if (seenMerchantWords.size >= 3) break
  }
  return out.join(' ').slice(0, 25)
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
