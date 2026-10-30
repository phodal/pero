import {WebContentsView,type BrowserWindow} from 'electron';
import type {WebCommand,WebDocument,SurfaceBounds} from '../../../protocol/generated/host';
import {WebAddress} from '../../../packages/content-source/web-address.ts';
type Event={version:1;kind:string;request_id:null;text:string;data?:unknown};
type Page={view:WebContentsView;document:WebDocument};

/** Browser engines own navigation; GPUI supplies the selected source and measured slot. */
export class WebPages {
  private pages=new Map<string,Page>();
  constructor(privateWindow:BrowserWindow,privateSend:(event:Event)=>void) {this.window=privateWindow;this.send=privateSend;}
  private window:BrowserWindow;
  private send:(event:Event)=>void;
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
    if(this.window.isVisible()&&this.window.isFocused())page.view.webContents.focus();
    void page.view.webContents.loadURL(address.text).catch(error=>{if(!page.view.webContents.isDestroyed()&&error.code!=='ERR_ABORTED')this.fail(page,error.message);});
  }
  private open(address:WebAddress) {
    const previous=this.pages.get(address.text);
    if(previous){this.emit('web_opened',previous);return;}
    const view=new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'persist:pero-web-content'}});
    view.setVisible(false);this.window.contentView.addChildView(view);
    const page:Page={view,document:{id:address.text,observation:{url:address.text,title:address.title,load:{kind:'loading'},can_back:false,can_forward:false}}};
    this.pages.set(address.text,page);
    const contents=view.webContents;
    contents.session.setPermissionRequestHandler((_contents,_permission,respond)=>respond(false));
    const observe=()=>{
      try {page.document.observation.url=WebAddress.parse(contents.getURL()||address.text).text;}catch {return;}
      page.document.observation.title=contents.getTitle()||address.title;this.emit('web_state',page);
    };
    contents.on('did-start-loading',()=>{page.document.observation.load={kind:'loading'};this.emit('web_state',page);});
    contents.on('did-finish-load',()=>{if(page.document.observation.load.kind!=='failed')page.document.observation.load={kind:'ready'};observe();});
    contents.on('did-navigate',(_event,_url,status)=>{if(status>=400)this.fail(page,`HTTP ${status}`);observe();});
    contents.on('did-navigate-in-page',observe);contents.on('page-title-updated',observe);
    contents.on('did-fail-load',(_event,code,message,_url,main)=>{if(main&&code!==-3)this.fail(page,message);});
    contents.on('render-process-gone',(_event,details)=>this.fail(page,details.reason));
    contents.on('before-input-event',(event,input)=>{
      if(input.type==='keyDown'&&(input.meta||input.control)&&!input.alt&&!input.shift&&input.key.toLowerCase()==='l') {
        event.preventDefault();if(this.window.isFocused())this.window.webContents.focus();this.send({version:1,kind:'web_choose',request_id:null,text:''});
      }
    });
    contents.on('will-navigate',(event,url)=>{try {WebAddress.parse(url);}catch {event.preventDefault();this.fail(page,'This page cannot navigate outside HTTP and HTTPS.');}});
    contents.on('will-redirect',(event,url)=>{try {WebAddress.parse(url);}catch {event.preventDefault();this.fail(page,'This redirect is not a Web address.');}});
    contents.setWindowOpenHandler(({url})=>{try {this.navigate(page,WebAddress.parse(url));}catch(error){this.fail(page,error instanceof Error?error.message:String(error));}return {action:'deny'};});
    this.emit('web_opened',page);this.navigate(page,address);
  }
  private surface(id:string|null,bounds?:SurfaceBounds) {
    for(const [source,page] of this.pages) {
      const visible=source===id&&!!bounds&&bounds.width>0&&bounds.height>0;
      if(visible)page.view.setBounds({x:Math.round(bounds!.x),y:Math.round(bounds!.y),width:Math.round(bounds!.width),height:Math.round(bounds!.height)});
      const wasVisible=page.view.getVisible();page.view.setVisible(visible);
      if(visible&&!wasVisible&&this.window.isVisible()&&this.window.isFocused())page.view.webContents.focus();
    }
  }
  command(input:unknown) {
    // This is the renderer transport entry. Page code has no preload or IPC bridge.
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid Web command');
    const value=input as Record<string,unknown>,action=value.action;
    if(typeof action!=='string'||!['web_open','web_navigate','web_back','web_forward','web_reload','web_close','web_surface'].includes(action))throw new Error('Invalid Web action');
    const keys=action==='web_open'?['action','url']:action==='web_navigate'?['action','id','url']:action==='web_surface'?['action','id','bounds']:['action','id'];
    if(Object.keys(value).some(key=>!keys.includes(key))||(action==='web_open'||action==='web_navigate')&&typeof value.url!=='string'||action!=='web_open'&&!(typeof value.id==='string'||action==='web_surface'&&value.id===null))throw new Error('Invalid Web command');
    if(action==='web_surface'&&value.bounds!==undefined){const bounds=value.bounds as Record<string,unknown>;if(!bounds||typeof bounds!=='object'||Object.keys(bounds).length!==4||!['x','y','width','height'].every(key=>typeof bounds[key]==='number'&&Number.isFinite(bounds[key]))||Number(bounds.width)<0||Number(bounds.height)<0)throw new Error('Invalid Web geometry');}
    const command=value as unknown as WebCommand;
    if(command.action==='web_open'){this.open(WebAddress.parse(command.url));return;}
    if(command.action==='web_surface'){this.surface(command.id,command.bounds);return;}
    const page=this.pages.get(command.id);if(!page)throw new Error('The Web page is closed');
    if(command.action==='web_navigate'){this.navigate(page,WebAddress.parse(command.url));return;}
    const history=page.view.webContents.navigationHistory;
    if(command.action==='web_back'&&history.canGoBack())history.goBack();
    if(command.action==='web_forward'&&history.canGoForward())history.goForward();
    if(command.action==='web_reload')page.view.webContents.reload();
    if(command.action==='web_close') {
      this.window.contentView.removeChildView(page.view);page.view.webContents.close();this.pages.delete(command.id);
      this.send({version:1,kind:'web_closed',request_id:null,text:'',data:{id:command.id}});
    }
  }
  dispose() {for(const page of this.pages.values()){if(!this.window.isDestroyed())this.window.contentView.removeChildView(page.view);page.view.webContents.close();}this.pages.clear();}
}
