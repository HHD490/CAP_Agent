import { stopAgentTask } from '../../../../utils/agent'

export default defineEventHandler((event) => stopAgentTask(getRouterParam(event, 'id') || ''))
