import { z } from 'zod'
import { createAgentTask } from '../../utils/agent'

const bodySchema = z.object({
  mode: z.enum(['customer_profiling', 'product_matching', 'outreach_drafting', 'reply_qualification', 'handoff_summary']),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  input: z.record(z.string(), z.any()).optional().default({})
})

export default defineEventHandler(async (event) => {
  const body = bodySchema.parse(await readBody(event))
  return createAgentTask(body.mode, body.targetType, body.targetId, body.input)
})
