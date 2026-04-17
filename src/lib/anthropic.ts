import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export default anthropic

// Haiku 4.5 = fast + cheap, perfect for OCR/extraction (2-3x faster than Sonnet)
export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001'
// Sonnet for reasoning (classification, PCG suggestions)
export const CLASSIFICATION_MODEL = 'claude-sonnet-4-20250514'
export const FAST_MODEL = 'claude-haiku-4-5-20251001'
export const MAX_TOKENS = 8192
