import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { PHONES, type Auth } from '../../platform/middleware/auth.ts'
import { createVoiceController } from './voice.controller.ts'

export function createVoiceRouter(deps: Deps, auth: Auth) {
  const c = createVoiceController(deps)
  // Auth first so anonymous uploads are never parsed.
  return Router().post('/voice/transcribe', auth({ roles: PHONES }), c.upload, c.transcribeReply)
}
