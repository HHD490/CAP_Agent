import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// 新 PoC 首次启动时可复用旧 PoC 已配置的本地模型凭证；一旦创建本项目 .env，
// 本地配置会自动优先，旧项目仍保持只读参考。
const localEnv = resolve(process.cwd(), '.env')
const referenceEnv = resolve(process.cwd(), '../logistics-outreach-poc/.env')
if (!existsSync(localEnv) && existsSync(referenceEnv)) process.loadEnvFile(referenceEnv)

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  css: [
    '@arco-design/web-vue/dist/arco.css',
    '~/assets/css/main.css'
  ],
  plugins: ['~/plugins/arco.ts'],
  runtimeConfig: {
    databasePath: process.env.DATABASE_PATH || './data/acquisition-demo.sqlite',
    llmProvider: process.env.LLM_PROVIDER || 'openai-compatible',
    llmBaseUrl: process.env.LLM_BASE_URL || '',
    llmApiKey: process.env.LLM_API_KEY || '',
    llmModel: process.env.LLM_MODEL || '',
    llmThinkingMode: process.env.LLM_THINKING_MODE || 'disabled',
    llmReasoningEffort: process.env.LLM_REASONING_EFFORT || 'high',
    llmContextWindowTokens: Number(process.env.LLM_CONTEXT_WINDOW_TOKENS || 128000),
    llmModelMaxOutputTokens: Number(process.env.LLM_MODEL_MAX_OUTPUT_TOKENS || 32768),
    llmMaxOutputTokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS || 65536),
    llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 180000),
    llmMaxRetries: Number(process.env.LLM_MAX_RETRIES || 2),
    llmTemperature: Number(process.env.LLM_TEMPERATURE || 0.1),
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: process.env.SMTP_FROM || '',
    emailAllowlist: process.env.EMAIL_ALLOWLIST || '',
    public: {
      appBaseUrl: process.env.APP_BASE_URL || 'http://127.0.0.1:3100'
    }
  },
  nitro: {
    experimental: { websocket: false }
  },
  vite: {
    envDir: false,
    server: {
      watch: {
        ignored: ['**/data/**', '**/*.sqlite', '**/*.sqlite-*']
      }
    }
  },
  typescript: {
    strict: true,
    typeCheck: true
  }
})
