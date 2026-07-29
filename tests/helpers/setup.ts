/** Minimal Nitro/Nuxt auto-import shims for Vitest. */

;(globalThis as any).useRuntimeConfig = () => ({
  databasePath: './data/acquisition-demo.sqlite',
  llmProvider: 'openai-compatible',
  llmBaseUrl: 'http://127.0.0.1:9',
  llmApiKey: 'test-key-not-real',
  llmModel: 'test-model',
  llmThinkingMode: 'disabled',
  llmReasoningEffort: 'high',
  llmContextWindowTokens: 128000,
  llmModelMaxOutputTokens: 32768,
  llmMaxOutputTokens: 4096,
  llmTimeoutMs: 1000,
  llmMaxRetries: 0,
  llmTemperature: 0.1,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
  emailAllowlist: '',
  public: {
    appBaseUrl: 'http://127.0.0.1:3100'
  }
})

;(globalThis as any).defineEventHandler = (handler: any) => handler

;(globalThis as any).createError = (input: { statusCode?: number, statusMessage?: string }) => {
  const error = new Error(input.statusMessage || 'Error') as Error & { statusCode?: number, statusMessage?: string }
  error.statusCode = input.statusCode
  error.statusMessage = input.statusMessage
  return error
}

;(globalThis as any).readBody = async (event: any) => event?.__body ?? {}
;(globalThis as any).readMultipartFormData = async (event: any) => event?.__parts ?? []
