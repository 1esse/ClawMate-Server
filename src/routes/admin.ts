import { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'
import { config } from '../config'
import { authMiddleware } from '../middleware/auth'
import { extendTrial, revokeLicense, updateTrialConfig, getStats } from '../services/license'
import { AppError } from '../utils/error'

const prisma = new PrismaClient()

export async function adminRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request, reply) => {
    const { username, password } = request.body as {
      username: string
      password: string
    }

    if (!username || !password) {
      throw new AppError('username and password are required', 400)
    }

    const admin = await prisma.admin.findUnique({ where: { username } })
    if (!admin) {
      throw new AppError('用户名或密码错误', 401)
    }

    const valid = await bcrypt.compare(password, admin.passwordHash)
    if (!valid) {
      throw new AppError('用户名或密码错误', 401)
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
    )

    const decoded = jwt.decode(token) as { exp: number }
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000)

    return reply.send({ token, expiresIn })
  })

  fastify.register(async (protectedFastify) => {
    protectedFastify.addHook('onRequest', authMiddleware)

    protectedFastify.get('/licenses', async (request, reply) => {
      const { page = '1', pageSize = '20', status, search } = request.query as {
        page?: string
        pageSize?: string
        status?: string
        search?: string
      }

      const pageNum = parseInt(page, 10)
      const pageSizeNum = parseInt(pageSize, 10)
      const skip = (pageNum - 1) * pageSizeNum

      const where: Record<string, unknown> = {}
      if (status) {
        where.status = status
      }
      if (search) {
        where.OR = [
          { machineCode: { contains: search, mode: 'insensitive' } },
          { licenseKey: { contains: search, mode: 'insensitive' } },
        ]
      }

      const [total, data] = await Promise.all([
        prisma.license.count({ where }),
        prisma.license.findMany({
          where,
          skip,
          take: pageSizeNum,
          orderBy: { createdAt: 'desc' },
        }),
      ])

      return reply.send({
        total,
        page: pageNum,
        pageSize: pageSizeNum,
        data: data.map((l) => ({
          id: l.id,
          machineCode: l.machineCode,
          licenseKey: l.licenseKey,
          status: l.status,
          trialStartAt: l.trialStartAt ? l.trialStartAt.getTime() : null,
          trialDays: l.trialDays,
          trialExtension: l.trialExtension,
          activatedAt: l.activatedAt ? l.activatedAt.getTime() : null,
          createdAt: l.createdAt.getTime(),
        })),
      })
    })

    protectedFastify.get('/orders', async (request, reply) => {
      const { page = '1', pageSize = '20', paymentStatus } = request.query as {
        page?: string
        pageSize?: string
        paymentStatus?: string
      }

      const pageNum = parseInt(page, 10)
      const pageSizeNum = parseInt(pageSize, 10)
      const skip = (pageNum - 1) * pageSizeNum

      const where: Record<string, unknown> = {}
      if (paymentStatus) {
        where.paymentStatus = paymentStatus
      }

      const [total, data] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          skip,
          take: pageSizeNum,
          orderBy: { createdAt: 'desc' },
          include: { license: { select: { machineCode: true, licenseKey: true } } },
        }),
      ])

      return reply.send({
        total,
        page: pageNum,
        pageSize: pageSizeNum,
        data: data.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          machineCode: o.machineCode,
          amount: Number(o.amount),
          currency: o.currency,
          paymentMethod: o.paymentMethod,
          paymentStatus: o.paymentStatus,
          paidAt: o.paidAt ? o.paidAt.getTime() : null,
          createdAt: o.createdAt.getTime(),
        })),
      })
    })

    protectedFastify.post('/extend-trial', async (request, reply) => {
      const { machineCode, extraDays } = request.body as {
        machineCode: string
        extraDays: number
      }

      if (!machineCode || !extraDays) {
        throw new AppError('machineCode and extraDays are required', 400)
      }

      try {
        const result = await extendTrial(machineCode, extraDays)
        return reply.send(result)
      } catch (err) {
        if (err instanceof Error && err.message === 'License not found') {
          throw new AppError('License not found', 404)
        }
        throw err
      }
    })

    protectedFastify.post('/revoke-license', async (request, reply) => {
      const { machineCode, reason } = request.body as {
        machineCode: string
        reason?: string
      }

      if (!machineCode) {
        throw new AppError('machineCode is required', 400)
      }

      try {
        await revokeLicense(machineCode, reason || '')
        return reply.send({ success: true })
      } catch (err) {
        if (err instanceof Error && err.message === 'License not found') {
          throw new AppError('License not found', 404)
        }
        throw err
      }
    })

    protectedFastify.post('/update-trial-config', async (request, reply) => {
      const { trialDays } = request.body as { trialDays: number }

      if (!trialDays || trialDays < 1) {
        throw new AppError('trialDays must be a positive integer', 400)
      }

      const result = await updateTrialConfig(trialDays)
      return reply.send(result)
    })

    protectedFastify.get('/stats', async (_request, reply) => {
      const stats = await getStats()
      return reply.send(stats)
    })
  })
}
