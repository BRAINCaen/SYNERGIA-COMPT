import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'
// Audit logs removed from export to avoid timeout on large batches

interface InvoiceData {
  id: string
  supplier_name: string | null
  supplier_siret: string | null
  invoice_number: string | null
  invoice_date: string | null
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  currency: string
  file_name: string
}

interface LineData {
  description: string
  pcg_code: string | null
  pcg_label: string | null
  journal_code: string | null
  total_ht: number
  tva_rate: number | null
  tva_amount: number | null
  total_ttc: number | null
  confidence_score: number | null
  manually_corrected: boolean
}

interface InvoiceWithLines extends InvoiceData {
  lines: LineData[]
}

interface RevenueData {
  id: string
  date: string
  source: string
  entity_name: string | null
  description: string
  reference: string | null
  amount_ht: number
  tva_rate: number
  tva_amount: number
  amount_ttc: number
  pcg_code: string
  pcg_label: string
  journal_code: string
}

interface PayslipData {
  id: string
  employee_name: string
  month: string
  gross_salary: number
  net_salary: number
  employer_charges: number
  advance_amount: number
  remaining_salary: number
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const body = await request.json()
    const {
      invoice_ids = [],
      revenue_ids = [],
      payslip_ids = [],
      format,
      month,
    } = body as {
      invoice_ids: string[]
      revenue_ids: string[]
      payslip_ids: string[]
      format: 'fec' | 'csv' | 'json'
      month?: string
    }

    const totalCount = invoice_ids.length + revenue_ids.length + payslip_ids.length
    if (totalCount === 0) {
      return NextResponse.json({ error: 'Aucun document selectionne' }, { status: 400 })
    }

    // Fetch all documents in parallel using getAll (batch read)
    const invoiceRefs = invoice_ids.map((id) => adminDb.collection('invoices').doc(id))
    const revenueRefs = revenue_ids.map((id) => adminDb.collection('revenueEntries').doc(id))
    const payslipRefs = payslip_ids.map((id) => adminDb.collection('payslips').doc(id))

    // Batch fetch all docs at once (single round-trip per collection)
    const [invoiceDocs, revenueDocs, payslipDocs] = await Promise.all([
      invoiceRefs.length > 0 ? adminDb.getAll(...invoiceRefs) : Promise.resolve([]),
      revenueRefs.length > 0 ? adminDb.getAll(...revenueRefs) : Promise.resolve([]),
      payslipRefs.length > 0 ? adminDb.getAll(...payslipRefs) : Promise.resolve([]),
    ])

    // Fetch all invoice lines in one query (by user, then filter in JS)
    const invoices: InvoiceWithLines[] = []
    if (invoice_ids.length > 0) {
      // Get all lines for these invoices in parallel batches of 30 (Firestore 'in' limit)
      const linesByInvoice: Record<string, LineData[]> = {}
      const idChunks: string[][] = []
      for (let i = 0; i < invoice_ids.length; i += 30) {
        idChunks.push(invoice_ids.slice(i, i + 30))
      }
      const lineResults = await Promise.all(
        idChunks.map((chunk) =>
          adminDb.collection('invoice_lines').where('invoice_id', 'in', chunk).get()
        )
      )
      for (const snap of lineResults) {
        for (const doc of snap.docs) {
          const data = doc.data() as LineData & { invoice_id: string }
          if (!linesByInvoice[data.invoice_id]) linesByInvoice[data.invoice_id] = []
          linesByInvoice[data.invoice_id].push(data)
        }
      }

      for (const doc of invoiceDocs) {
        if (!doc.exists) continue
        const invoiceData = doc.data() as InvoiceData
        invoices.push({
          ...invoiceData,
          id: doc.id,
          lines: linesByInvoice[doc.id] || [],
        })
      }
    }

    // Revenue entries
    const revenueEntries: RevenueData[] = []
    for (const doc of revenueDocs) {
      if (!doc.exists) continue
      revenueEntries.push({ ...(doc.data() as RevenueData), id: doc.id })
    }

    // Payslips
    const payslipEntries: PayslipData[] = []
    for (const doc of payslipDocs) {
      if (!doc.exists) continue
      payslipEntries.push({ ...(doc.data() as PayslipData), id: doc.id })
    }

    if (invoices.length + revenueEntries.length + payslipEntries.length === 0) {
      return NextResponse.json({ error: 'Aucun document trouve' }, { status: 404 })
    }

    let content: string
    let contentType: string
    let fileName: string
    const dateStr = month || new Date().toISOString().slice(0, 7)

    switch (format) {
      case 'fec':
        content = generateFEC(invoices, revenueEntries, payslipEntries)
        contentType = 'text/plain; charset=utf-8'
        fileName = `FEC_${dateStr}.txt`
        break
      case 'csv':
        content = generateCSV(invoices, revenueEntries, payslipEntries)
        contentType = 'text/csv; charset=utf-8'
        fileName = `export_${dateStr}.csv`
        break
      case 'json':
        content = generateJSON(invoices, revenueEntries, payslipEntries)
        contentType = 'application/json; charset=utf-8'
        fileName = `export_${dateStr}.json`
        break
      default:
        return NextResponse.json({ error: 'Format non supporte' }, { status: 400 })
    }

    // Update statuses in batch (non-blocking after response)
    // We do this BEFORE returning to ensure at least the batch write goes through
    const now = new Date().toISOString()
    const allUpdates: Promise<unknown>[] = []

    // Batch update invoices + revenue status (max 500 per batch)
    const statusBatch = adminDb.batch()
    for (const id of invoice_ids) {
      statusBatch.update(adminDb.collection('invoices').doc(id), { status: 'exported', updated_at: now })
    }
    for (const id of revenue_ids) {
      statusBatch.update(adminDb.collection('revenueEntries').doc(id), { status: 'exported', updated_at: now })
    }
    allUpdates.push(statusBatch.commit())

    // Save export record
    allUpdates.push(adminDb.collection('export_history').add({
      user_id: decoded.uid,
      invoice_ids,
      revenue_ids,
      payslip_ids,
      format,
      month: dateStr,
      created_at: now,
    }))

    // Run updates in parallel but don't block the response
    await Promise.all(allUpdates)

    return new NextResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── FEC Generator ──────────────────────────────

function generateFEC(invoices: InvoiceWithLines[], revenue: RevenueData[], payslips: PayslipData[]): string {
  const headers = [
    'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
    'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
    'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
    'EcritutureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
  ].join('|')

  const rows: string[] = [headers]
  let ecritureNum = 1

  // ─ Invoices (Achats) ─
  for (const invoice of invoices) {
    const invoiceDate = invoice.invoice_date
      ? new Date(invoice.invoice_date).toISOString().slice(0, 10).replace(/-/g, '')
      : ''

    for (const line of invoice.lines) {
      if (!line.pcg_code) continue

      rows.push([
        line.journal_code || 'AC', getJournalLabel(line.journal_code || 'AC'),
        String(ecritureNum).padStart(6, '0'), invoiceDate,
        line.pcg_code, line.pcg_label || '', '', '',
        invoice.invoice_number || '', invoiceDate,
        line.description, fmtAmt(line.total_ht), '0,00',
        '', '', invoiceDate, '', invoice.currency || 'EUR',
      ].join('|'))

      if (line.tva_amount && line.tva_amount > 0) {
        rows.push([
          line.journal_code || 'AC', getJournalLabel(line.journal_code || 'AC'),
          String(ecritureNum).padStart(6, '0'), invoiceDate,
          getTvaAccount(line.tva_rate), `TVA deductible ${line.tva_rate}%`, '', '',
          invoice.invoice_number || '', invoiceDate,
          `TVA ${line.tva_rate}% - ${line.description}`,
          fmtAmt(line.tva_amount), '0,00',
          '', '', invoiceDate, '', invoice.currency || 'EUR',
        ].join('|'))
      }
    }

    if (invoice.total_ttc) {
      rows.push([
        'AC', 'Achats', String(ecritureNum).padStart(6, '0'), invoiceDate,
        '401000', 'Fournisseurs', invoice.supplier_siret || '', invoice.supplier_name || '',
        invoice.invoice_number || '', invoiceDate,
        `${invoice.supplier_name || 'Fournisseur'} - Facture ${invoice.invoice_number || ''}`,
        '0,00', fmtAmt(invoice.total_ttc),
        '', '', invoiceDate, '', invoice.currency || 'EUR',
      ].join('|'))
    }

    ecritureNum++
  }

  // ─ Revenue (Encaissements) ─
  for (const rev of revenue) {
    const revDate = rev.date
      ? new Date(rev.date).toISOString().slice(0, 10).replace(/-/g, '')
      : ''

    // Debit: compte de tresorerie (banque)
    rows.push([
      rev.journal_code || 'BQ', getJournalLabel(rev.journal_code || 'BQ'),
      String(ecritureNum).padStart(6, '0'), revDate,
      '512000', 'Banque', '', '',
      rev.reference || '', revDate,
      `${rev.entity_name || rev.source} - ${rev.description}`,
      fmtAmt(rev.amount_ttc), '0,00',
      '', '', revDate, '', 'EUR',
    ].join('|'))

    // Credit: compte de produit
    rows.push([
      rev.journal_code || 'BQ', getJournalLabel(rev.journal_code || 'BQ'),
      String(ecritureNum).padStart(6, '0'), revDate,
      rev.pcg_code, rev.pcg_label || '', '', '',
      rev.reference || '', revDate,
      `${rev.entity_name || rev.source} - ${rev.description}`,
      '0,00', fmtAmt(rev.amount_ht),
      '', '', revDate, '', 'EUR',
    ].join('|'))

    // TVA collectee
    if (rev.tva_amount && rev.tva_amount > 0) {
      rows.push([
        rev.journal_code || 'BQ', getJournalLabel(rev.journal_code || 'BQ'),
        String(ecritureNum).padStart(6, '0'), revDate,
        getTvaCollectedAccount(rev.tva_rate), `TVA collectee ${rev.tva_rate}%`, '', '',
        rev.reference || '', revDate,
        `TVA collectee ${rev.tva_rate}% - ${rev.description}`,
        '0,00', fmtAmt(rev.tva_amount),
        '', '', revDate, '', 'EUR',
      ].join('|'))
    }

    ecritureNum++
  }

  // ─ Payslips (Personnel) ─
  for (const pay of payslips) {
    const payDate = pay.month
      ? `${pay.month.replace('-', '')}01`
      : ''

    // Charge: salaire brut
    rows.push([
      'OD', 'Operations diverses',
      String(ecritureNum).padStart(6, '0'), payDate,
      '641000', 'Remunerations du personnel', '', '',
      '', payDate,
      `Salaire ${pay.employee_name} - ${pay.month}`,
      fmtAmt(pay.gross_salary), '0,00',
      '', '', payDate, '', 'EUR',
    ].join('|'))

    // Charge: cotisations patronales
    if (pay.employer_charges > 0) {
      rows.push([
        'OD', 'Operations diverses',
        String(ecritureNum).padStart(6, '0'), payDate,
        '645000', 'Charges de securite sociale', '', '',
        '', payDate,
        `Cotisations patronales ${pay.employee_name} - ${pay.month}`,
        fmtAmt(pay.employer_charges), '0,00',
        '', '', payDate, '', 'EUR',
      ].join('|'))
    }

    // Credit: net a payer (personnel)
    rows.push([
      'OD', 'Operations diverses',
      String(ecritureNum).padStart(6, '0'), payDate,
      '421000', 'Personnel - Remunerations dues', '', '',
      '', payDate,
      `Net a payer ${pay.employee_name} - ${pay.month}`,
      '0,00', fmtAmt(pay.net_salary),
      '', '', payDate, '', 'EUR',
    ].join('|'))

    // Credit: organismes sociaux (cotisations)
    if (pay.employer_charges > 0) {
      rows.push([
        'OD', 'Operations diverses',
        String(ecritureNum).padStart(6, '0'), payDate,
        '431000', 'Securite sociale', '', '',
        '', payDate,
        `Cotisations sociales ${pay.employee_name} - ${pay.month}`,
        '0,00', fmtAmt(pay.employer_charges),
        '', '', payDate, '', 'EUR',
      ].join('|'))
    }

    ecritureNum++
  }

  return rows.join('\r\n')
}

// ── CSV Generator ──────────────────────────────

function generateCSV(invoices: InvoiceWithLines[], revenue: RevenueData[], payslips: PayslipData[]): string {
  const headers = [
    'Type', 'Date', 'N° piece', 'Tiers', 'Description',
    'Compte PCG', 'Libelle compte', 'Journal', 'Montant HT', 'Taux TVA',
    'Montant TVA', 'Montant TTC',
  ].join(';')

  const rows: string[] = [headers]

  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      rows.push([
        'Facture', invoice.invoice_date || '',
        csvEscape(invoice.invoice_number || ''),
        csvEscape(invoice.supplier_name || ''),
        csvEscape(line.description), line.pcg_code || '',
        csvEscape(line.pcg_label || ''), line.journal_code || '',
        fmtAmt(line.total_ht), line.tva_rate ? `${line.tva_rate}%` : '',
        fmtAmt(line.tva_amount), fmtAmt(line.total_ttc),
      ].join(';'))
    }
  }

  for (const rev of revenue) {
    rows.push([
      'Encaissement', rev.date || '',
      csvEscape(rev.reference || ''),
      csvEscape(rev.entity_name || ''),
      csvEscape(rev.description), rev.pcg_code || '',
      csvEscape(rev.pcg_label || ''), rev.journal_code || '',
      fmtAmt(rev.amount_ht), rev.tva_rate ? `${rev.tva_rate}%` : '',
      fmtAmt(rev.tva_amount), fmtAmt(rev.amount_ttc),
    ].join(';'))
  }

  for (const pay of payslips) {
    rows.push([
      'Bulletin', `${pay.month}-01`,
      '', csvEscape(pay.employee_name),
      `Salaire ${pay.month}`, '641000',
      'Remunerations du personnel', 'OD',
      fmtAmt(pay.gross_salary), '',
      '', fmtAmt(pay.net_salary),
    ].join(';'))
  }

  return '\uFEFF' + rows.join('\r\n')
}

// ── JSON Generator ──────────────────────────────

function generateJSON(invoices: InvoiceWithLines[], revenue: RevenueData[], payslips: PayslipData[]): string {
  const exportData = {
    exported_at: new Date().toISOString(),
    invoices: invoices.map((inv) => ({
      type: 'facture',
      number: inv.invoice_number,
      date: inv.invoice_date,
      supplier: inv.supplier_name,
      siret: inv.supplier_siret,
      total_ht: inv.total_ht,
      total_tva: inv.total_tva,
      total_ttc: inv.total_ttc,
      lines: inv.lines.map((line) => ({
        description: line.description,
        pcg_code: line.pcg_code,
        pcg_label: line.pcg_label,
        journal_code: line.journal_code,
        total_ht: line.total_ht,
        tva_rate: line.tva_rate,
        tva_amount: line.tva_amount,
        total_ttc: line.total_ttc,
      })),
    })),
    encaissements: revenue.map((rev) => ({
      type: 'encaissement',
      date: rev.date,
      source: rev.source,
      entity: rev.entity_name,
      description: rev.description,
      reference: rev.reference,
      pcg_code: rev.pcg_code,
      amount_ht: rev.amount_ht,
      tva_rate: rev.tva_rate,
      tva_amount: rev.tva_amount,
      amount_ttc: rev.amount_ttc,
    })),
    payslips: payslips.map((pay) => ({
      type: 'bulletin',
      employee: pay.employee_name,
      month: pay.month,
      gross_salary: pay.gross_salary,
      net_salary: pay.net_salary,
      employer_charges: pay.employer_charges,
    })),
  }
  return JSON.stringify(exportData, null, 2)
}

// ── Helpers ──────────────────────────────

function fmtAmt(amount: number | null | undefined): string {
  if (amount == null) return '0,00'
  return amount.toFixed(2).replace('.', ',')
}

function csvEscape(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function getJournalLabel(code: string): string {
  const journals: Record<string, string> = {
    AC: 'Achats', VE: 'Ventes', BQ: 'Banque', OD: 'Operations diverses',
  }
  return journals[code] || code
}

function getTvaAccount(rate: number | null | undefined): string {
  if (!rate) return '445660'
  if (rate === 20) return '445662'
  if (rate === 10) return '445663'
  if (rate === 5.5) return '445664'
  if (rate === 2.1) return '445665'
  return '445660'
}

function getTvaCollectedAccount(rate: number | null | undefined): string {
  if (!rate) return '445710'
  if (rate === 20) return '445712'
  if (rate === 10) return '445713'
  if (rate === 5.5) return '445714'
  if (rate === 2.1) return '445715'
  return '445710'
}
