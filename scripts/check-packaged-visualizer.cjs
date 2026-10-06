const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const AdmZip = require('adm-zip');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const projectRoot = path.join(__dirname, '..');
const packageVersion = require(path.join(projectRoot, 'package.json')).version;
const requestedRoot = path.resolve(process.argv[2] || path.join(projectRoot, `jobline-gcode-${packageVersion}.vsix`));
let extractedRoot = '';
let root = requestedRoot;
if (/\.vsix$/i.test(requestedRoot)) {
  extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobline-vsix-check-'));
  new AdmZip(requestedRoot).extractAllTo(extractedRoot, true);
  root = path.join(extractedRoot, 'extension');
}
const missingModule = process.argv.includes('--missing-three');
const browserCandidates = process.platform === 'win32' ? [
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
] : [];
const installedBrowser = browserCandidates.find(candidate => candidate && fs.existsSync(candidate));
(async () => {
  // Exercise the installed runtime so packaging exclusions cannot hide behind dev dependencies.
  for (const file of ['package.json', 'dist/occt-import-js.js', 'dist/occt-import-js.wasm', 'LICENSE.md', 'dist/license.occt.txt', 'dist/license.occt-import-js.txt']) {
    if (!fs.existsSync(path.join(root, 'node_modules/occt-import-js', file))) {
      throw new Error(`Packaged STEP runtime missing: ${file}`);
    }
  }
  const { tessellateSTEP } = require(path.join(root, 'out/src/providers/visualizer/stepTessellator.js'));
  const step = await tessellateSTEP(fs.readFileSync(path.join(projectRoot, 'test/fixtures/step/box.step')));
  if (step.triangleCount < 12 || step.meshVertices.length !== step.triangleCount * 9 ||
      !Object.values(step.bounds).every(Number.isFinite) || step.bounds.maxX <= step.bounds.minX) {
    throw new Error('Packaged STEP runtime produced invalid geometry');
  }
  console.log(JSON.stringify({ packagedStepTriangles: step.triangleCount, bounds: step.bounds }));
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      const html = fs.readFileSync(path.join(root, 'media/toolpathVisualizerWebview.html'), 'utf8')
        .replaceAll('{{CSP_SOURCE}}', "'self'").replaceAll('{{THREE_JS_URI}}', '/three.min.js');
      res.setHeader('Content-Type', 'text/html'); res.end(html); return;
    }
    if (!['/three.min.js','/three.core.min.js'].includes(req.url)) {res.writeHead(404);res.end();return;}
    if (missingModule) {res.writeHead(404);res.end();return;}
    try { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync(path.join(root,'media',req.url.slice(1)))); }
    catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || installedBrowser || undefined,
    args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  });
  try {
    for (const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:900}}), errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{window.__messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__messages.push(m),getState:()=>null,setState:()=>{}});});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      if (missingModule) {
        await page.waitForFunction(()=>document.getElementById('three-error')?.style.display === 'block');
        const message=await page.locator('#three-error-detail').innerText();
        if(!message.includes('could not load')) throw new Error('Missing bundle did not report a useful error');
        console.log(JSON.stringify({width,missingModuleReported:true,message}));
        await page.close(); continue;
      }
      await page.waitForFunction(()=>window.__messages.some(m=>m.type==='webviewReady'));
      const parser=require(path.join(root,'out/src/providers/visualizer/toolpathParser.js'));
      const justinArchive=process.env.JOBLINE_JUSTIN_F3D || 'C:/Users/zach/Downloads/Drawing1.f3d';
      const hasJustin=fs.existsSync(justinArchive);
      const program=fs.readFileSync(path.join(__dirname, hasJustin ? '../test/fixtures/diagnostics/issue-3-fusion-g18.nc' : '../test/fixtures/diagnostics/clean-mill.nc'),'utf8');
      const parsed=parser.parseGCodeToPath(program);
      await page.evaluate(data=>window.postMessage({type:'update',path:data.path,units:data.units},'*'),parsed);
      if (hasJustin) {
        const fusion=require(path.join(root,'out/src/providers/visualizer/fusionArchiveParser.js'));
        const setup=fusion.parseFusionSetupArchive(fs.readFileSync(justinArchive));
        await page.evaluate(({setup})=>{
          window.postMessage({type:'stockSettings',w:setup.stock.width,d:setup.stock.depth,h:setup.stock.height,unit:'mm',color:'#4488ff'},'*');
          window.postMessage({type:'stockOrigin',xOff:-setup.stock.sideAllowance,yOff:-setup.stock.sideAllowance,zOff:setup.stock.topAllowance-setup.stock.height},'*');
          window.postMessage({type:'targetModel',id:'fusion-model-envelope',targetId:'target-part',role:'target-part',displayMode:'transparent',opacity:0.22,name:'Fusion model dimensional envelope',format:'Fusion CAM model bounds (mm)',bounds:{minX:0,maxX:setup.model.width,minY:0,maxY:setup.model.depth,minZ:-setup.model.height,maxZ:0},offset:{x:0,y:0,z:0}},'*');
          window.postMessage({type:'toolData',data:{toolNumber:1,type:'Flat End Mill',diameter:6,stickOut:25,length:37,color:'#e07010'}},'*');
        },{setup});
      }
      await page.waitForTimeout(1800);
      await page.evaluate(()=>window.postMessage({type:'requestVisualProbe'},'*'));
      await page.waitForFunction(()=>window.__messages.some(m=>m.type==='visualProbe'));
      const state=await page.evaluate(()=>({canvas:document.querySelectorAll('canvas').length,errors:document.getElementById('three-error-detail')?.textContent,messages:window.__messages}));
      console.log(JSON.stringify({root,width,...state,pageErrors:errors}));
      fs.mkdirSync(path.join(__dirname,'../reports'),{recursive:true});
      await page.screenshot({path:path.join(__dirname,`../reports/packaged-visualizer-${width}.png`)});
      const probe=state.messages.findLast(m=>m.type==='visualProbe');
      const packagedSetupOk=!hasJustin || (
        probe?.targetLoaded === true &&
        Math.abs((probe.stock?.w || 0) - 79.727922061357845) < 1e-6 &&
        Math.abs((probe.stockOrigin?.x || 0) + 1) < 1e-6 &&
        Math.abs(((probe.activeTargetBounds?.maxX || 0) - (probe.activeTargetBounds?.minX || 0)) - 77.727922061357845) < 1e-6 &&
        probe?.activeToolNumber === 1 && Math.abs((probe?.toolDiameter || 0) - 6) < 1e-6 && probe?.toolVisible === true
      );
      if(errors.length||!state.canvas||probe?.pathPoints!==parsed.path.length||!(probe?.litPixels>0)||!packagedSetupOk) process.exitCode=1;
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
    if (extractedRoot) fs.rmSync(extractedRoot, { recursive: true, force: true });
  }
})().catch(e=>{
  if (extractedRoot) fs.rmSync(extractedRoot, { recursive: true, force: true });
  console.error(e);process.exitCode=1;
});
