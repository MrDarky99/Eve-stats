import assert from 'node:assert/strict';
import {materialQty,calcIndustryPlan,flattenBlueprints,buildRecipeIndex,recursiveRequirements} from './industry-core.mjs';
assert.equal(materialQty(100,2,10),180);assert.equal(materialQty(1,1,10),1);assert.equal(materialQty(0,5,10),0);assert.equal(materialQty(10,3,10,10),25);
assert.throws(()=>materialQty(-1,1));assert.throws(()=>materialQty(5,1,11));
const p=calcIndustryPlan({materials:[{id:1,qty:10,unitPrice:100}],outputPerRun:2,runs:3,sellPrice:1000,systemIndex:4,facilityTax:10,salesTax:4.5,brokerFee:3,jobSecondsPerRun:3600,timeEfficiency:20});assert.equal(p.output,6);assert.equal(p.materialCost,1000);assert.equal(p.jobCost,44);assert.equal(p.gross,6000);assert.equal(p.fees,450);assert.equal(p.net,4506);assert.equal(p.timeHours,2.4);assert.equal(p.profitPerHour,1877.5);
assert.throws(()=>calcIndustryPlan({runs:0}));assert.throws(()=>calcIndustryPlan({salesTax:-1}));
const recs=[{blueprintTypeID:10,activities:{manufacturing:{products:[{typeID:100,quantity:2}],materials:[{typeID:200,quantity:5}],time:3600}}},{blueprintTypeID:20,activities:{manufacturing:{products:[{typeID:200,quantity:1}],materials:[{typeID:300,quantity:3}],time:1200}}}];const flat=flattenBlueprints(recs),idx=buildRecipeIndex(flat);const req=recursiveRequirements(100,4,idx);assert.deepEqual(req.requirements,[{id:'300',qty:30}]);assert.deepEqual(recursiveRequirements(100,4,idx,{owned:{300:5}}).requirements,[{id:'300',qty:25}]);
console.log('Industry core tests: PASS (11 assertions)');
