import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedTransaction {
  date: string // YYYY-MM-DD
  value_date: string | null
  label: string
  reference: string | null
  debit: number | null
  credit: number | null
}

/**
 * Parse a French-formatted amount string to a number.
 * Handles: "1 234,56" | "1234.56" | "-1234,56" | "(1234.56)"
 */
function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return raw
  let s = String(raw).trim()
  if (s === '') return null
  // Remove spaces (thousand separator)
  s = s.replace(/\s/g, '')
  // Handle parentheses as negative
  if (s.startsWith('(') && s.endsWith(')')) {
    s = '-' + s.slice(1, -1)
  }
  // French format: comma = decimal
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.')
  } else if (s.includes(',') && s.includes('.')) {
    // 1.234,56 format
    s = s.replace(/\./g, '').replace(',', '.')
  }
  // Remove currency symbols
  s = s.replace(/[€$£]/g, '').trim()
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

/**
 * Parse a French date (DD/MM/YYYY or DD-MM-YYYY) to YYYY-MM-DD
 */
function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10)
  // DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // Try parsing with Date
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10)
  return null
}

// Common French bank CSV column name patterns
const DATE_COLS = ['date', 'date operation', 'date op', 'date comptable', 'date opération']
const VALUE_DATE_COLS = ['date valeur', 'date de valeur', 'val']
const LABEL_COLS = ['libelle', 'libellé', 'description', 'designation', 'désignation', 'intitulé', 'intitule', 'label']
const DEBIT_COLS = ['debit', 'débit', 'montant débit', 'sortie']
const CREDIT_COLS = ['credit', 'crédit', 'montant crédit', 'entree', 'entrée']
const AMOUNT_COLS = ['montant', 'amount', 'solde mouvement']
const REF_COLS = ['reference', 'référence', 'ref', 'num']

function findCol(headers: string[], patterns: string[]): number {
  const normalized = headers.map(h => h.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  for (const pat of patterns) {
    const normPat = pat.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const idx = normalized.findIndex(h => h === normPat || h.includes(normPat))
    if (idx >= 0) return idx
  }
  return -1
}

export function parseCSV(content: string): ParsedTransaction[] {
  // Try to detect if ISO-8859-1 encoded (common for French banks)
  const result = Papa.parse(content, {
    header: false,
    skipEmptyLines: true,
    delimiter: '', // auto-detect
  })

  if (!result.data || result.data.length < 2) return []

  const rows = result.data as string[][]
  // Find header row (first row with recognizable column names)
  let headerIdx = 0
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i].join(' ').toLowerCase()
    if (row.includes('date') && (row.includes('lib') || row.includes('desc') || row.includes('montant'))) {
      headerIdx = i
      break
    }
  }

  const headers = rows[headerIdx]
  const dateCol = findCol(headers, DATE_COLS)
  const valueDateCol = findCol(headers, VALUE_DATE_COLS)
  const labelCol = findCol(headers, LABEL_COLS)
  const debitCol = findCol(headers, DEBIT_COLS)
  const creditCol = findCol(headers, CREDIT_COLS)
  const amountCol = findCol(headers, AMOUNT_COLS)
  const refCol = findCol(headers, REF_COLS)

  if (dateCol < 0 || labelCol < 0) return []

  const transactions: ParsedTransaction[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length < 2) continue

    const date = parseDate(row[dateCol])
    if (!date) continue

    const label = (row[labelCol] || '').trim()
    if (!label) continue

    let debit: number | null = null
    let credit: number | null = null

    if (debitCol >= 0 && creditCol >= 0) {
      debit = parseAmount(row[debitCol])
      credit = parseAmount(row[creditCol])
      if (debit != null) debit = Math.abs(debit)
      if (credit != null) credit = Math.abs(credit)
    } else if (amountCol >= 0) {
      const amt = parseAmount(row[amountCol])
      if (amt != null) {
        if (amt < 0) debit = Math.abs(amt)
        else credit = amt
      }
    }

    if (debit == null && credit == null) continue

    transactions.push({
      date,
      value_date: valueDateCol >= 0 ? parseDate(row[valueDateCol]) : null,
      label,
      reference: refCol >= 0 ? (row[refCol] || '').trim() || null : null,
      debit,
      credit,
    })
  }

  return transactions
}

export function parseExcel(buffer: ArrayBuffer): ParsedTransaction[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_csv(sheet, { FS: ';' })
  return parseCSV(data)
}
