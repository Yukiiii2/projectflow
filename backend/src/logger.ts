import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

type Level = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>
const weights: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(event: string, fields?: Fields): void
  info(event: string, fields?: Fields): void
  warn(event: string, fields?: Fields): void
  error(event: string, fields?: Fields): void
}

export function redactLogValue(value: string) {
  const withoutQuery = value.split('?')[0] ?? value
  return withoutQuery
    .replace(/(postgres(?:ql)?:\/\/)[^/@\s]+(?=@)/gi, '$1[REDACTED]')
    .replace(/(\/api\/invitations\/)[^/\s]+/gi, '$1[REDACTED]')
    .replace(/(\/invite\/)[^/\s]+/gi, '$1[REDACTED]')
    .replace(/(\/verify-email\/)[^/\s]+/gi, '$1[REDACTED]')
    .replace(/(\/reset-password\/)[^/\s]+/gi, '$1[REDACTED]')
    .replace(/\b(re_[A-Za-z0-9_-]{8,}|Bearer\s+\S+)\b/g, '[REDACTED]')
}

function sanitized(fields: Fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => {
    if (/password|secret|cookie|authorization|token|database_url/i.test(key)) return [key, '[REDACTED]']
    return [key, typeof value === 'string' ? redactLogValue(value) : value]
  }))
}

export function createLogger({ level, write = (line: string) => process.stdout.write(line) }: { level: Level; write?: (line: string) => void }): Logger {
  const emit = (entryLevel: Level, event: string, fields: Fields = {}) => {
    if (weights[entryLevel] < weights[level]) return
    write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: entryLevel, event, ...sanitized(fields) })}\n`)
  }
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}

export function requestLogging(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.get('x-request-id')
    const requestId = supplied && /^[A-Za-z0-9._-]{8,128}$/.test(supplied) ? supplied : randomUUID()
    const startedAt = performance.now()
    res.setHeader('X-Request-ID', requestId)
    res.on('finish', () => logger.info('request_completed', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      cfRay: req.get('cf-ray'),
    }))
    next()
  }
}
