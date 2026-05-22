import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { config } from '../config'

declare module 'fastify' {
  interface FastifyRequest {
    admin?: { id: string; username: string }
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: '未提供认证令牌' })
  }

  const token = authHeader.slice(7)

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string; username: string }
    request.admin = decoded
  } catch {
    return reply.status(401).send({ error: '认证令牌无效或已过期' })
  }
}
