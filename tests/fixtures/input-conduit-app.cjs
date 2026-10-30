const {app,BrowserWindow}=require('electron');
if(process.env.PERO_TEST_BACKGROUND!=='1')throw new Error('Input conduit fixture requires a hidden test window');
if(process.platform==='darwin')app.setActivationPolicy('accessory');
app.whenReady().then(()=>{
  const window=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{backgroundThrottling:false}});
  window.loadURL('data:text/html,<html><body></body></html>');
});
app.on('window-all-closed',()=>app.quit());
