import { Router } from 'express'
import type { Deps } from '../../platform/deps.ts'
import type { Auth } from '../../platform/middleware/auth.ts'
import { createVoiceController } from './voice.controller.ts'

export function createVoiceRouter(deps: Deps, auth: Auth) {
  const c = createVoiceController(deps)
  // Auth first so anonymous uploads are never parsed.
  return Router().post('/voice/transcribe', auth(), c.upload, c.transcribeReply)
}
