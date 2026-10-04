const {app,BrowserWindow,protocol,net,Menu}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {ensureOllama}=require('./ollama.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'yejian',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
if(process.env.YEJIAN_SMOKE==='1') app.setPath('userData',path.join(require('node:os').tmpdir(),'yejian-smoke-profile'));
let win;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function handle(request){
 const url=new URL(request.url);
 if(url.host!=='app') return new Response('Not found',{status:404});
 try{
  if(url.pathname==='/api/ollama-start' && request.method==='POST'){
   try { if(await ensureOllama()) return json({connected:true}); } catch { /* installation missing or unavailable */ }
   return json({error:'无法启动 Ollama，请安装并从系统菜单打开 Ollama 后重试。'},503);
  }
  if(url.pathname==='/api/ollama-status'){
   const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(2500)});return json({...await r.json(),connected:r.ok},r.status);
  }
  if(url.pathname==='/api/chat' && request.method==='POST'){
   const r=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:await request.text(),signal:request.signal});
   return new Response(r.body,{status:r.status,headers:{'Content-Type':r.headers.get('content-type')||'application/x-ndjson'}});
  }
  const root=path.join(__dirname,'../web');const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep))return new Response('Forbidden',{status:403});
  return net.fetch(pathToFileURL(file).href);
 }catch(e){return json({error:e.message},502);}
}
function createWindow(){
 win=new BrowserWindow({width:1440,height:960,minWidth:1000,minHeight:650,title:'页间',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('yejian://app/'))e.preventDefault();});
 if(process.env.YEJIAN_SMOKE==='1') {
  win.webContents.on('did-finish-load',async()=>{
   try {
    const result=await win.webContents.executeJavaScript(`(async()=>({title:document.title,pdf:!!(await import('./vendor/pdfjs/pdf.min.mjs')).getDocument,katex:!!window.katex,composer:!!document.querySelector('#questionInput')}))()`);
    console.log('SMOKE',JSON.stringify(result));app.exit(result.pdf&&result.katex&&result.composer?0:1);
   }catch(e){console.error(e);app.exit(1);}
  });
 }
 win.loadURL('yejian://app/');
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{win?.show();win?.focus();});
 app.whenReady().then(()=>{protocol.handle('yejian',handle);Menu.setApplicationMenu(Menu.buildFromTemplate([process.platform==='darwin'?{role:'appMenu'}:{label:'文件',submenu:[{role:'quit',label:'退出'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));createWindow();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)createWindow();});});
 app.on('window-all-closed',()=>app.quit());
}
