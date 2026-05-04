import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export default anthropic

// Sonnet 4 — most reliable for PDF extraction (fewer empty results than Haiku)
export const EXTRACTION_MODEL = 'claude-sonnet-4-20250514'
// Sonnet for reasoning (classification, PCG suggestions)
export const CLASSIFICATION_MODEL = 'claude-sonnet-4-20250514'
// Haiku for fast bank statement parsing only
export const FAST_MODEL = 'claude-haiku-4-5-20251001'
export const MAX_TOKENS = 8192
