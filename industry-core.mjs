// Pure calculation helpers for EVE Ledger industry planning. No DOM or network dependencies.
export function materialQty(basePerRun, runs, me=0, facilityReduction=0) {
  const base=Number(basePerRun), n=Number(runs), efficiency=Number(me), bonus=Number(facilityReduction);
  if (![base,n,efficiency,bonus].every(Number.isFinite) || base<0 || n<1 || efficiency<0 || efficiency>10 || bonus<0 || bonus>100) throw new RangeError('Invalid material calculation inputs');
  if(base===0) return 0;
  // EVE's industry material rounding: apply percentage reductions, round up, minimum one unit.
  return Math.max(1,Math.ceil(base*n*(1-efficiency/100)*(1-bonus/100)));
}
export function calcIndustryPlan({materials=[],outputPerRun=1,runs=1,sellPrice=0,systemIndex=0,facilityTax=0,salesTax=0,brokerFee=0,jobSecondsPerRun=0,timeEfficiency=0,facilityTimeBonus=0,ownedMaterials={}}={}) {
 const numeric=[outputPerRun,runs,sellPrice,systemIndex,facilityTax,salesTax,brokerFee,jobSecondsPerRun,timeEfficiency,facilityTimeBonus];
 if(!numeric.every(x=>Number.isFinite(Number(x)))) throw new TypeError('All plan inputs must be finite numbers');
 if(outputPerRun<=0||runs<1||sellPrice<0||systemIndex<0||facilityTax<0||salesTax<0||brokerFee<0||jobSecondsPerRun<0||timeEfficiency<0||timeEfficiency>20||facilityTimeBonus<0||facilityTimeBonus>100) throw new RangeError('Plan input outside allowed range');
 const rows=materials.map(m=>{const qty=Math.max(0,Math.ceil(Number(m.qty)||0)),unitPrice=Math.max(0,Number(m.unitPrice)||0),owned=Math.max(0,Number(ownedMaterials[m.id]??m.owned??0)||0),short=Math.max(0,qty-owned);return {...m,qty,unitPrice,owned,short,cost:short*unitPrice}});
 const materialCost=rows.reduce((s,m)=>s+m.cost,0),output=outputPerRun*runs,gross=output*sellPrice,fees=gross*(salesTax+brokerFee)/100,jobCost=materialCost*(systemIndex/100)*(1+facilityTax/100),totalCost=materialCost+jobCost,net=gross-fees-totalCost,timeHours=jobSecondsPerRun*runs*(1-timeEfficiency/100)*(1-facilityTimeBonus/100)/3600;
 return {rows,output,runs,materialCost,jobCost,totalCost,gross,fees,net,margin:gross?net/gross:0,roi:totalCost?net/totalCost:0,timeHours,profitPerHour:timeHours?net/timeHours:null};
}
export function flattenBlueprints(records,typeNames={}) {const list=[];for(const b of records||[]){const act=b.activities?.manufacturing;if(!act?.products?.length)continue;const bpId=b.blueprintTypeID??b._key??b.typeID;for(const p of act.products){list.push({blueprintId:bpId,productId:p.typeID,productQty:p.quantity||1,productName:typeNames[p.typeID]||String(p.typeID),blueprintName:typeNames[bpId]||String(bpId),materials:act.materials||[],timeSeconds:act.time||0,activity:act});}}return list;}
export function buildRecipeIndex(flat){const byProduct=new Map();for(const r of flat){if(!byProduct.has(String(r.productId)))byProduct.set(String(r.productId),r);}return byProduct;}
export function recursiveRequirements(productId,runs,index,{me=0,facilityReduction=0,owned={},depthLimit=12}={}) {const totals=new Map(),warnings=[];function visit(id,runCount,depth){if(depth>depthLimit){warnings.push(`Depth limit reached at type ${id}`);return;}const recipe=index.get(String(id));if(!recipe){totals.set(String(id),(totals.get(String(id))||0)+runCount);return;}const output=Math.max(1,recipe.productQty||1),bpRuns=Math.ceil(runCount/output);for(const m of recipe.materials||[]){const q=materialQty(m.quantity,bpRuns,me,facilityReduction);if(index.has(String(m.typeID)))visit(m.typeID,q,depth+1);else totals.set(String(m.typeID),(totals.get(String(m.typeID))||0)+q);}}visit(productId,runs,0);for(const [id,q] of totals)totals.set(id,Math.max(0,q-(Number(owned[id])||0)));return {requirements:[...totals.entries()].map(([id,qty])=>({id,qty})).filter(x=>x.qty>0),warnings};}
