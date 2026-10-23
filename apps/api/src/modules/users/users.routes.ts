import { Router, type RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input, validate } from '../../platform/http/validate.ts'
import { actorOf, type Auth } from '../../platform/middleware/auth.ts'
import { fixedWindow } from '../../platform/middleware/rate-limit.ts'
import { createUsersController } from './users.controller.ts'
import { ChangePasswordBody, CreateUserBody, LoginBody, PasswordBody, UpdateUserBody, UserParams } from './users.schemas.ts'

// 5 sign-in attempts per IP and per account identifier in 15 minutes.
const byIp = fixedWindow(5, 15 * 60_000, 'Too many sign-in attempts; wait and try again')
const byLogin = fixedWindow(5, 15 * 60_000, 'Too many attempts for this account; wait and try again')
// Changing a password checks the current one: 5 tries per user in 15 minutes, so a stolen session cannot guess it.
const byUser = fixedWindow(5, 15 * 60_000, 'Too many password attempts; wait and try again')
export const resetLoginLimits = () => (byIp.reset(), byLogin.reset(), byUser.reset())
const limitLogin: RequestHandler = (req, res, next) => {
  byIp.hit(req.ip ?? 'unknown')
  byLogin.hit(input(res, 'body', LoginBody).login.toLowerCase())
  next()
}

export function createUsersRouter(deps: Deps, auth: Auth) {
  const c = createUsersController(deps)
  const anyUser = auth({ roles: [], users: ['district_admin', 'facility_staff', 'supervisor'] })
  const admin = auth({ admin: true, roles: [], users: ['district_admin'] })
  return Router()
    .post('/web/login', validate({ body: LoginBody }), limitLogin, c.signIn)
    .post('/web/logout', c.signOut)
    .get('/web/me', anyUser, c.whoAmI)
    .patch('/web/me', anyUser, validate({ body: UpdateUserBody }), c.updateMine)
    .post('/web/me/password', anyUser, validate({ body: ChangePasswordBody }), (_req, res, next) => { const a = actorOf(res); byUser.hit(a.kind === 'user' ? a.user.id : 'unknown'); next() }, c.changePassword)
    .get('/admin/users', admin, c.list)
    .post('/admin/users', admin, validate({ body: CreateUserBody }), c.create)
    .patch('/admin/users/:id', admin, validate({ params: UserParams, body: UpdateUserBody }), c.update)
    .post('/admin/users/:id/password', admin, validate({ params: UserParams, body: PasswordBody }), c.password)
    .post('/admin/users/:id/deactivate', admin, validate({ params: UserParams }), c.deactivate)
    .post('/admin/users/:id/activate', admin, validate({ params: UserParams }), c.activate)
}
