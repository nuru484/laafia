import type { RequestHandler } from 'express'
import multer from 'multer'
import type { Deps } from '../../platform/deps.ts'
import { HttpError } from '../../platform/http/errors.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf } from '../../platform/middleware/auth.ts'
import { BatchListQuery, BatchParams, BatchReadParams, Dhis2Body, PreviewFields, TemplateBody } from './imports.schemas.ts'
import { commit, createTemplate, getBatch, listBatches, listTemplates, previewDhis2, previewFile, undo } from './imports.service.ts'

export function createImportsController(deps: Deps) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } }).single('file')

  const templates: RequestHandler = async (_req, res) => {
    res.json({ templates: await listTemplates(deps) })
  }
  const addTemplate: RequestHandler = async (_req, res) => {
    res.status(201).json({ template: await createTemplate(deps, input(res, 'body', TemplateBody)) })
  }
  const previewUpload: RequestHandler = async (req, res) => {
    const { template_id, facility_code } = PreviewFields.parse(req.body)
    if (!req.file) throw new HttpError(400, 'invalid_request', 'Expected a multipart file field "file"')
    res.status(201).json({ batch: await previewFile(deps, actorOf(res), { templateId: template_id, facilityCode: facility_code, file: req.file.buffer, filename: req.file.originalname }) })
  }
  const previewFromDhis2: RequestHandler = async (_req, res) => {
    res.status(201).json({ batch: await previewDhis2(deps, actorOf(res), input(res, 'body', Dhis2Body)) })
  }
  const batches: RequestHandler = async (_req, res) => {
    res.json({ batches: await listBatches(deps, actorOf(res), input(res, 'query', BatchListQuery).facility) })
  }
  const batch: RequestHandler = async (_req, res) => {
    res.json({ batch: await getBatch(deps, actorOf(res), input(res, 'params', BatchReadParams).id) })
  }
  const commitBatch: RequestHandler = async (_req, res) => {
    res.json({ batch: await commit(deps, actorOf(res), input(res, 'params', BatchParams).id) })
  }
  const undoBatch: RequestHandler = async (_req, res) => {
    res.json(await undo(deps, actorOf(res), input(res, 'params', BatchParams).id))
  }
  return { upload, templates, addTemplate, previewUpload, previewFromDhis2, batches, batch, commitBatch, undoBatch }
}
