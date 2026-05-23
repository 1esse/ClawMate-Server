import { PrismaClient } from '@prisma/client'
import { signLicense, SignPayloadData } from './signature'
import { generateLicenseKey } from '../utils/license-key'
import { config } from '../config'

const prisma = new PrismaClient()

function toMs(date: Date | null | undefined): number {
  if (!date) return 0
  return date.getTime()
}

function buildSignData(license: {
  machineCode: string
  status: string
  trialStartAt: Date | null
  trialDays: number
  trialExtension: number
  activatedAt: Date | null
  licenseKey: string | null
}): SignPayloadData {
  return {
    machineId: license.machineCode,
    status: license.status,
    trialStartAt: toMs(license.trialStartAt),
    trialDays: license.trialDays,
    trialExtensionDays: license.trialExtension,
    activatedAt: toMs(license.activatedAt),
    licenseKey: license.licenseKey || '',
  }
}

export async function getTrialConfig() {
  const row = await prisma.appConfig.findUnique({ where: { key: 'trial_days' } })
  return { trialDays: row ? (row.value as number) : config.defaultTrialDays }
}

export async function registerLicense(machineCode: string) {
  let license = await prisma.license.findUnique({ where: { machineCode } })

  if (!license) {
    const trialConfig = await getTrialConfig()
    license = await prisma.license.create({
      data: {
        machineCode,
        status: 'trial',
        trialStartAt: new Date(),
        trialDays: trialConfig.trialDays,
      },
    })

    await prisma.auditLog.create({
      data: {
        action: 'register',
        targetType: 'license',
        targetId: license.id,
        detail: { machineCode },
      },
    })
  }

  return {
    trialStartAt: toMs(license.trialStartAt),
    trialDays: license.trialDays,
    trialExtensionDays: license.trialExtension,
  }
}

export async function validateLicense(machineCode: string) {
  let license = await prisma.license.findUnique({ where: { machineCode } })

  if (!license) {
    const trialConfig = await getTrialConfig()
    license = await prisma.license.create({
      data: {
        machineCode,
        status: 'trial',
        trialStartAt: new Date(),
        trialDays: trialConfig.trialDays,
      },
    })
  }

  if (license.status === 'active') {
    const signData = buildSignData(license)
    const serverSignature = signLicense(signData)
    return {
      purchased: true,
      trialStartAt: toMs(license.trialStartAt),
      trialDays: license.trialDays,
      trialExtensionDays: license.trialExtension,
      activatedAt: toMs(license.activatedAt),
      licenseKey: license.licenseKey,
      serverSignature,
    }
  }

  return {
    purchased: false,
    trialStartAt: toMs(license.trialStartAt),
    trialDays: license.trialDays,
    trialExtensionDays: license.trialExtension,
  }
}

export async function activateLicense(token: string, machineCode: string) {
  const activationToken = await prisma.activationToken.findUnique({
    where: { token },
    include: { license: true },
  })

  if (!activationToken) {
    return { success: false, error: '激活码无效或已过期' }
  }

  if (activationToken.used) {
    return { success: false, error: '激活码已被使用' }
  }

  if (activationToken.expiresAt < new Date()) {
    return { success: false, error: '激活码已过期' }
  }

  if (activationToken.machineCode !== machineCode) {
    return { success: false, error: '机器码不匹配' }
  }

  const licenseKey = await generateLicenseKey()
  const now = new Date()

  const license = await prisma.license.update({
    where: { id: activationToken.licenseId },
    data: {
      status: 'active',
      activatedAt: now,
      licenseKey,
    },
  })

  await prisma.activationToken.update({
    where: { id: activationToken.id },
    data: { used: true, usedAt: now },
  })

  await prisma.auditLog.create({
    data: {
      action: 'activate',
      targetType: 'license',
      targetId: license.id,
      detail: { machineCode, licenseKey },
    },
  })

  const signData = buildSignData(license)
  const serverSignature = signLicense(signData)

  return {
    success: true,
    licenseKey,
    activatedAt: now.getTime(),
    serverSignature,
  }
}

export async function extendTrial(machineCode: string, extraDays: number) {
  const license = await prisma.license.findUnique({ where: { machineCode } })
  if (!license) {
    throw new Error('License not found')
  }

  const updated = await prisma.license.update({
    where: { machineCode },
    data: { trialExtension: license.trialExtension + extraDays },
  })

  await prisma.auditLog.create({
    data: {
      action: 'extend_trial',
      targetType: 'license',
      targetId: updated.id,
      detail: { machineCode, extraDays, newExtension: updated.trialExtension },
    },
  })

  return { success: true, trialExtension: updated.trialExtension }
}

export async function revokeLicense(machineCode: string, reason: string) {
  const license = await prisma.license.findUnique({ where: { machineCode } })
  if (!license) {
    throw new Error('License not found')
  }

  const updated = await prisma.license.update({
    where: { machineCode },
    data: { status: 'revoked', revokedAt: new Date() },
  })

  await prisma.auditLog.create({
    data: {
      action: 'revoke_license',
      targetType: 'license',
      targetId: updated.id,
      detail: { machineCode, reason },
    },
  })

  return { success: true }
}

export async function updateTrialConfig(trialDays: number) {
  await prisma.appConfig.upsert({
    where: { key: 'trial_days' },
    update: { value: trialDays },
    create: { key: 'trial_days', value: trialDays },
  })

  await prisma.auditLog.create({
    data: {
      action: 'update_trial_config',
      targetType: 'app_config',
      targetId: 'trial_days',
      detail: { trialDays },
    },
  })

  return { success: true, trialDays }
}

export async function getStats() {
  const [totalLicenses, activeLicenses, trialLicenses, revokedLicenses] = await Promise.all([
    prisma.license.count(),
    prisma.license.count({ where: { status: 'active' } }),
    prisma.license.count({ where: { status: 'trial' } }),
    prisma.license.count({ where: { status: 'revoked' } }),
  ])

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [totalRevenueResult, todayOrders, todayRevenueResult] = await Promise.all([
    prisma.order.aggregate({ _sum: { amount: true }, where: { paymentStatus: 'paid' } }),
    prisma.order.count({ where: { paymentStatus: 'paid', paidAt: { gte: todayStart } } }),
    prisma.order.aggregate({ _sum: { amount: true }, where: { paymentStatus: 'paid', paidAt: { gte: todayStart } } }),
  ])

  return {
    totalLicenses,
    activeLicenses,
    trialLicenses,
    revokedLicenses,
    totalRevenue: totalRevenueResult._sum.amount ? Number(totalRevenueResult._sum.amount) : 0,
    todayOrders,
    todayRevenue: todayRevenueResult._sum.amount ? Number(todayRevenueResult._sum.amount) : 0,
  }
}
