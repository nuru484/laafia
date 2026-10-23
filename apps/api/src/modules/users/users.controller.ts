import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf, userOf, type Actor } from '../../platform/middleware/auth.ts'
import { clearSessionCookies, readCookie, revokeSessions, resolveSession, SESSION_COOKIE, setSessionCookies } from '../../platform/sessions.ts'
import { ChangePasswordBody, CreateUserBody, LoginBody, PasswordBody, UpdateUserBody, UserParams } from './users.schemas.ts'
import { changeMyPassword, createUser, listUsers, login, me, resetPassword, setActive, updateMe, updateUser } from './users.service.ts'

// Routes behind `anyUser` only ever see a signed-in dashboard user.
type UserActor = Actor & { kind: 'user' }

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
  const updateMine: RequestHandler = async (_req, res) => {
    res.json({ user: await updateMe(deps, actorOf(res) as UserActor, input(res, 'body', UpdateUserBody)) })
  }
  /** Keeps the session that made the change; every other one ends. */
  const changePassword: RequestHandler = async (_req, res) => {
    const b = input(res, 'body', ChangePasswordBody)
    await changeMyPassword(deps, actorOf(res) as UserActor, b.current_password, b.new_password, (res.locals.sessionId as string | undefined) ?? null)
    res.json({ ok: true })
  }
  const list: RequestHandler = async (_req, res) => {
    res.json({ users: await listUsers(deps, actorOf(res)) })
  }
  const create: RequestHandler = async (_req, res) => {
    res.status(201).json({ user: await createUser(deps, actorOf(res), input(res, 'body', CreateUserBody)) })
  }
  const update: RequestHandler = async (_req, res) => {
    res.json({ user: await updateUser(deps, actorOf(res), input(res, 'params', UserParams).id, input(res, 'body', UpdateUserBody)) })
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
  return { signIn, signOut, whoAmI, updateMine, changePassword, list, create, update, password, deactivate, activate }
}
