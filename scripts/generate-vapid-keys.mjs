import { createECDH } from 'node:crypto'

const key = createECDH('prime256v1')
key.generateKeys()
process.stdout.write(`WEB_PUSH_VAPID_PUBLIC_KEY=${key.getPublicKey().toString('base64url')}\n`)
process.stdout.write(`WEB_PUSH_VAPID_PRIVATE_KEY=${key.getPrivateKey().toString('base64url')}\n`)
