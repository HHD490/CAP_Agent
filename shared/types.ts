export type AgentMode = 'customer_profiling' | 'product_matching' | 'outreach_drafting' | 'reply_qualification' | 'handoff_summary'
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'

export interface Customer {
  id: string
  name: string
  source: 'wca_simulated' | 'website' | 'manual' | 'import'
  sourceRef: string
  country: string
  city: string
  website: string
  domain: string
  customerType: string
  status: string
  profileVersion: number
  raw: Record<string, unknown>
  facts: Record<string, unknown>
  aiProfile: Record<string, any>
  aiProfileStatus: string
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  contacts: Contact[]
  opportunities: Opportunity[]
  focusOpportunity?: Opportunity
}

export interface Contact {
  id: string
  customerId: string
  name: string
  title: string
  email: string
  status: string
  isPrimary: boolean
}

export interface Product {
  id: string
  code: string
  name: string
  category: string
  transportMode: string
  routes: string[]
  cargoTypes: string[]
  capabilities: string[]
  quoteReady: boolean
  referencePrice: string
  transitTime: string
  published: boolean
  productVersion: number
  pmsSnapshot: Record<string, unknown>
  marketing: Record<string, any>
  simulated: boolean
  updatedAt: string
}

export interface MatchResult {
  id: string
  customerId: string
  productId: string
  score: number
  confidence: string
  evidence: string[]
  risks: string[]
  missing: string[]
  blockers: string[]
  customerVersion: number
  productVersion: number
  stale: boolean
  status: string
  createdAt: string
  updatedAt: string
  customer?: Customer
  product?: Product
}

export interface Opportunity {
  id: string
  customerId: string
  productId: string
  contactId: string
  source: string
  stage: number
  status: string
  focus: boolean
  owner: string
  nextAction: string
  dueAt: string
  blocker: string
  staleReview: boolean
  closeReason: string
  aiSummary: string
  createdAt: string
  updatedAt: string
  customer?: Customer
  product?: Product
  contact?: Contact
  events?: TimelineEvent[]
  drafts?: EmailDraft[]
}

export interface TimelineEvent {
  id: string
  opportunityId: string
  customerId: string
  type: string
  title: string
  description: string
  source: string
  data: Record<string, unknown>
  createdAt: string
}

export interface EmailDraft {
  id: string
  opportunityId: string
  version: number
  language: 'zh' | 'en'
  subject: string
  body: string
  status: string
  recipient: string
  sentAt: string
  createdAt: string
}

export interface AgentTask {
  id: string
  mode: AgentMode
  targetType: string
  targetId: string
  status: TaskStatus
  phase: string
  progress: number
  currentStep: string
  model: string
  error: string
  result: Record<string, any>
  createdAt: string
  startedAt: string
  completedAt: string
  steps: AgentTaskStep[]
}

export interface AgentTaskStep {
  id: string
  taskId: string
  sequence: number
  phase: string
  summary: string
  data: Record<string, unknown>
  createdAt: string
}

export interface Inquiry {
  id: string
  sessionId: string
  customerId: string
  opportunityId: string
  status: string
  origin: string
  destination: string
  cargoName: string
  weightKg: number
  volumeCbm: number
  preference: string
  details: Record<string, unknown>
  recommendations: Array<Record<string, any>>
  createdAt: string
  updatedAt: string
}

export interface DemoState {
  currentTime: string
  counts: Record<string, number>
  customers: Customer[]
  products: Product[]
  matches: MatchResult[]
  opportunities: Opportunity[]
  tasks: AgentTask[]
  inquiries: Inquiry[]
  emailAllowlist: string[]
  model: {
    configured: boolean
    provider: string
    name: string
    thinkingMode: string
    reasoningEffort: string
    contextWindowTokens: number
    modelMaxOutputTokens: number
    maxOutputTokens: number
  }
}
