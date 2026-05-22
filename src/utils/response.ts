import { FastifyReply } from 'fastify'

export function success(reply: FastifyReply, data: unknown, statusCode = 200) {
  return reply.status(statusCode).send(data)
}

export function error(reply: FastifyReply, message: string, statusCode = 400) {
  return reply.status(statusCode).send({ error: message })
}
