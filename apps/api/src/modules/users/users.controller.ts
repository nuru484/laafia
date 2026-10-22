import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf, userOf } from '../../platform/middleware/auth.ts'
import { clearSessionCookies, readCookie, revokeSessions, resolveSession, SESSION_COOKIE, setSessionCookies } from '../../platform/sessions.ts'
import { CreateUserBody, LoginBody, PasswordBody, UserParams } from './users.schemas.ts'
import { createUser, listUsers, login, me, resetPassword, setActive } from './users.service.ts'

export function createUsersController(deps: Deps) {
  const signIn: RequestHandler = async (_req, res) => {
    const b = input(res, 'body', LoginBody)
    const { session, user } = await login(deps, b.login, b.password)
    setSessionCookies(deps, res, session)
    res.json({ user, csrf_token: session.csrf })
  }
  /** Idempotent: always clears the cookies; revokes the session when there is one. */
  const signOut: RequestHandler = async (req, res) => {
    const s = await resolveSession(deps, readCookie(req, SESSION_COOKIE))
    if (s) await revokeSessions(deps, { id: s.id })
    clearSessionCookies(deps, res)
    res.json({ ok: true })
  }
  const whoAmI: RequestHandler = async (_req, res) => {
    res.json({ user: await me(deps, userOf(res).id) })
  }
  const list: RequestHandler = async (_req, res) => {
    res.json({ users: await listUsers(deps, actorOf(res)) })
  }
  const create: RequestHandler = async (_req, res) => {
    res.status(201).json({ user: await createUser(deps, actorOf(res), input(res, 'body', CreateUserBody)) })
  }
  const password: RequestHandler = async (_req, res) => {
    res.json({ user: await resetPassword(deps, actorOf(res), input(res, 'params', UserParams).id, input(res, 'body', PasswordBody).password) })
  }
  const deactivate: RequestHandler = async (_req, res) => {
    res.json({ user: await setActive(deps, actorOf(res), input(res, 'params', UserParams).id, false) })
  }
  const activate: RequestHandler = async (_req, res) => {
    res.json({ user: await setActive(deps, actorOf(res), input(res, 'params', UserParams).id, true) })
  }
  return { signIn, signOut, whoAmI, list, create, password, deactivate, activate }
}
