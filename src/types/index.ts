export type InvoiceStatus = 'pending' | 'processing' | 'classified' | 'validated' | 'exported' | 'error'

export interface Invoice {
  id: string
  user_id: string
  file_name: string
  file_path: string
  file_type: string
  supplier_name: string | null
  supplier_siret: string | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  currency: string
  status: InvoiceStatus
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
  last_used_at: string
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
