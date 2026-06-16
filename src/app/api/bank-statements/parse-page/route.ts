import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

// Receives a single PDF page as base64 IMAGE, returns transactions
// Claude Vision sees the actual column layout → perfect debit/credit
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { image, pageNum, totalPages } = await request.json()
    if (!image) {
      return NextResponse.json({ transactions: [] })
    }

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: image },
          },
          {
            type: 'text',
            text: `Page ${pageNum}/${totalPages} d'un relevé bancaire Crédit Mutuel.

Extrais TOUTES les transactions visibles dans le tableau. Chaque transaction a :
- Date (colonne "Date")
- Date valeur (colonne "Date valeur")
- Libellé (colonne "Opération")
- Montant dans la colonne "Débit EUROS" OU "Crédit EUROS"

REGLE LIBELLE (TRES IMPORTANT) :
- Garde TOUT le texte utile : nom du commercant, type d'operation, beneficiaire/payeur
- Pour PAIEMENT CB XXXX : inclus IMPERATIVEMENT le nom du marchand qui suit (ex: "PAIEMENT CB 0604 UBER EATS", "PAIEMENT CB 0704 AMAZON FR")
- Pour VIR/PRLV : inclus le nom du tiers (ex: "VIR SEPA EDF FRANCE", "PRLV SEPA URSSAF")
- Pour REMCB : inclus le numero de bordereau ET le detail si visible
- IGNORE uniquement les codes techniques : ICS XXXXX, RUM XXXX, SCT XXXX, numeros de reference longs (>10 chiffres seuls), "Date valeur"
- Si le libelle s'etend sur 2-3 lignes dans le PDF, CONCATENE-les en gardant le nom du marchand
- Longueur max : 80 caracteres mais GARDE le marchand en priorite

REGLE ANTI-DOUBLON CRITIQUE (TRES IMPORTANT) :
- Une "transaction" = UNE LIGNE de mouvement dans le tableau. Pas une ligne typographique.
- Une operation PAIEMENT CB s'etend SOUVENT sur 2 lignes typographiques :
  * Ligne 1 : "PAIEMENT CB 2605 IE IRELAND"
  * Ligne 2 : "WWW.3MINUTESPIZZ CARD ABCD" (nom du marchand)
  * Ces 2 lignes typographiques = UNE SEULE transaction. Concatene les libelles.
  * Tu dois renvoyer UN SEUL objet JSON avec le libelle complet "PAIEMENT CB 2605 IE IRELAND WWW.3MINUTESPIZZ", PAS deux.
- Idem pour PRLV SEPA : la 1ere ligne contient PRLV SEPA, la 2eme contient le nom du beneficiaire. UNE seule transaction.
- Si tu vois 2 transactions avec EXACTEMENT la meme date ET le meme montant, l'une est probablement une partie de l'autre — verifie et n'en garde qu'UNE avec le libelle le plus complet.
- Ne renvoie JAMAIS deux transactions identiques en (date, montant, sens debit/credit)

REGLE ABSOLUE pour debit/credit : regarde VISUELLEMENT dans quelle colonne le montant se trouve
- Colonne "Débit EUROS" (avant-dernière colonne) = debit (mets le montant dans debit, credit=null)
- Colonne "Crédit EUROS" (dernière colonne) = credit (mets le montant dans credit, debit=null)
- Si tu hésites, applique ces règles métier strictes :
  * REMCB / REMISE CHEQUE / REMISE TICKETS = TOUJOURS credit
  * VIR PAYPAL PTE LTD = TOUJOURS credit (encaissements iZettle)
  * VIR EDENRED / CAP LOISIRS / LUDOBOX / FUNBOOKER / ASP / DRFIP = TOUJOURS credit
  * PRLV SEPA / PAIEMENT CB / FRAIS / COMCB / ECH PRET / INTERETS = TOUJOURS debit
  * VIR SEPA ACOMPTE / SALAIRE / LOYER / FORFAIT = TOUJOURS debit (versement vers tiers)
  * VIR BOEHME ALLAN = debit (gérant qui retire)
- Ne JAMAIS extraire la même ligne deux fois (une fois en debit, une fois en credit) : c'est forcément une erreur

Exclure : SOLDE CREDITEUR, SOLDE DEBITEUR, Total des mouvements, Report, en-têtes de colonne, pieds de page.

Réponds UNIQUEMENT en JSON :
[{"date":"DD/MM/YYYY","date_valeur":"DD/MM/YYYY","label":"libellé","debit":nombre_ou_null,"credit":nombre_ou_null}]
Montants en nombres avec point décimal (1234.56). Jamais de symbole €, jamais d'espace dans les nombres.`
          }
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ transactions: [] })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    try {
      const transactions = JSON.parse(jsonText)
      return NextResponse.json({ transactions })
    } catch {
      return NextResponse.json({ transactions: [] })
    }
  } catch (error) {
    console.error('Parse page error:', error)
    return NextResponse.json({ transactions: [] })
  }
}
