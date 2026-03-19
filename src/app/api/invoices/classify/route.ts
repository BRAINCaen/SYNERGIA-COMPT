import { NextRequest, NextResponse } from 'next/server'
import anthropic, { CLASSIFICATION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import type { ClassificationResult, ExtractedLine } from '@/types'
import { BOEHME_PCG, IMMOBILIZATION_THRESHOLD_HT } from '@/data/boehme-pcg'
import { findKnownSupplier, AMORTIZATION_RATES } from '@/data/boehme-suppliers'
import { getCorrectionsForSupplier } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// Build the BOEHME PCG accounts JSON for the prompt
const BOEHME_PCG_JSON = JSON.stringify(
  BOEHME_PCG.filter(a => a.category === 'charge' || a.category === 'immobilisation')
    .map(a => ({ code: a.code, label: a.label, isImmobilization: a.isImmobilization })),
  null,
  2
)

// Revenue PCG accounts for BOEHME
const REVENUE_PCG = [
  { code: '70610000', label: 'VENTES ESCAPE GAME' },
  { code: '70620000', label: 'VENTES QUIZ GAME' },
  { code: '70630000', label: 'VENTES TEAM BUILDING' },
  { code: '70640000', label: 'VENTES BONS CADEAUX' },
  { code: '70710000', label: 'VENTES MARCHANDISES' },
  { code: '70800000', label: 'PRODUITS ANNEXES' },
  { code: '74100000', label: 'SUBVENTIONS D\'EXPLOITATION' },
  { code: '75800000', label: 'PRODUITS DIVERS DE GESTION' },
  { code: '76200000', label: 'PRODUITS FINANCIERS' },
  { code: '77100000', label: 'PRODUITS EXCEPTIONNELS' },
]
const REVENUE_PCG_JSON = JSON.stringify(REVENUE_PCG, null, 2)

function buildClassificationPrompt(
  lines: ExtractedLine[],
  supplierName: string,
  supplierDefaultCode?: string | null,
  pastCorrections?: { original_account: string; corrected_account: string; description_keywords: string }[],
): string {
  const linesText = lines
    .map(
      (line, i) =>
        `Ligne ${i + 1}: "${line.description}" - HT: ${line.total_ht}€${line.tva_rate ? ` - TVA: ${line.tva_rate}%` : ''}`
    )
    .join('\n')

  const supplierHint = supplierDefaultCode
    ? `\nNote: Ce fournisseur (${supplierName}) est habituellement classé en compte ${supplierDefaultCode}. Utilise ce code par défaut sauf si la nature de la ligne indique clairement un autre compte.`
    : ''

  const correctionsHint = pastCorrections && pastCorrections.length > 0
    ? `\n\nCORRECTIONS PASSÉES pour ce fournisseur (l'utilisateur a corrigé l'IA) :\n${pastCorrections.map(c => `- "${c.description_keywords}" : ${c.original_account} → CORRIGÉ en ${c.corrected_account}`).join('\n')}\nTiens compte de ces corrections pour ne pas refaire les mêmes erreurs.`
    : ''

  return `Tu es expert-comptable pour la SARL BOEHME (B.R.A.I.N. Escape Game, Mondeville 14).
SIRET : 82322711100023 | CA ~322 641€/an | Escape games + quiz room.

Facture du fournisseur "${supplierName}".${supplierHint}${correctionsHint}

PLAN COMPTABLE BOEHME (codes à 8 chiffres — utiliser UNIQUEMENT ces comptes) :
${BOEHME_PCG_JSON}

Classifie chaque ligne :
${linesText}

RÈGLES BOEHME IMPÉRATIVES :
1. IMMOBILISATION OBLIGATOIRE si montant HT ≥ 500€ ET durée vie > 1 an :
   - Travaux / agencements → 21810000
   - Matériel info / électronique → 21830000
   - Équipements jeux / industriel → 21540000
   - Logiciels / droits utilisation → 20500000
   En dessous de 500€ HT → charge directe

2. REDEVANCES BRAIN ESCAPE sont TOUJOURS comptes 651xx :
   - Jamais des honoraires (622xx) ni des locations (613xx)
   - Forfait fixe mensuel → 65110000
   - % proportionnel au CA → 65120000

3. COMMISSIONS PLATEFORMES → chacune a son propre compte 627xx

4. SOUS-TRAITANCE animateur externe → 60401000

5. ACHATS UE / INTRACOM → comptes avec suffixe 100 (ex: 60640100, 62310100)

6. Abonnements SaaS (Dropbox, OpenAI, Adobe, Canva, CapCut) → 60640000

Pour chaque ligne, détermine :
1. Le code PCG 8 chiffres le plus précis
2. Le libellé du compte
3. Un score de confiance entre 0 et 1
4. Le code journal (AC=Achats, VE=Ventes, BQ=Banque, OD=Opérations diverses)
5. Un bref raisonnement en français
6. Si c'est une immobilisation : "is_immobilization": true et "amortization_rate"
7. Si ta confiance est < 0.7, ajoute "needs_clarification": true avec question et answer_choices

Exemples de questions avec choix :
- "À quoi servent ces cadenas dans votre entreprise ?"
  answer_choices: [
    {"label": "Accessoires pour les escape games", "pcg_code": "60631000", "pcg_label": "PETITS MATERIELS ET PRODUITS D'ENTRETIEN"},
    {"label": "Sécurité du bâtiment", "pcg_code": "61560000", "pcg_label": "MAINTENANCE"},
    {"label": "Revente aux clients", "pcg_code": "60631000", "pcg_label": "PETITS MATERIELS"}
  ]

Réponds UNIQUEMENT avec le JSON :
[
  {
    "line_index": 0,
    "pcg_code": "60631000",
    "pcg_label": "PETITS MATERIELS ET PRODUITS D'ENTRETIEN",
    "confidence": 0.95,
    "reasoning": "string",
    "journal_code": "AC",
    "is_immobilization": false,
    "amortization_rate": null,
    "needs_clarification": false,
    "question": null,
    "answer_choices": null
  }
]

Quand needs_clarification est true, answer_choices DOIT être un tableau de 2-3 choix :
"answer_choices": [
  {"label": "Pour les escape games", "pcg_code": "60631000", "pcg_label": "PETITS MATERIELS"},
  {"label": "Pour l'administration", "pcg_code": "60640000", "pcg_label": "FOURNITURES DE BUREAU"}
]`
}

function buildRevenueClassificationPrompt(
  lines: ExtractedLine[],
  entityName: string,
  revenueSource: string | null,
): string {
  const linesText = lines
    .map(
      (line, i) =>
        `Ligne ${i + 1}: "${line.description}" - HT: ${line.total_ht}€${line.tva_rate ? ` - TVA: ${line.tva_rate}%` : ''}`
    )
    .join('\n')

  const sourceHint = revenueSource ? `\nSource de paiement : ${revenueSource}` : ''

  return `Tu es expert-comptable pour la SARL BOEHME (B.R.A.I.N. Escape Game, Mondeville 14).
SIRET : 82322711100023 | Activité : Escape games + quiz room + team building.

Ceci est un document de RECETTE (vente/encaissement). Client/émetteur : "${entityName}".${sourceHint}

PLAN COMPTABLE RECETTES BOEHME (codes à 8 chiffres) :
${REVENUE_PCG_JSON}

Classifie chaque ligne de recette :
${linesText}

RÈGLES DE CLASSIFICATION RECETTES :
1. Escape game (sessions, réservations, parties) → 70610000
2. Quiz game / quiz room → 70620000
3. Team building / événements entreprise → 70630000
4. Bons cadeaux / cartes cadeaux / coffrets → 70640000
5. Ventes de marchandises (goodies, boissons, snacks) → 70710000
6. Produits annexes (location salle, privatisation) → 70800000
7. Subventions → 74100000
8. Remboursements / avoirs fournisseurs → 77100000
9. Journal : toujours "VE" (Ventes) pour les recettes

Réponds UNIQUEMENT avec le JSON :
[
  {
    "line_index": 0,
    "pcg_code": "70610000",
    "pcg_label": "VENTES ESCAPE GAME",
    "confidence": 0.95,
    "reasoning": "string",
    "journal_code": "VE",
    "is_immobilization": false,
    "amortization_rate": null,
    "needs_clarification": false,
    "question": null,
    "answer_choices": null
  }
]`
}

function buildReclassifyPrompt(
  line: ExtractedLine,
  supplierName: string,
  question: string,
  userAnswer: string
): string {
  return `Tu es expert-comptable pour la SARL BOEHME (escape games + quiz room, Mondeville 14).

Fournisseur : "${supplierName}"
Ligne : "${line.description}" - HT: ${line.total_ht}€${line.tva_rate ? ` - TVA: ${line.tva_rate}%` : ''}

Question posée : "${question}"
Réponse de l'utilisateur : "${userAnswer}"

RÈGLE : si montant HT ≥ 500€ ET durée vie > 1 an → immobilisation (21xxx).

Classifie avec les codes BOEHME à 8 chiffres.

Réponds UNIQUEMENT avec le JSON :
{
  "pcg_code": "string",
  "pcg_label": "string",
  "confidence": 0.95,
  "reasoning": "string",
  "journal_code": "AC",
  "is_immobilization": false,
  "amortization_rate": null
}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { lines, supplier_name, supplier_default_code, action, line_index, question, user_answer, line } = body as {
      lines?: ExtractedLine[]
      supplier_name: string
      supplier_default_code?: string | null
      action?: 'classify' | 'reclassify'
      line_index?: number
      question?: string
      user_answer?: string
      line?: ExtractedLine
    }

    // Re-classification with user answer
    if (action === 'reclassify' && line && question && user_answer) {
      const prompt = buildReclassifyPrompt(line, supplier_name, question, user_answer)

      const response = await anthropic.messages.create({
        model: CLASSIFICATION_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      })

      const textBlock = response.content.find((block) => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json({ success: false, error: "Pas de réponse de l'IA" }, { status: 500 })
      }

      let jsonText = textBlock.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }

      const result = JSON.parse(jsonText)
      return NextResponse.json({
        success: true,
        classification: {
          line_index: line_index ?? 0,
          ...result,
          classification_method: 'ai',
          needs_clarification: false,
          question: null,
        },
      })
    }

    // Standard classification
    if (!lines || lines.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Aucune ligne à classifier' },
        { status: 400 }
      )
    }

    // ═══ CHECK: Is this a REVENUE document? ═══
    const { document_type, revenue_source } = body as { document_type?: string; revenue_source?: string | null }
    if (document_type === 'revenue') {
      // Revenue classification — use 70xxx accounts
      const prompt = buildRevenueClassificationPrompt(lines, supplier_name, revenue_source || null)
      const response = await anthropic.messages.create({
        model: CLASSIFICATION_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      })
      const textBlock = response.content.find((block) => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        return NextResponse.json({ success: false, error: "Pas de réponse de l'IA" }, { status: 500 })
      }
      let jsonText = textBlock.text.trim()
      if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      const classifications: ClassificationResult[] = JSON.parse(jsonText)
      classifications.forEach(c => { c.classification_method = 'ai' })
      return NextResponse.json({ success: true, classifications, questions: [] })
    }

    // ═══ PRIORITY 1: Auto-classify from saved supplier mappings ═══
    const { supplier_auto_classify, supplier_line_mappings } = body as {
      supplier_auto_classify?: boolean
      supplier_line_mappings?: { description: string; pcg_code: string; pcg_label: string; journal_code: string }[]
    }

    if (supplier_auto_classify && supplier_line_mappings && supplier_line_mappings.length > 0) {
      const autoClassifications: ClassificationResult[] = lines.map((line, i) => {
        const mapping = supplier_line_mappings.find(
          (m) => m.description.toLowerCase() === line.description.toLowerCase()
        ) || supplier_line_mappings[0]

        const isImmo = line.total_ht >= IMMOBILIZATION_THRESHOLD_HT &&
          BOEHME_PCG.find(a => a.code === mapping.pcg_code)?.isImmobilization

        return {
          line_index: i,
          pcg_code: mapping.pcg_code,
          pcg_label: mapping.pcg_label,
          confidence: 0.98,
          reasoning: `Classification automatique — fournisseur mémorisé (${supplier_name})`,
          journal_code: mapping.journal_code || 'AC',
          classification_method: 'known_supplier' as const,
          is_immobilization: !!isImmo,
          amortization_rate: isImmo ? (AMORTIZATION_RATES[mapping.pcg_code] || null) : null,
        }
      })

      return NextResponse.json({
        success: true,
        classifications: autoClassifications,
        questions: [],
        auto_classified: true,
      })
    }

    // ═══ PRIORITY 2: Check BOEHME known supplier mappings ═══
    const knownSupplier = findKnownSupplier(supplier_name)
    if (knownSupplier && knownSupplier.confidence >= 0.90 && !knownSupplier.checkImmobilization) {
      // High-confidence known supplier with no immobilization check needed
      const knownClassifications: ClassificationResult[] = lines.map((line, i) => ({
        line_index: i,
        pcg_code: knownSupplier.account,
        pcg_label: knownSupplier.label,
        confidence: knownSupplier.confidence,
        reasoning: `Fournisseur connu BOEHME : "${knownSupplier.matchedKey}" → ${knownSupplier.account} (${knownSupplier.label})${knownSupplier.notes ? `. Note : ${knownSupplier.notes}` : ''}`,
        journal_code: knownSupplier.journalCode,
        classification_method: 'known_supplier' as const,
        is_immobilization: false,
        amortization_rate: null,
      }))

      return NextResponse.json({
        success: true,
        classifications: knownClassifications,
        questions: [],
        known_supplier: true,
      })
    }

    // ═══ PRIORITY 2b: Known supplier with immobilization check ═══
    if (knownSupplier && knownSupplier.checkImmobilization) {
      const knownClassifications: ClassificationResult[] = lines.map((line, i) => {
        const needsImmo = line.total_ht >= IMMOBILIZATION_THRESHOLD_HT
        let account = knownSupplier.account
        let label = knownSupplier.label

        // If below threshold, use charge account instead of immobilization
        if (!needsImmo && account.startsWith('2')) {
          account = '60631000'
          label = 'PETITS MATERIELS ET PRODUITS D\'ENTRETIEN'
        }

        const isImmo = needsImmo && account.startsWith('2')
        return {
          line_index: i,
          pcg_code: account,
          pcg_label: label,
          confidence: knownSupplier.confidence,
          reasoning: needsImmo
            ? `Fournisseur connu "${knownSupplier.matchedKey}" — montant HT ${line.total_ht}€ ≥ 500€ → immobilisation ${account}`
            : `Fournisseur connu "${knownSupplier.matchedKey}" — montant HT ${line.total_ht}€ < 500€ → charge directe`,
          journal_code: knownSupplier.journalCode,
          classification_method: 'known_supplier' as const,
          is_immobilization: isImmo,
          amortization_rate: isImmo ? (AMORTIZATION_RATES[account] || null) : null,
          requires_immobilization_check: needsImmo,
        }
      })

      return NextResponse.json({
        success: true,
        classifications: knownClassifications,
        questions: [],
        known_supplier: true,
      })
    }

    // ═══ PRIORITY 3: AI classification with BOEHME rules ═══
    // Fetch past AI corrections for this supplier to improve results
    let pastCorrections: { original_account: string; corrected_account: string; description_keywords: string }[] = []
    try {
      const corrections = await getCorrectionsForSupplier(supplier_name)
      pastCorrections = corrections.map((c) => ({
        original_account: (c as Record<string, string>).original_account,
        corrected_account: (c as Record<string, string>).corrected_account,
        description_keywords: (c as Record<string, string>).description_keywords,
      }))
    } catch {
      // Ignore if corrections index not yet created
    }

    const prompt = buildClassificationPrompt(lines, supplier_name, supplier_default_code, pastCorrections)

    const response = await anthropic.messages.create({
      model: CLASSIFICATION_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { success: false, error: "Pas de réponse de l'IA" },
        { status: 500 }
      )
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const classifications: ClassificationResult[] = JSON.parse(jsonText)

    // Post-process: enforce immobilization threshold
    for (const c of classifications) {
      const lineData = lines[c.line_index]
      if (lineData && lineData.total_ht >= IMMOBILIZATION_THRESHOLD_HT) {
        const boehmeAccount = BOEHME_PCG.find(a => a.code === c.pcg_code)
        if (boehmeAccount?.isImmobilization) {
          c.is_immobilization = true
          c.amortization_rate = boehmeAccount.amortizationRate || AMORTIZATION_RATES[c.pcg_code] || null
        }
      }
      c.classification_method = 'ai'
    }

    // Separate confident from uncertain
    const needsClarification = classifications.filter(c => c.needs_clarification)
    const confident = classifications.filter(c => !c.needs_clarification)

    return NextResponse.json({
      success: true,
      classifications: confident,
      questions: needsClarification.map(c => ({
        line_index: c.line_index,
        description: lines[c.line_index]?.description || '',
        total_ht: lines[c.line_index]?.total_ht || 0,
        question: c.question || 'À quoi sert cet achat dans votre entreprise ?',
        answer_choices: (c as ClassificationResult & { answer_choices?: { label: string; pcg_code: string; pcg_label: string }[] }).answer_choices || [],
        current_best: { code: c.pcg_code, label: c.pcg_label, confidence: c.confidence },
      })),
    })
  } catch (error) {
    console.error('Classification error:', error)
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    return NextResponse.json(
      { success: false, error: `Erreur de classification : ${message}` },
      { status: 500 }
    )
  }
}
