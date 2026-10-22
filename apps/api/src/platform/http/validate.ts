import type { RequestHandler, Response } from 'express'
import type { z } from 'zod'

type Part = 'body' | 'query' | 'params'

/**
 * Parse request parts with Zod before the controller runs. Parsed values land
 * in res.locals.input (req.query is read-only in Express 5); a failure becomes
 * a 400 invalid_request through the error handler.
 */
export function validate(schemas: Partial<Record<Part, z.ZodType>>): RequestHandler {
  return (req, res, next) => {
    const input: Partial<Record<Part, unknown>> = {}
    for (const part of Object.keys(schemas) as Part[]) input[part] = schemas[part]!.parse(req[part] ?? {})
    res.locals.input = input
    next()
  }
}

/** The validated value of one request part, typed by its schema. */
export const input = <S extends z.ZodType>(res: Response, part: Part, _schema: S): z.infer<S> =>
  (res.locals.input as Record<Part, unknown>)[part] as z.infer<S>
