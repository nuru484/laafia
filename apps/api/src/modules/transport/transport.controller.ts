import type { RequestHandler } from 'express'
import type { Deps } from '../../platform/deps.ts'
import { input } from '../../platform/http/validate.ts'
import { actorOf, deviceOf } from '../../platform/middleware/auth.ts'
import { AdminProviderBody, ProviderBody, ProviderParams, ProviderPatch, ReferralParams, RequestBody, WebPickupBody } from './transport.schemas.ts'
import { adminCreateProvider, adminListProviders, adminUpdateProvider, createProvider, listProviders, requestTransport, requestTransportFromWeb, transportOptions, updateProvider } from './transport.service.ts'

export function createTransportController(deps: Deps) {
  const list: RequestHandler = async (_req, res) => {
    res.json({ providers: await listProviders(deps, deviceOf(res)) })
  }
  const create: RequestHandler = async (_req, res) => {
    res.status(201).json({ provider: await createProvider(deps, deviceOf(res), input(res, 'body', ProviderBody)) })
  }
  const update: RequestHandler = async (_req, res) => {
    res.json({ provider: await updateProvider(deps, deviceOf(res), input(res, 'params', ProviderParams).id, input(res, 'body', ProviderPatch)) })
  }
  const request: RequestHandler = async (_req, res) => {
    res.status(201).json({ transport_request: await requestTransport(deps, deviceOf(res), input(res, 'body', RequestBody)) })
  }
  const adminList: RequestHandler = async (_req, res) => {
    res.json({ providers: await adminListProviders(deps, actorOf(res)) })
  }
  const adminCreate: RequestHandler = async (_req, res) => {
    res.status(201).json({ provider: await adminCreateProvider(deps, actorOf(res), input(res, 'body', AdminProviderBody)) })
  }
  const adminUpdate: RequestHandler = async (_req, res) => {
    res.json({ provider: await adminUpdateProvider(deps, actorOf(res), input(res, 'params', ProviderParams).id, input(res, 'body', ProviderPatch)) })
  }
  const options: RequestHandler = async (_req, res) => {
    res.json(await transportOptions(deps, actorOf(res), input(res, 'params', ReferralParams).id))
  }
  const webRequest: RequestHandler = async (_req, res) => {
    res.status(201).json({ transport_request: await requestTransportFromWeb(deps, actorOf(res), input(res, 'params', ReferralParams).id, input(res, 'body', WebPickupBody)) })
  }
  return { list, create, update, request, adminList, adminCreate, adminUpdate, options, webRequest }
}
