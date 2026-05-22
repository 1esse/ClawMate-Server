import { FastifyError, FastifyRequest, FastifyReply } from 'fastify'

export class AppError extends Error {
  public statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
    this.name = 'AppError'
  }
}

export function errorHandler(error: FastifyError, _request: FastifyRequest, reply: FastifyReply) {
  const statusCode = error.statusCode || 500
  const message = error.message || 'Internal Server Error'

  if (statusCode === 500) {
    console.error('[ServerError]', error)
  }

  return reply.status(statusCode).send({ error: message })
}
