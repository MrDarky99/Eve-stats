// Legacy manual-planner calculation, retained for the existing UI.
export function calcPlan({product,quantity,runsPerJob=1,jobHours=0,materialCost=0,blueprintCost=0,facilityTax=0,me=0,te=0,salePrice=0,tax=0,broker=0,items=[]}={}){
 const num=(v,n)=>{const x=Number(v??0);if(!Number.isFinite(x)||x<0)throw new RangeError(`${n} must be a finite non-negative number`);return x};
 const q=Math.max(1,Math.floor(num(quantity,'quantity'))),r=Math.max(1,Math.floor(num(runsPerJob,'runsPerJob'))),hours=num(jobHours,'jobHours'),mat=num(materialCost,'materialCost')*q,bpc=num(blueprintCost,'blueprintCost'),fac=num(facilityTax,'facilityTax'),sale=num(salePrice,'salePrice'),sales=num(tax,'tax'),fee=num(broker,'broker');
 const itemCost=(items||[]).reduce((s,i)=>s+num(i.quantity,'item quantity')*num(i.unitCost,'item unit cost')*q,0),costMaterials=mat+itemCost,jobCost=costMaterials+bpc+(costMaterials+bpc)*fac/100,revenue=q*sale,fees=revenue*(sales+fee)/100,profit=revenue-fees-jobCost;
 return {product,q,costMaterials,bpc,jobCost,revenue,fees,profit,margin:revenue?profit/revenue:0,roi:jobCost?profit/jobCost:0,hours:hours*q/r,items};
}
