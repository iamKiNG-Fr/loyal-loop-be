const rawBase = process.env.REMINDER_CRON_API_URL || ''
const secret = process.env.REMINDER_SCHEDULER_SECRET || ''

if (!rawBase || !secret) {
  throw new Error('REMINDER_CRON_API_URL and REMINDER_SCHEDULER_SECRET are required')
}

const base = /^https?:\/\//i.test(rawBase) ? rawBase : `https://${rawBase}`

const schedule = await post('/api/v1/attention/internal/run', {
  'x-reminder-scheduler-secret': secret,
})

let messaging = null
if (process.env.REMINDER_CRON_PROCESS_MESSAGES === 'true') {
  const workerSecret = process.env.MESSAGING_WORKER_SECRET || ''
  if (!workerSecret) throw new Error('MESSAGING_WORKER_SECRET is required when REMINDER_CRON_PROCESS_MESSAGES=true')
  messaging = await post('/api/v1/messaging/internal/process', {
    'x-messaging-worker-secret': workerSecret,
  })
}

process.stdout.write(`${JSON.stringify({ schedule: schedule.data, messaging: messaging?.data || null })}\n`)

async function post(path, headers) {
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(55_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Reminder cron request failed (${response.status}): ${body.message || 'Unknown error'}`)
  }
  return body
}
