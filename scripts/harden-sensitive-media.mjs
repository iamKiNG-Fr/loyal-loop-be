import { createHash } from 'node:crypto'
import pg from 'pg'

const apply = process.argv.includes('--apply')
const cloudName = apply ? required('CLOUDINARY_CLOUD_NAME') : ''
const apiKey = apply ? required('CLOUDINARY_API_KEY') : ''
const apiSecret = apply ? required('CLOUDINARY_API_SECRET') : ''
const connectionString = secureDatabaseUrl(process.env.DATABASE_URL_UNPOOLED || required('DATABASE_URL'))
const client = new pg.Client({ connectionString })

await client.connect()
try {
  const result = await client.query(`
    SELECT id, "publicId", "resourceType"
    FROM media_assets
    WHERE purpose IN ('PAYMENT_PROOF', 'DELIVERY_HANDOFF')
      AND status = 'ACTIVE'
      AND "deliveryType" = 'upload'
    ORDER BY "createdAt" ASC
  `)

  if (!apply) {
    process.stdout.write(`${JSON.stringify({ candidates: result.rowCount, mode: 'dry-run' })}\n`)
    process.exit(0)
  }

  let converted = 0
  for (const asset of result.rows) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params = {
      from_public_id: asset.publicId,
      invalidate: 'true',
      timestamp,
      to_public_id: asset.publicId,
      to_type: 'authenticated',
      type: 'upload',
    }
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/${asset.resourceType === 'video' ? 'video' : 'image'}/rename`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...params,
          api_key: apiKey,
          signature: sign(params, apiSecret),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.public_id !== asset.publicId || body.type !== 'authenticated' || !body.secure_url) {
      throw new Error(`Could not protect media asset ${asset.id} (Cloudinary ${response.status})`)
    }
    await client.query(
      `UPDATE media_assets SET "deliveryType" = 'authenticated', "secureUrl" = $1 WHERE id = $2`,
      [body.secure_url, asset.id],
    )
    converted += 1
  }
  process.stdout.write(`${JSON.stringify({ candidates: result.rowCount, converted, mode: 'apply' })}\n`)
} finally {
  await client.end()
}

function sign(params, secret) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return createHash('sha1').update(`${payload}${secret}`).digest('hex')
}

function secureDatabaseUrl(raw) {
  const url = new URL(raw)
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    url.searchParams.set('sslmode', 'verify-full')
    url.searchParams.delete('uselibpqcompat')
  }
  return url.toString()
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
