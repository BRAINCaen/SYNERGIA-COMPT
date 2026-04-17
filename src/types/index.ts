export type InvoiceStatus = 'pending' | 'processing' | 'classified' | 'validated' | 'exported' | 'error'
export type DocumentType = 'expense' | 'revenue'

export interface Invoice {
  id: string
  user_id: string
  file_name: string
  file_path: string
  file_type: string
  document_type: DocumentType
  supplier_name: string | null
  supplier_siret: string | null
  revenue_source: RevenueSource | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  currency: string
  status: InvoiceStatus
  match_locked?: boolean
  raw_extraction: RawExtraction | null
  created_at: string
  updated_at: string
  lines?: InvoiceLine[]
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  description: string
  quantity: number | null
  unit_price: number | null
  total_ht: number
  tva_rate: number | null
  tva_amount: number | null
  total_ttc: number | null
  pcg_code: string | null
  pcg_label: string | null
  confidence_score: number | null
  manually_corrected: boolean
  journal_code: string | null
  reasoning: string | null
  is_immobilization: boolean
  amortization_rate: number | null
  classification_method: 'known_supplier' | 'ai' | 'manual' | null
}

export interface PCGAccount {
  code: string
  label: string
  class: number
  category: string
  is_active: boolean
}

export interface Supplier {
  id: string
  name: string
  siret: string | null
  default_pcg_code: string | null
  auto_classify: boolean
  line_mappings: { description: string; pcg_code: string; pcg_label: string; journal_code: string }[]
  last_used_at: string
}

export interface AuditLog {
  id: string
  action: string
  invoice_id: string
  user_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  timestamp: string
}

export interface AICorrection {
  id: string
  supplier_name: string
  original_account: string
  corrected_account: string
  description_keywords: string
  amount_ht: number
  created_at: string
}

export interface ExportRecord {
  id: string
  user_id: string
  invoice_ids: string[]
  format: ExportFormat
  file_path: string
  created_at: string
}

export type ExportFormat = 'fec' | 'csv' | 'json' | 'pdf'

export interface RawExtraction {
  document_type?: 'expense' | 'revenue'
  revenue_source?: 'tpe_virtuel' | 'virement' | 'tpe_sur_place' | 'cheque' | 'ancv' | 'especes' | null
  supplier: {
    name: string
    address?: string
    siret?: string
    tva_intra?: string
    phone?: string
    email?: string
  }
  invoice: {
    number: string
    date: string
    due_date?: string
    payment_terms?: string
  }
  lines: ExtractedLine[]
  totals: {
    total_ht: number
    total_tva: number
    total_ttc: number
    tva_details?: { rate: number; base: number; amount: number }[]
  }
  raw_text?: string
}

export interface ExtractedLine {
  description: string
  quantity?: number
  unit_price?: number
  total_ht: number
  tva_rate?: number
  tva_amount?: number
  total_ttc?: number
}

export interface ClassificationResult {
  line_index: number
  pcg_code: string
  pcg_label: string
  confidence: number
  reasoning: string
  journal_code: string
  needs_clarification?: boolean
  question?: string
  is_immobilization?: boolean
  amortization_rate?: number | null
  classification_method?: 'known_supplier' | 'ai' | 'manual'
  requires_immobilization_check?: boolean
}

export interface ClarificationQuestion {
  line_index: number
  description: string
  total_ht: number
  question: string
  suggested_codes: { code: string; label: string; confidence: number }[]
}

export interface ExtractionResponse {
  success: boolean
  data?: RawExtraction
  error?: string
}

export interface ClassificationResponse {
  success: boolean
  classifications?: ClassificationResult[]
  error?: string
}

// ── Bank Statements ──────────────────────────────

export type BankStatementFormat = 'csv' | 'xlsx' | 'pdf'

export interface BankStatement {
  id: string
  user_id: string
  file_name: string
  file_path: string
  format: BankStatementFormat
  bank_name: string | null
  account_number: string | null
  period_month: string // YYYY-MM
  transaction_count: number
  total_debits: number
  total_credits: number
  status: 'pending' | 'parsed' | 'reconciling' | 'completed' | 'error'
  error_message: string | null
  created_at: string
  updated_at: string
}

export type TransactionType = 'debit' | 'credit'
export type TransactionMatchStatus = 'matched' | 'unmatched' | 'missing_invoice' | 'ignored'

export interface BankTransaction {
  id: string
  statement_id: string
  user_id: string
  date: string
  value_date: string | null
  label: string
  reference: string | null
  amount: number
  type: TransactionType
  match_status: TransactionMatchStatus
  matched_invoice_id: string | null
  matched_revenue_id: string | null
  match_confidence: number | null
  match_method: 'auto' | 'manual' | null
  notes: string | null
  created_at: string
}

// ── Revenue / Encaissements & Subventions ────────

export type RevenueSource = 'tpe_virtuel' | 'virement' | 'tpe_sur_place' | 'cheque' | 'ancv' | 'especes' | 'billetterie' | 'prestation' | 'subvention'
export type RevenueDocumentType = 'encaissement' | 'subvention'
export type RevenueStatus = 'draft' | 'validated' | 'exported'

export interface RevenueEntry {
  id: string
  user_id: string
  date: string
  document_type: RevenueDocumentType
  source: RevenueSource
  entity_name: string | null
  description: string
  reference: string | null
  amount_ht: number
  tva_rate: number
  tva_amount: number
  amount_ttc: number
  items: { description: string; amount: number }[]
  pcg_code: string
  pcg_label: string
  journal_code: string
  file_path: string | null
  file_name: string | null
  matched_transaction_ids: string[]
  status: RevenueStatus
  created_at: string
  updated_at: string
}

// ── Personnel / Payroll ─────────────────────────────

export interface Employee {
  id: string
  user_id: string
  name: string
  role: string | null
  monthly_gross: number | null
  is_active: boolean
  created_at: string
}

export interface Payslip {
  id: string
  user_id: string
  employee_id: string
  employee_name: string
  month: string // YYYY-MM
  gross_salary: number
  net_salary: number
  employer_charges: number
  advance_amount: number // acompte
  remaining_salary: number // solde = net - advance
  file_path: string | null
  file_name: string | null
  status: 'draft' | 'validated'
  matched_transaction_ids: string[] // bank transaction IDs matched to this payslip
  created_at: string
  updated_at: string
}

// ── Monthly Alerts ───────────────────────────────

export interface MonthlyAlert {
  id: string
  user_id: string
  month: string // YYYY-MM
  unmatched_debits: number
  unmatched_credits: number
  missing_invoices: number
  total_transactions: number
  reconciliation_rate: number // 0-100
  is_dismissed: boolean
  created_at: string
  updated_at: string
}
