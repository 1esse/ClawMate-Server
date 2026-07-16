import { FastifyInstance } from 'fastify'
import { getTrialConfig, validateLicense, activateLicense, registerLicense } from '../services/license'
import { createOrder, checkOrder, getLicensePriceWithDiscount } from '../services/order'
import { AppError } from '../utils/error'

export async function licenseRoutes(fastify: FastifyInstance) {
  fastify.get('/trial-config', async (_request, reply) => {
    const config = await getTrialConfig()
    return reply.send({ trialDays: config.trialDays })
  })

  fastify.post('/register', async (request, reply) => {
    const { machineCode } = request.body as { machineCode: string }

    if (!machineCode) {
      throw new AppError('machineCode is required', 400)
    }

    const result = await registerLicense(machineCode)
    return reply.send(result)
  })

  fastify.get('/price', async (request, reply) => {
    const { machineCode } = request.query as { machineCode?: string }
    const result = await getLicensePriceWithDiscount(machineCode)
    return reply.send(result)
  })

  fastify.post('/validate', async (request, reply) => {
    const { machineCode, licenseKey } = request.body as { machineCode: string; licenseKey?: string }

    if (!machineCode) {
      throw new AppError('machineCode is required', 400)
    }

    const result = await validateLicense(machineCode, licenseKey)
    return reply.send(result)
  })

  fastify.post('/create-order', async (request, reply) => {
    const { machineCode, paymentMethod } = request.body as {
      machineCode: string
      paymentMethod: string
    }

    if (!machineCode || !paymentMethod) {
      throw new AppError('machineCode and paymentMethod are required', 400)
    }

    if (!['alipay', 'wechat'].includes(paymentMethod)) {
      throw new AppError('paymentMethod must be alipay or wechat', 400)
    }

    const result = await createOrder(machineCode, paymentMethod)
    return reply.send(result)
  })

  fastify.get('/check-order', async (request, reply) => {
    const { orderNo, machineCode } = request.query as { orderNo: string; machineCode?: string }

    if (!orderNo) {
      throw new AppError('orderNo is required', 400)
    }

    try {
      const result = await checkOrder(orderNo, machineCode)
      return reply.send(result)
    } catch (err) {
      if (err instanceof Error && err.message === '订单不存在') {
        throw new AppError(err.message, 404)
      }
      if (err instanceof Error && err.message === '无权查询此订单') {
        throw new AppError(err.message, 403)
      }
      throw err
    }
  })

  fastify.post('/activate', async (request, reply) => {
    const { token, machineCode } = request.body as {
      token: string
      machineCode: string
    }

    if (!token || !machineCode) {
      throw new AppError('token and machineCode are required', 400)
    }

    const result = await activateLicense(token, machineCode)
    return reply.send(result)
  })
}
