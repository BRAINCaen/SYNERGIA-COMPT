import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export default anthropic

export const EXTRACTION_MODEL = 'claude-sonnet-4-20250514'
export const CLASSIFICATION_MODEL = 'claude-sonnet-4-20250514'
export const FAST_MODEL = 'claude-haiku-4-5-20251001' // For bank statement parsing (faster)
export const MAX_TOKENS = 8192
