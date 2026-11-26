export function normalizeTables(tables){
  if(Array.isArray(tables)) return tables;
  if(tables && typeof tables==='object') return Object.entries(tables).map(([name,value])=> value && typeof value==='object' ? ({name,...value}) : ({name,value}));
  return [];
}
export function findTable(tables,name){
  return normalizeTables(tables).find(t=>String(t.name||t.table||t.id||'').toLowerCase()===name.toLowerCase()) || null;
}
export function tableJsonlUrl(table){return table?.jsonl?.url||table?.jsonl||table?.url||null}
export function parseJsonl(text){return String(text||'').split(/\r?\n/).filter(line=>line.trim()).map((line,i)=>{try{return JSON.parse(line)}catch(e){throw new Error(`Invalid JSONL row ${i+1}: ${e.message}`)}})}
export function typeName(record){let n=record?.name;return typeof n==='string'?n:(n?.en||record?.typeName||'')}
