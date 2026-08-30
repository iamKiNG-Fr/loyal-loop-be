const rawBase = process.env.RETENTION_CRON_API_URL || ''
const secret = process.env.RETENTION_SCHEDULER_SECRET || ''

if (!rawBase || !secret) {
  throw new Error('RETENTION_CRON_API_URL and RETENTION_SCHEDULER_SECRET are required')
}

const base = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`
const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/retention/internal/run`, {
  method: 'POST',
  headers: { 'x-retention-scheduler-secret': secret },
  signal: AbortSignal.timeout(55_000),
})
const body = await response.json().catch(() => ({}))
if (!response.ok) {
  throw new Error(`Retention cron request failed (${response.status}): ${body.message || 'Unknown error'}`)
}
process.stdout.write(`${JSON.stringify(body.data)}\n`)
