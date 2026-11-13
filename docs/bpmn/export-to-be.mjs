// Локальне збирання артефактів: XML -> bpmn-js -> SVG; без зовнішніх сторінок.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const [modules, chrome, qaOutput] = process.argv.slice(2);
if (!modules || !chrome) throw new Error('Використання: node docs/bpmn/export-to-be.mjs /node_modules /chrome [QA-каталог PNG]');
const require = createRequire(resolve(modules,'../package.json'));
const {chromium} = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
if(qaOutput) await mkdir(qaOutput,{recursive:true});
const browser = await chromium.launch({executablePath:chrome,headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.setContent('<div id="canvas" style="width:100vw;height:100vh"></div>');
 await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});
 const xml=await readFile(resolve(here,'to-be.bpmn'),'utf8');
 const result=await page.evaluate(async xml=>{
   const modeler=new BpmnJS({container:'#canvas',textRenderer:{defaultStyle:{fontFamily:'Arial',fontSize:14},externalStyle:{fontFamily:'Arial',fontSize:14}}});
   const first=await modeler.importXML(xml);
   const {xml:roundTrip}=await modeler.saveXML({format:true});
   const second=await modeler.importXML(roundTrip);
   const exports=[];
   for(const d of modeler.getDefinitions().diagrams) {
     const opened=await modeler.open(d);
     const {svg}=await modeler.saveSVG();
     const registry=modeler.get('elementRegistry');
     const visibleRoot=modeler.get('canvas').getRootElement();
     const all=registry.getAll().filter(e=>{
       let top=e;
       while(top.parent) top=top.parent;
       return top===visibleRoot;
     });
     const labels=all.filter(e=>e.type==='label');
     const textBounds=labels.map(l=>{
       const b=registry.getGraphics(l).querySelector('.djs-visual').getBBox();
       return {id:l.id,x:l.x+b.x,y:l.y+b.y,width:b.width,height:b.height};
     });
     const shapes=all.filter(e=>!e.waypoints && !['label','bpmn:Participant','bpmn:Lane','bpmn:Process'].includes(e.type));
     const labelOverlaps=[];
     for(let i=0;i<textBounds.length;i++) for(let j=i+1;j<textBounds.length;j++) {
       const a=textBounds[i],b=textBounds[j];
       const dx=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
       const dy=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
       if(dx>2 && dy>2) labelOverlaps.push({label:a.id,otherLabel:b.id,dx,dy});
     }
     for(const l of labels) for(const s of shapes) {
       if(l.labelTarget===s) continue;
       const b=registry.getGraphics(l).querySelector('.djs-visual').getBBox();
       const x=l.x+b.x, y=l.y+b.y;
       const dx=Math.min(x+b.width,s.x+s.width)-Math.max(x,s.x);
       const dy=Math.min(y+b.height,s.y+s.height)-Math.max(y,s.y);
       if(dx>3 && dy>3) labelOverlaps.push({label:l.id,shape:s.id,dx,dy});
     }
     exports.push({name:d.name,svg,warnings:opened.warnings.map(x=>x.message),labelOverlaps});
   }
   return {firstWarnings:first.warnings.map(x=>x.message),roundTripWarnings:second.warnings.map(x=>x.message),exports};
 },xml);
 assert.deepEqual(result.firstWarnings,[]);
 assert.deepEqual(result.roundTripWarnings,[]);
 const overlaps=result.exports.flatMap(e=>e.labelOverlaps.map(o=>({diagram:e.name,...o})));
 assert.deepEqual(overlaps,[],JSON.stringify(overlaps));
 const summary=[];
 for(const e of result.exports) {
   assert.deepEqual(e.warnings,[],e.name);
   const file=e.name==='overview'?'to-be':'to-be-'+e.name;
   await writeFile(resolve(here,file+'.svg'),e.svg);
   if(qaOutput) {
     const p=await browser.newPage({viewport:{width:3300,height:1700},deviceScaleFactor:1});
     await p.setContent('<html><body style="margin:0;background:white">'+e.svg+'</body></html>');
     const b=await p.locator('svg').boundingBox();
     await p.screenshot({path:resolve(qaOutput,file+'.png'),clip:{x:0,y:0,width:Math.ceil(b.width),height:Math.ceil(b.height)}});
     await p.close();
   }
   summary.push({name:e.name,warnings:e.warnings.length,labelOverlaps:e.labelOverlaps.length,svgBytes:e.svg.length});
 }
 console.log(JSON.stringify({firstWarnings:0,roundTripWarnings:0,exports:summary},null,2));
} finally {await browser.close();}
