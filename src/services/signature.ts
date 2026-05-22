import nacl from 'tweetnacl'
import { createHash } from 'crypto'
import { config } from '../config'

export interface SignPayloadData {
  machineId: string
  status: string
  trialStartAt: number
  trialDays: number
  trialExtensionDays: number
  activatedAt: number
  licenseKey: string
}

function buildSignPayload(data: SignPayloadData): string {
  return JSON.stringify({
    machineId: data.machineId,
    status: data.status,
    trialStartAt: data.trialStartAt,
    trialDays: data.trialDays,
    trialExtensionDays: data.trialExtensionDays,
    activatedAt: data.activatedAt,
    licenseKey: data.licenseKey,
  })
}

export function signLicense(data: SignPayloadData): string {
  const payload = buildSignPayload(data)
  const message = new TextEncoder().encode(payload)
  const messageHash = createHash('sha512').update(message).digest()
  const signature = nacl.sign.detached(messageHash, Buffer.from(config.ed25519PrivateKey, 'base64'))
  return Buffer.from(signature).toString('base64')
}

export function verifySignature(data: SignPayloadData, signatureBase64: string): boolean {
  const payload = buildSignPayload(data)
  const message = new TextEncoder().encode(payload)
  const messageHash = createHash('sha512').update(message).digest()
  const sigBytes = Buffer.from(signatureBase64, 'base64')
  const pubKeyBytes = Buffer.from(config.ed25519PublicKey, 'base64')
  return nacl.sign.detached.verify(messageHash, sigBytes, pubKeyBytes)
}
