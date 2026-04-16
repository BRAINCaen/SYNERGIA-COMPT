export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { CLASSIFICATION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import { BOEHME_PCG } from '@/data/boehme-pcg'

const ALL_PCG_JSON = JSON.stringify(
  BOEHME_PCG.map(a => ({ code: a.code, label: a.label, category: a.category })),
  null,
  2
)

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const body = await request.json()
    const { description, supplier_name, total_ht, current_pcg_code, document_type } = body as {
      description: string
      supplier_name?: string
      total_ht?: number
      current_pcg_code?: string
      document_type?: 'expense' | 'revenue'
    }

    if (!description) {
      return NextResponse.json({ error: 'Description requise' }, { status: 400 })
    }

    const prompt = `Tu es expert-comptable pour SARL BOEHME (B.R.A.I.N. Escape Game).

Contexte :
- Fournisseur : ${supplier_name || 'inconnu'}
- Description de la ligne : "${description}"
- Montant HT : ${total_ht || 'inconnu'} EUR
- Type : ${document_type || 'expense'}
- Classification actuelle : ${current_pcg_code || 'aucune'} (l'utilisateur n'est PAS d'accord)

L'utilisateur conteste la classification actuelle. Propose 4 alternatives les plus pertinentes parmi le plan comptable BOEHME ci-dessous.

Plan comptable BOEHME :
${ALL_PCG_JSON}

IMPORTANT :
- Propose des comptes DIFFERENTS de ${current_pcg_code || 'aucun'}
- Pour un repas/restaurant/livraison (Uber Eats, Deliveroo, 3minutespizza, raclette...) :
  * Repas PERSONNEL/STAFF/EQUIPE → 62560000 REPAS PERSONNEL
  * Repas CLIENT (reception, rdv business) → 62570000 RECEPTIONS
  * Repas en DEPLACEMENT → 62510000 VOYAGES ET DEPLACEMENTS
- Pour les abonnements/logiciels SaaS (ne PAS mettre en RH sauf si vraiment RH) :
  * HEBERGEMENT WEB / CLOUD (Netlify, Vercel, OVH, AWS, Dropbox, Ionos, Wix, nom de domaine, hosting) → 61350200 HEBERGEMENT WEB ET CLOUD
  * LOGICIEL RH (Skello, planning, pointeuse, logiciel paie) → 61350100 LOCATIONS LOGICIELS RH
  * LOGICIEL METIER (Funbooker, Smoobu, billetterie, reservation) → 61350300 LOCATIONS LOGICIELS METIER
  * LOGICIEL BUREAUTIQUE/IA (Office 365, Google Workspace, Adobe, ChatGPT, Claude, Canva) → 61350400 LOCATIONS LOGICIELS BUREAUTIQUE
- Classe par ordre de pertinence
- Explique pourquoi chaque compte est pertinent en 1 ligne

Reponds UNIQUEMENT avec ce JSON (pas de texte autour) :
{
  "alternatives": [
    {
      "pcg_code": "string (8 chiffres)",
      "pcg_label": "string",
      "journal_code": "AC | VE | BQ | OD",
      "confidence": 0.0-1.0,
      "reasoning": "string courte expliquant pourquoi ce compte"
    }
  ]
}`

    let response
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: CLASSIFICATION_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        })
        break
      } catch (e: unknown) {
        const err = e as { status?: number }
        if ((err?.status === 429 || err?.status === 529) && attempt < 1) {
          await new Promise(r => setTimeout(r, 5000))
          continue
        }
        throw e
      }
    }

    if (!response) throw new Error('Pas de reponse IA')

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de reponse textuelle' }, { status: 500 })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(jsonText)
    return NextResponse.json({ success: true, alternatives: parsed.alternatives || [] })
  } catch (error) {
    console.error('Suggest alternatives error:', error)
    const msg = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
