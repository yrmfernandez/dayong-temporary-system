/* Read-only: run the actual report builder, print only financial totals and staff IDs. */
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
const cache=new Map();
function load(file){
  file=path.resolve(file);
  if(!path.extname(file))file+='.ts';
  if(file.endsWith('.mjs'))return require(file);
  if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const localRequire=name=>name.startsWith('@/')?load(name.slice(2)):name.startsWith('.')?load(path.resolve(path.dirname(file),name)):require(name);
  new Function('require','module','exports',code)(localRequire,mod,mod.exports);
  return mod.exports;
}
(async()=>{
  const [employeeId,date,branch='']=process.argv.slice(2);
  if(!employeeId||!/^\d{4}-\d{2}-\d{2}$/.test(date??''))throw new Error('Supply employee ID and YYYY-MM-DD.');
  const {buildClerkReport}=load('lib/clerk-report.ts');
  const report=await buildClerkReport('daily',date,{employeeId,name:employeeId},branch);
  const result={date,branch:report.branch,employeeId,newSales:report.newSales,collections:report.collection,totals:report.totals,checks:report.checks};
  console.log(JSON.stringify(result,null,2));
  fs.writeFileSync('legacy-data/actual-clerk-report-'+date+'.json',JSON.stringify(result,null,2));
  process.exit(0);
})().catch(error=>{console.error(error.message);process.exit(1);});
