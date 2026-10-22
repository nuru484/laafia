import type { RequestHandler } from 'express'
import multer from 'multer'
import type { Deps } from '../../platform/deps.ts'
import { deviceOf } from '../../platform/middleware/auth.ts'
import { LangInput } from './voice.schemas.ts'
import { assertConfigured, MAX_AUDIO_BYTES, transcribe } from './voice.service.ts'

export function createVoiceController(deps: Deps) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 5 } }).single('audio')
  const transcribeReply: RequestHandler = async (req, res) => {
    const device = deviceOf(res)
    assertConfigured(deps) // 503 before validating anything else
    const { lang } = LangInput.parse({ lang: req.query.lang ?? req.body?.lang })
    res.json(await transcribe(deps, device.id, req.file?.buffer, lang))
  }
  return { upload, transcribeReply }
}
