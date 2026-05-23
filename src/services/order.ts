import { PrismaClient } from '@prisma/client'
import { config } from '../config'
import { createPaymentOrder } from './payment'
import { generateLicenseKey } from '../utils/license-key'

const prisma = new PrismaClient()

async function generateOrderNo(): Promise<string> {
  const now = new Date()
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')

  const prefix = `CM${dateStr}`

  const lastOrder = await prisma.order.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
  })

  let seq = 1
  if (lastOrder) {
    const lastSeq = parseInt(lastOrder.orderNo.slice(-6), 10)
    seq = lastSeq + 1
  }

  return `${prefix}${String(seq).padStart(6, '0')}`
}

export async function createOrder(machineCode: string, paymentMethod: string) {
  let license = await prisma.license.findUnique({ where: { machineCode } })

  if (!license) {
    const trialDays = await getTrialDays()
    license = await prisma.license.create({
      data: {
        machineCode,
        status: 'trial',
        trialStartAt: new Date(),
        trialDays,
      },
    })
  }

  if (license.status === 'active') {
    return { alreadyPurchased: true }
  }

  const existingOrder = await prisma.order.findFirst({
    where: {
      machineCode,
      paymentStatus: 'pending',
      paymentMethod,
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (existingOrder) {
    const paymentResult = await createPaymentOrder(existingOrder.orderNo, Number(existingOrder.amount), paymentMethod)
    return {
      orderNo: existingOrder.orderNo,
      paymentUrl: paymentResult.paymentUrl,
      qrCode: paymentResult.qrCode,
      amount: Number(existingOrder.amount),
    }
  }

  const orderNo = await generateOrderNo()
  const price = await getOrderPrice(license)

  const order = await prisma.order.create({
    data: {
      orderNo,
      machineCode,
      licenseId: license.id,
      amount: price,
      currency: 'CNY',
      paymentMethod,
      paymentStatus: 'pending',
    },
  })

  const paymentResult = await createPaymentOrder(orderNo, price, paymentMethod)

  return {
    orderNo,
    paymentUrl: paymentResult.paymentUrl,
    qrCode: paymentResult.qrCode,
    amount: Number(order.amount),
  }
}

export async function checkOrder(orderNo: string, machineCode?: string) {
  const order = await prisma.order.findUnique({ where: { orderNo } })
  if (!order) {
    throw new Error('订单不存在')
  }

  if (machineCode && order.machineCode !== machineCode) {
    throw new Error('无权查询此订单')
  }

  return {
    paid: order.paymentStatus === 'paid',
    paymentMethod: order.paymentMethod,
  }
}

export async function markOrderPaid(orderNo: string, paymentMethod?: string) {
  const order = await prisma.order.findUnique({ where: { orderNo } })
  if (!order) {
    throw new Error('订单不存在')
  }

  if (order.paymentStatus === 'paid') {
    return
  }

  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'paid',
        paidAt: now,
        paymentMethod: paymentMethod || order.paymentMethod,
      },
    })

    if (order.licenseId) {
      const licenseKey = await generateLicenseKey()
      await tx.license.update({
        where: { id: order.licenseId },
        data: {
          status: 'active',
          activatedAt: now,
          licenseKey,
        },
      })
    }
  })

  await prisma.auditLog.create({
    data: {
      action: 'order_paid',
      targetType: 'order',
      targetId: order.id,
      detail: { orderNo, paymentMethod: paymentMethod || order.paymentMethod },
    },
  })
}

export async function getLicensePriceFromConfig() {
  const row = await prisma.appConfig.findUnique({ where: { key: 'license_price' } })
  return row ? Number(row.value) : config.licensePrice
}

export async function getLicensePriceWithDiscount(machineCode?: string) {
  const price = await getLicensePriceFromConfig()
  const discountPrice = await getLicenseDiscountPriceFromConfig()

  if (!machineCode || !discountPrice || discountPrice <= 0) {
    return { price, currency: 'CNY' }
  }

  const license = await prisma.license.findUnique({ where: { machineCode } })

  if (!license || license.status !== 'trial') {
    return { price, currency: 'CNY' }
  }

  const trialEnd = new Date(license.trialStartAt!).getTime() + license.trialDays * 86400000
  if (Date.now() >= trialEnd) {
    return { price, currency: 'CNY' }
  }

  return {
    price,
    discountPrice,
    isTrialDiscount: true,
    currency: 'CNY',
  }
}

async function getLicenseDiscountPriceFromConfig(): Promise<number | null> {
  const row = await prisma.appConfig.findUnique({ where: { key: 'license_discount_price' } })
  if (row) return Number(row.value)
  return config.licenseDiscountPrice
}

async function getOrderPrice(license: { status: string; trialStartAt: Date | null; trialDays: number }): Promise<number> {
  const discountPrice = await getLicenseDiscountPriceFromConfig()

  if (license.status === 'trial' && discountPrice && discountPrice > 0 && license.trialStartAt) {
    const trialEnd = new Date(license.trialStartAt).getTime() + license.trialDays * 86400000
    if (Date.now() < trialEnd) {
      return discountPrice
    }
  }

  return getLicensePrice()
}

async function getTrialDays(): Promise<number> {
  const row = await prisma.appConfig.findUnique({ where: { key: 'trial_days' } })
  return row ? (row.value as number) : config.defaultTrialDays
}

async function getLicensePrice(): Promise<number> {
  const row = await prisma.appConfig.findUnique({ where: { key: 'license_price' } })
  return row ? (row.value as number) : config.licensePrice
}
