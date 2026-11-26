import assert from 'node:assert/strict';
import {calcPlan} from './planner-core.mjs';
const p=calcPlan({quantity:2,runsPerJob:1,jobHours:3,materialCost:100,blueprintCost:50,facilityTax:10,salePrice:500,tax:5,broker:2});assert.equal(p.costMaterials,200);assert.equal(p.jobCost,275);assert.equal(p.revenue,1000);assert.equal(p.fees,70);assert.equal(p.profit,655);assert.equal(p.hours,6);
assert.throws(()=>calcPlan({quantity:-1}));assert.throws(()=>calcPlan({salePrice:Infinity}));
console.log('Legacy planner tests: PASS (8 assertions)');
