// Classification directe sans appel IA — confiance 0.99
// Source : grand livre 2025 BOEHME
// Mapping fournisseurs connus vers comptes PCG BOEHME

export interface KnownSupplier {
  account: string
  label: string
  confidence: number
  checkImmobilization: boolean
  journalCode: string
  notes?: string
}

export const KNOWN_SUPPLIERS: Record<string, KnownSupplier> = {
  // Télécom
  "ORANGE":           { account: "62620000", label: "ORANGE 02 31 52 91 26", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "FREE":             { account: "62630000", label: "FREE", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },

  // Abonnements SaaS
  "CAPCUT":           { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.97, checkImmobilization: false, journalCode: "AC" },
  "SKELLO":           { account: "61350100", label: "SKELLO", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "INEXWEB":          { account: "61357000", label: "INEXWEB", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "DROPBOX":          { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.97, checkImmobilization: false, journalCode: "AC" },
  "OPENAI":           { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },
  "ANTHROPIC":        { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },
  "ADOBE":            { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.97, checkImmobilization: false, journalCode: "AC" },
  "CANVA":            { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.97, checkImmobilization: false, journalCode: "AC" },
  "CLAUDE":           { account: "60640000", label: "FOURNITURES DE BUREAU", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },

  // Véhicule
  "DIAC":             { account: "61353000", label: "DIAC LOCATION JOGGER", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },

  // Paiement & bancaire
  "INGENICO":         { account: "61350000", label: "LOCATION INGENICO", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "IZETTLE":          { account: "62782000", label: "COMMISSIONS IZETTLE", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "ZETTLE":           { account: "62782000", label: "COMMISSIONS IZETTLE", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "CREDIT MUTUEL":    { account: "62781000", label: "COMMISSIONS CB", confidence: 0.95, checkImmobilization: false, journalCode: "BQ" },

  // Plateformes réservation
  "FUNBOOKER":        { account: "62788000", label: "COMMISSIONS FUNBOOKER", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "FUN BOOKER":       { account: "62788000", label: "COMMISSIONS FUNBOOKER", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "ADRENALINE":       { account: "62787000", label: "COMMISSIONS ADRENALINE", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "BOOMRANG":         { account: "62785000", label: "COMMISSIONS BOOMRANG LUDOBOX", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "LUDOBOX":          { account: "62785000", label: "COMMISSIONS BOOMRANG LUDOBOX", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "ANCV":             { account: "62783000", label: "COMMISSIONS ANCV", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },

  // Franchise Brain Escape
  "BUZZ YOUR BRAIN":  { account: "65120000", label: "REDEVANCE LICENCE PROPORTIONNELLE", confidence: 0.99, checkImmobilization: false, journalCode: "AC",
                        notes: "Vérifier si forfait mensuel → 65110000 ou variable % CA → 65120000" },
  "BRAIN ESCAPE":     { account: "65110000", label: "REDEVANCE LICENCE FORFAITAIRE", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },

  // Energie
  "EDF":              { account: "60616000", label: "ELECTRICITE", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "ENGIE":            { account: "60616000", label: "ELECTRICITE", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },

  // Organismes sociaux
  "HUMANIS":          { account: "64530000", label: "COTIS.RETRAITE HUMANIS", confidence: 0.99, checkImmobilization: false, journalCode: "OD" },
  "MALAKOFF":         { account: "64560000", label: "MUTUELLE", confidence: 0.99, checkImmobilization: false, journalCode: "OD" },
  "MALAKOFF HUMANIS": { account: "64530000", label: "COTIS.RETRAITE HUMANIS", confidence: 0.97, checkImmobilization: false, journalCode: "OD" },
  "URSSAF":           { account: "64510000", label: "COTIS.URSSAF", confidence: 0.99, checkImmobilization: false, journalCode: "OD" },

  // Entretien & bâtiment (vérifier immobilisation si > 500€ HT)
  "H2N":              { account: "21810000", label: "AGENCEMENT AMENAGEMENT DIVERS", confidence: 0.85, checkImmobilization: true, journalCode: "AC" },
  "ERWAN":            { account: "21810000", label: "AGENCEMENT AMENAGEMENT DIVERS", confidence: 0.85, checkImmobilization: true, journalCode: "AC" },
  "MCI":              { account: "61560000", label: "MAINTENANCE", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
  "DEMAISONS":        { account: "21810000", label: "AGENCEMENT AMENAGEMENT DIVERS", confidence: 0.85, checkImmobilization: true, journalCode: "AC" },
  "MIX COMMUNICATION":{ account: "21810000", label: "AGENCEMENT AMENAGEMENT DIVERS", confidence: 0.85, checkImmobilization: true, journalCode: "AC" },
  "ENEDIS":           { account: "21810000", label: "AGENCEMENT AMENAGEMENT DIVERS", confidence: 0.80, checkImmobilization: true, journalCode: "AC" },

  // Grande distribution & fournitures
  "LEROY MERLIN":     { account: "60631000", label: "PETITS MATERIELS ET PRODUITS D'ENTRETIEN", confidence: 0.80, checkImmobilization: true, journalCode: "AC" },
  "BRICO DEPOT":      { account: "60631000", label: "PETITS MATERIELS ET PRODUITS D'ENTRETIEN", confidence: 0.80, checkImmobilization: true, journalCode: "AC" },
  "CASTORAMA":        { account: "60631000", label: "PETITS MATERIELS ET PRODUITS D'ENTRETIEN", confidence: 0.80, checkImmobilization: true, journalCode: "AC" },
  "SUPER U":          { account: "60631000", label: "PETITS MATERIELS ET PRODUITS D'ENTRETIEN", confidence: 0.85, checkImmobilization: false, journalCode: "AC" },
  "NOZ":              { account: "60631000", label: "PETITS MATERIELS ET PRODUITS D'ENTRETIEN", confidence: 0.85, checkImmobilization: false, journalCode: "AC" },

  // Matériel informatique (vérifier immobilisation si > 500€ HT)
  "AMAZON":           { account: "60631000", label: "PETITS MATERIELS ET PRODUITS D'ENTRETIEN", confidence: 0.75, checkImmobilization: true, journalCode: "AC" },
  "ELECTRO DEPOT":    { account: "21830000", label: "MATERIEL BUREAU ET INFO.", confidence: 0.85, checkImmobilization: true, journalCode: "AC" },
  "ENDORTECH":        { account: "21830000", label: "MATERIEL BUREAU ET INFO.", confidence: 0.92, checkImmobilization: true, journalCode: "AC" },

  // Locations
  "RESOTAINER":       { account: "61320000", label: "LOCATION LOCAL", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
  "STE DU COLISEE":   { account: "61320000", label: "LOCATION LOCAL", confidence: 0.99, checkImmobilization: false, journalCode: "AC" },
  "COLISEE":          { account: "61320000", label: "LOCATION LOCAL", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },

  // Assurance
  "AXA":              { account: "61600000", label: "ASSURANCES", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },
  "ALLIANZ":          { account: "61600000", label: "ASSURANCES", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },
  "MAIF":             { account: "61600000", label: "ASSURANCES", confidence: 0.95, checkImmobilization: false, journalCode: "AC" },

  // Google / Meta (publicité intracom)
  "GOOGLE":           { account: "62310100", label: "PUBLICITE INTRACOM", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
  "META":             { account: "62310100", label: "PUBLICITE INTRACOM", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
  "FACEBOOK":         { account: "62310100", label: "PUBLICITE INTRACOM", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },

  // Carburant
  "TOTAL":            { account: "60610000", label: "CARBURANT", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
  "TOTALENERGIES":    { account: "60610000", label: "CARBURANT", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
  "BP":               { account: "60610000", label: "CARBURANT", confidence: 0.90, checkImmobilization: false, journalCode: "AC" },
}

// Seuil d'immobilisation
export const IMMOBILIZATION_THRESHOLD_HT = 500 // €

// Taux d'amortissement par compte
export const AMORTIZATION_RATES: Record<string, number> = {
  "21810000": 20.00,    // Agencements
  "21830000": 33.33,    // Matériel info
  "21540000": 33.33,    // Matériel industriel
  "20500000": 33.33,    // Logiciels/licences
}

/**
 * Recherche un fournisseur connu par nom.
 * Retourne le mapping si trouvé, null sinon.
 */
export function findKnownSupplier(supplierName: string): (KnownSupplier & { matchedKey: string }) | null {
  const normalized = supplierName.toUpperCase().trim()

  // Exact match first
  if (KNOWN_SUPPLIERS[normalized]) {
    return { ...KNOWN_SUPPLIERS[normalized], matchedKey: normalized }
  }

  // Partial match — check if supplier name contains a known key
  for (const [key, value] of Object.entries(KNOWN_SUPPLIERS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { ...value, matchedKey: key }
    }
  }

  return null
}
