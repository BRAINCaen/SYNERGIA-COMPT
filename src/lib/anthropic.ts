import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export default anthropic

// Sonnet 4.6 — most reliable for PDF extraction (replaces retired claude-sonnet-4-20250514)
export const EXTRACTION_MODEL = 'claude-sonnet-4-6'
// Sonnet 4.6 for reasoning (classification, PCG suggestions)
export const CLASSIFICATION_MODEL = 'claude-sonnet-4-6'
// Haiku 4.5 for fast bank statement parsing only
export const FAST_MODEL = 'claude-haiku-4-5-20251001'
export const MAX_TOKENS = 8192
