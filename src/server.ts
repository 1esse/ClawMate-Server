import Fastify, { FastifyError } from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import { config } from './config'
import { errorHandler, AppError } from './utils/error'
import { licenseRoutes } from './routes/license'
import { paymentRoutes } from './routes/payment'
import { adminRoutes } from './routes/admin'
import rateLimitPlugin from './middleware/rateLimit'

const prisma = new PrismaClient()

async function bootstrap() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
    },
  })

  await fastify.register(cors, {
    origin: true,
  })

  await fastify.register(rateLimitPlugin)

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.message })
    }
    return errorHandler(error as FastifyError, request, reply)
  })

  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string)
        const result: Record<string, string> = {}
        params.forEach((value, key) => {
          result[key] = value
        })
        done(null, result)
      } catch (err) {
        done(err as Error)
      }
    }
  )

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() }
  })

  fastify.register(licenseRoutes, { prefix: '/api/v1/license' })
  fastify.register(paymentRoutes, { prefix: '/api/v1/payment' })
  fastify.register(adminRoutes, { prefix: '/api/v1/admin' })

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect()
  })

  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' })
    console.log(`ClawMate Server running on port ${config.port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

bootstrap()
