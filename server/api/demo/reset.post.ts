import { getDb, resetDemoDatabase } from '../../utils/db'
import { getDemoState } from '../../utils/state'

export default defineEventHandler(() => {
  resetDemoDatabase(getDb())
  return getDemoState()
})
