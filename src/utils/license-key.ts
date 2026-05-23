import { randomBytes } from 'crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function generateLicenseKey(): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const maxRetries = 10

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const bytes = randomBytes(16)
    const key = `CM-${group(bytes, 0, chars)}-${group(bytes, 4, chars)}-${group(bytes, 8, chars)}-${group(bytes, 12, chars)}`

    const existing = await prisma.license.findUnique({ where: { licenseKey: key } })
    if (!existing) {
      return key
    }
  }

  throw new Error('Failed to generate unique license key after retries')
}

function group(bytes: Buffer, offset: number, chars: string): string {
  let result = ''
  for (let i = 0; i < 4; i++) {
    result += chars[bytes[offset + i] % chars.length]
  }
  return result
}
