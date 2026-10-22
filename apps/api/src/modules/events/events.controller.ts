import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { deviceOrNull } from '../../platform/middleware/auth.ts'
import { StreamQuery, TicketBody } from './events.schemas.ts'
import { issueTicket, redeemTicket, subscribe } from './events.service.ts'

export function createEventsController(deps: Deps) {
  const ticket: RequestHandler = async (_req, res) => {
    res.json(await issueTicket(deps, deviceOrNull(res), input(res, 'body', TicketBody).facility))
  }
  const stream: RequestHandler = (req, res) => {
    const f = redeemTicket(deps, input(res, 'query', StreamQuery).ticket)
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`event: ready\ndata: ${JSON.stringify({ facility: f.code })}\n\n`)
    const unsubscribe = subscribe(deps, f.id, (v) => res.write(`event: referral\ndata: ${JSON.stringify(v)}\n\n`))
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
    req.on('close', () => {
      clearInterval(ping)
      unsubscribe()
    })
  }
  return { ticket, stream }
}
