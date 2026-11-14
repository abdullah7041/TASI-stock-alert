export const policy = 'evidence-v1';
export type CompanyCase = 'supported'|'weakened'|'invalidated'|'unresolved';
export type Valuation = 'favorable'|'unfavorable'|'unresolved';
export type Entry = 'passed'|'failed'|'unavailable';
export function recommendationAction(owned:boolean, company:CompanyCase, valuation:Valuation, entry:Entry) {
  if (company==='unresolved') return null;
  if (owned && company==='invalidated') return 'SELL';
  if (owned && company==='weakened') return 'REDUCE';
  if (company==='supported' && valuation==='favorable' && entry==='passed') return owned?'ADD':'BUY';
  if (owned) return 'HOLD';
  return company==='supported' && (valuation==='unresolved' || entry==='unavailable') ? null : 'WATCH';
}

export type Fact = {id:string; text:string; url:string; publishedAt:string; period:string};
export type Claim = {interpretation:string; evidence:string[]};
export type Interpretation = {
  company:CompanyCase; valuation:Valuation;
  rationale:Claim; supporting:Claim[]; contrary:Claim[]; risks:Claim[]; invalidation:Claim;
  ownershipCondition:string; remainingRationale:string;
};
const claim = {type:'object', additionalProperties:false, required:['interpretation','evidence'], properties:{
  interpretation:{type:'string',maxLength:1000},
  evidence:{type:'array',minItems:1,maxItems:8,items:{type:'string'}},
}};
const claims = {type:'array',minItems:1,maxItems:4,items:claim};
const properties = {
  company:{type:'string',enum:['supported','weakened','invalidated','unresolved']},
  valuation:{type:'string',enum:['favorable','unfavorable','unresolved']},
  rationale:claim,supporting:claims,contrary:claims,risks:claims,invalidation:claim,
  ownershipCondition:{type:'string',maxLength:1000},
  remainingRationale:{type:'string',maxLength:1000},
};
export const format = {type:'json_schema',name:'evaluation_recommendation',strict:true,
  schema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}};

export function parseInterpretation(value:unknown, facts:Fact[], permittedConditions:string[]):Interpretation {
  const v=value as Interpretation;
  const ids=new Set(facts.map(f=>f.id));
  const valid=(c:Claim)=>c && typeof c.interpretation==='string' && c.interpretation.trim().length>0 &&
    c.interpretation.length<=1000 && Array.isArray(c.evidence) && c.evidence.length>0 &&
    c.evidence.length<=8 && c.evidence.every(id=>ids.has(id));
  if (!v || !properties.company.enum.includes(v.company) || !properties.valuation.enum.includes(v.valuation) ||
      !valid(v.rationale) || !valid(v.invalidation) || ![v.supporting,v.contrary,v.risks].every(list=>
        Array.isArray(list)&&list.length>0&&list.length<=4&&list.every(valid)) ||
      typeof v.ownershipCondition!=='string'||v.ownershipCondition.length>1000 ||
      typeof v.remainingRationale!=='string'||v.remainingRationale.length>1000 ||
      (permittedConditions.length>0 && (v.company==='weakened'||v.company==='invalidated') &&
        (!permittedConditions.includes(v.ownershipCondition) ||
          !v.contrary.some(c=>c.evidence.some(id=>!id.endsWith(':valuation_context'))) ||
          (v.company==='weakened'&&(!v.remainingRationale.trim()||!v.supporting.some(c=>c.interpretation===v.remainingRationale)))))) {
    throw new Error('The interpretation did not meet the evidence requirements.');
  }
  if(v.valuation==='favorable'&&![v.rationale,...v.supporting].some(c=>c.evidence.some(id=>id.endsWith(':valuation_context'))))
    throw new Error('Favorable valuation requires reviewed valuation evidence.');
  return v;
}
