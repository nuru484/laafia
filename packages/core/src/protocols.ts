import child from '../protocols/child.json'
import maternal from '../protocols/maternal.json'
import youngInfant from '../protocols/young_infant.json'
import riskModel from '../model/risk_model.json'
import type { Protocol } from './rules.ts'
import type { RiskModel } from './scorer.ts'

export const PROTOCOLS = {
  maternal: maternal as Protocol,
  young_infant: youngInfant as Protocol,
  child: child as Protocol,
}

export const RISK_MODEL = riskModel as RiskModel
