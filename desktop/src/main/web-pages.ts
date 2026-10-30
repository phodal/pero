import {WebContentsView,dialog,session,type BrowserWindow,type Session,type Event as ElectronEvent} from 'electron';
import {createHash} from 'node:crypto';
import type {WebCommand,WebDocument,SurfaceBounds} from '../../../protocol/generated/host';
import {WebAddress} from '../../../packages/content-source/web-address.ts';
import {WebLocation,inlineHtml} from '../../../packages/content-source/web-location.ts';
import {WebSessions,restorePage,type WebPageState} from './web-sessions.ts';
type Event={version:1;kind:string;request_id:null;text:string;data?:unknown};
type Page={view:WebContentsView;document:WebDocument};

/** Browser engines own navigation; GPUI supplies selected sources and measured slots. */
export class WebPages {
  private pages=new Map<string,Page>();
  private html=new Map<string,string>();
  private partition:Session;
  private sessions:WebSessions;
  private loaded:Promise<void>;
  private permissions=new Set<string>();
  constructor(private window:BrowserWindow,private send:(event:Event)=>void,sessionPath:string) {
    this.sessions=new WebSessions(sessionPath);
    this.loaded=this.sessions.load().catch(error=>this.error(String(error)));
    this.partition=session.fromPartition('persist:pero-web-content');
    this.partition.protocol.handle('pero-html',request=>{
      const html=this.html.get(request.url);
      return html===undefined?new Response('HTML source is unavailable',{status:404}):
        new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"object-src 'none'"}});
    });
    const permissionKey=(origin:string,permission:string)=>{const url=URL.canParse(origin)?new URL(origin):undefined;return `${url?`${url.protocol}//${url.host}`:origin}|${permission}`;};
    this.partition.setPermissionCheckHandler((_contents,permission,origin)=>this.permissions.has(permissionKey(origin,permission)));
    this.partition.setPermissionRequestHandler((contents,permission,respond,details)=>{
      const page=[...this.pages.values()].find(page=>page.view.webContents===contents);
      if(!page){respond(false);return;}
      void dialog.showMessageBox(this.window,{type:'question',message:`Allow ${permission}?`,
        detail:details.requestingUrl||contents.getURL(),buttons:['Deny','Allow for this session'],defaultId:0,cancelId:0})
        .then(answer=>{if(answer.response===1)this.permissions.add(permissionKey(details.requestingUrl||contents.getURL(),permission));respond(answer.response===1);this.notice(page,answer.response===1?`${permission} allowed for this session`:`${permission} denied`);},()=>respond(false));
    });
    this.partition.setDisplayMediaRequestHandler((request,respond)=>{
      respond({});
      const page=[...this.pages.values()].find(page=>page.view.webContents.mainFrame===request.frame?.top);
      if(page)this.notice(page,'The operating-system screen picker is unavailable.');
    },{useSystemPicker:true});
    this.partition.on('will-download',(_event,item,contents)=>{
      const page=[...this.pages.values()].find(page=>page.view.webContents===contents);
      item.setSaveDialogOptions({title:'Save download',defaultPath:item.getFilename()});
      item.on('updated',()=>{if(page)this.notice(page,`Downloading ${item.getFilename()}: ${item.getReceivedBytes()} / ${item.getTotalBytes()} bytes`);});
      item.once('done',(_event,state)=>{if(page)this.notice(page,state==='completed'?`Saved ${item.getSavePath()}`:`Download ${state}`);});
    });
  }
  private error(text:string){this.send({version:1,kind:'web_error',request_id:null,text});}
  private notice(page:Page,text:string){page.document.observation.notice=text;this.emit('web_state',page);}
  private emit(kind:string,page:Page) {
    const contents=page.view.webContents;
    page.document.observation.can_back=contents.navigationHistory.canGoBack();
    page.document.observation.can_forward=contents.navigationHistory.canGoForward();
    this.send({version:1,kind,request_id:null,text:'',data:page.document});
  }
  private fail(page:Page,message:string) {page.document.observation.load={kind:'failed',message};this.emit('web_state',page);}
  private navigate(page:Page,address:WebAddress) {
    page.document.observation.url=address.text;
    page.document.observation.load={kind:'loading'};this.emit('web_state',page);
    if(page.view.getVisible()&&this.window.isVisible()&&this.window.isFocused())page.view.webContents.focus();
    void page.view.webContents.loadURL(address.text).catch(error=>{if(!page.view.webContents.isDestroyed()&&error.code!=='ERR_ABORTED')this.fail(page,error.message);});
  }
  private async open(document:WebDocument,restored=false) {
    const previous=this.pages.get(document.id);
    if(previous){this.emit(restored?'web_state':'web_opened',previous);return;}
    const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,session:this.partition}});
    view.setVisible(false);this.window.contentView.addChildView(view);
    const page:Page={view,document};this.pages.set(document.id,page);
    if(document.html){
      const url=`pero-html://${createHash('sha256').update(document.id).digest('hex')}/`;
      this.html.set(url,document.html.html);
      if(document.observation.url==='about:blank')document.observation.url=url;
    }
    const contents=view.webContents;
    let pageState:WebPageState|undefined;
    const observe=()=>{
      try {page.document.observation.url=WebLocation.parse(contents.getURL()||page.document.observation.url).text;}catch {return;}
      page.document.observation.title=contents.getTitle()||document.observation.title;this.emit('web_state',page);
    };
    contents.on('did-start-loading',()=>{page.document.observation.load={kind:'loading'};this.emit('web_state',page);});
    contents.on('did-finish-load',()=>{
      if(page.document.observation.load.kind!=='failed')page.document.observation.load={kind:'ready'};
      observe();
      if(pageState){const state=pageState;pageState=undefined;void contents.executeJavaScript(`(${restorePage.toString()})(${JSON.stringify(state)})`).catch(error=>this.notice(page,`Page state could not be restored: ${String(error)}`));}
    });
    contents.on('did-navigate',(_event,_url,status)=>{if(status>=400)this.fail(page,`HTTP ${status}`);observe();});
    contents.on('did-navigate-in-page',observe);contents.on('page-title-updated',observe);
    contents.on('did-fail-load',(_event,code,message,_url,main)=>{if(main&&code!==-3)this.fail(page,message);});
    contents.on('render-process-gone',(_event,details)=>this.fail(page,details.reason));
    contents.on('before-input-event',(event,input)=>{
      if(input.type==='keyDown'&&(input.meta||input.control)&&!input.alt&&!input.shift&&input.key.toLowerCase()==='l') {
        event.preventDefault();if(this.window.isFocused())this.window.webContents.focus();this.send({version:1,kind:'web_choose',request_id:null,text:''});
      }
    });
    const navigation=(event:ElectronEvent,url:string)=>{
      try {WebAddress.parse(url);}catch {event.preventDefault();this.notice(page,'This navigation is unavailable. Use an HTTP or HTTPS address.');}
    };
    contents.on('will-navigate',navigation);contents.on('will-redirect',navigation);
    contents.setWindowOpenHandler(({url})=>{
      try {const address=WebAddress.parse(url);void this.open(this.urlDocument(address));}
      catch {this.notice(page,'This popup cannot be opened as an HTTP or HTTPS page.');}
      return {action:'deny'};
    });
    this.emit(restored?'web_state':'web_opened',page);
    await this.loaded;
    if(contents.isDestroyed())return;
    const saved=restored?this.sessions.get(document.id):undefined;
    if(saved){
      pageState=saved.page;
      await contents.navigationHistory.restore({entries:saved.entries,index:saved.index}).catch(error=>this.fail(page,`Browser history could not be restored: ${String(error)}`));
    } else {
      await contents.loadURL(document.observation.url).catch(error=>{if(!contents.isDestroyed()&&error.code!=='ERR_ABORTED')this.fail(page,error.message);});
    }
  }
  private urlDocument(address:WebAddress):WebDocument {
    return {id:address.text,observation:{url:address.text,title:address.title,load:{kind:'loading'},can_back:false,can_forward:false}};
  }
  private surface(id:string|null,bounds?:SurfaceBounds) {
    for(const [source,page] of this.pages) {
      const visible=source===id&&!!bounds&&bounds.width>0&&bounds.height>0;
      if(visible)page.view.setBounds({x:Math.round(bounds!.x),y:Math.round(bounds!.y),width:Math.round(bounds!.width),height:Math.round(bounds!.height)});
      const wasVisible=page.view.getVisible();page.view.setVisible(visible);
      if(visible&&!wasVisible&&this.window.isVisible()&&this.window.isFocused())page.view.webContents.focus();
    }
  }
  async checkpoint(){await this.sessions.save(new Map([...this.pages].map(([id,page])=>[id,page.view.webContents])));}
  async command(input:unknown) {
    // Only trusted renderer transport reaches this entry. Pages have no preload/IPC.
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid Web command');
    const value=input as Record<string,unknown>,action=value.action;
    if(typeof action!=='string'||!['web_open','web_html','web_restore','web_navigate','web_back','web_forward','web_reload','web_close','web_surface'].includes(action))throw new Error('Invalid Web action');
    const keys=action==='web_html'?['action','source']:action==='web_open'?['action','url']:action==='web_restore'?['action','id','url','html']:action==='web_navigate'?['action','id','url']:action==='web_surface'?['action','id','bounds']:['action','id'];
    if(Object.keys(value).some(key=>!keys.includes(key))||(action==='web_open'||action==='web_restore'||action==='web_navigate')&&typeof value.url!=='string'||action!=='web_open'&&action!=='web_html'&&!(typeof value.id==='string'||action==='web_surface'&&value.id===null))throw new Error('Invalid Web command');
    if(action==='web_surface'&&value.bounds!==undefined){const bounds=value.bounds as Record<string,unknown>;if(!bounds||typeof bounds!=='object'||Object.keys(bounds).length!==4||!['x','y','width','height'].every(key=>typeof bounds[key]==='number'&&Number.isFinite(bounds[key]))||Number(bounds.width)<0||Number(bounds.height)<0)throw new Error('Invalid Web geometry');}
    const command=value as unknown as WebCommand;
    if(command.action==='web_open'){await this.open(this.urlDocument(WebAddress.parse(command.url)));return;}
    if(command.action==='web_html'){
      const html=inlineHtml(command.source);await this.open({id:`html:${html.id}`,html,observation:{url:'about:blank',title:html.title,load:{kind:'loading'},can_back:false,can_forward:false}});return;
    }
    if(command.action==='web_restore'){
      const html=command.html?inlineHtml(command.html):undefined;
      if(html&&command.id!==`html:${html.id}`)throw new Error('HTML source identity changed');
      const document=html?{id:command.id,html,observation:{url:WebLocation.parse(command.url).text,title:html.title,load:{kind:'loading' as const},can_back:false,can_forward:false}}:this.urlDocument(WebAddress.parse(command.id));
      if(!html)document.observation.url=WebAddress.parse(command.url).text;
      await this.open(document,true);return;
    }
    if(command.action==='web_surface'){this.surface(command.id,command.bounds);return;}
    const page=this.pages.get(command.id);if(!page)throw new Error('The Web page is closed');
    if(command.action==='web_navigate'){this.navigate(page,WebAddress.parse(command.url));return;}
    const history=page.view.webContents.navigationHistory;
    if(command.action==='web_back'&&history.canGoBack())history.goBack();
    if(command.action==='web_forward'&&history.canGoForward())history.goForward();
    if(command.action==='web_reload')page.view.webContents.reload();
    if(command.action==='web_close') {
      this.window.contentView.removeChildView(page.view);page.view.webContents.close();this.pages.delete(command.id);
      if(page.document.html)this.html.delete(`pero-html://${createHash('sha256').update(command.id).digest('hex')}/`);
      this.send({version:1,kind:'web_closed',request_id:null,text:'',data:{id:command.id}});
    }
  }
  dispose() {for(const page of this.pages.values()){if(!this.window.isDestroyed())this.window.contentView.removeChildView(page.view);if(!page.view.webContents.isDestroyed())page.view.webContents.close();}this.pages.clear();this.html.clear();this.permissions.clear();this.partition.protocol.unhandle('pero-html');}
}
