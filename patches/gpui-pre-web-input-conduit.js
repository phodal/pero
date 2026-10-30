// The same complete text/UTF-16 selection contract has two browser backends.
// EditContext owns the OS edit buffer; canvas fallback text exposes accessible
// content without asking a hidden textarea to lay out every selected line.
export class InputConduit {
  static [Symbol.hasInstance](value) { return value?.hasAttribute?.('data-gpui-input'); }
  constructor(document,touchInput) {
    if(touchInput||typeof globalThis.EditContext!=='function') {
      const input=document.createElement('textarea');
      input.setAttribute('data-gpui-input','textarea');
      input.updateControlBounds=()=>{};
      input.updateCharacterBounds=()=>{};
      input.dispose=()=>{};
      return input;
    }
    const host=document.createElement('canvas');
    host.width=host.height=1;
    host.setAttribute('data-gpui-input','edit-context');
    host.setAttribute('role','textbox');
    host.setAttribute('aria-label','Text editor');
    host.setAttribute('aria-multiline','true');
    host.tabIndex=-1;
    const accessible=document.createElement('span');
    host.append(accessible);
    const context=new EditContext();
    host.editContext=context;
    let readOnly=false,composing=false,compositionStart=0,compositionEnd=0;
    let baselineText='',baselineStart=0,baselineEnd=0;
    let characterRequest;
    const requestCharacterBounds=()=>{
      if(characterRequest)host.dispatchEvent(new CustomEvent('gpui-characterboundsupdate',{detail:characterRequest}));
    };
    const remember=()=>{baselineText=context.text;baselineStart=context.selectionStart;baselineEnd=context.selectionEnd;};
    const expose=()=>{if(accessible.textContent!==context.text)accessible.textContent=context.text;};
    Object.defineProperties(host,{
      value:{get:()=>context.text,set:text=>{context.updateText(0,context.text.length,text);expose();remember();}},
      selectionStart:{get:()=>context.selectionStart},
      selectionEnd:{get:()=>context.selectionEnd},
      readOnly:{get:()=>readOnly,set:value=>{if(value!==readOnly)remember();readOnly=value;host.setAttribute('aria-readonly',String(value));}},
    });
    host.setSelectionRange=(start,end)=>{context.updateSelection(start,end);remember();};
    host.updateControlBounds=(x,y,width,height)=>{
      const bounds=new DOMRect(x,y,width,height);
      context.updateControlBounds(bounds);
      context.updateSelectionBounds(bounds);
      // GPUI temporarily takes its input handler while publishing geometry.
      // Re-query after that call stack restores it, using the new layout.
      if(characterRequest)queueMicrotask(requestCharacterBounds);
    };
    host.updateCharacterBounds=(start,bounds)=>{
      context.updateCharacterBounds(start,bounds);
      if(characterRequest?.start===start&&bounds.length>=characterRequest.end-start)characterRequest=undefined;
    };
    host.dispose=()=>{characterRequest=undefined;host.editContext=null;};
    context.addEventListener('characterboundsupdate',event=>{
      characterRequest={start:event.rangeStart,end:event.rangeEnd};requestCharacterBounds();
    });
    context.addEventListener('compositionstart',()=>{
      if(readOnly)return;
      composing=true;compositionStart=Math.min(context.selectionStart,context.selectionEnd);
      compositionEnd=Math.max(context.selectionStart,context.selectionEnd);
      host.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    });
    context.addEventListener('textupdate',event=>{
      if(readOnly) {
        context.updateText(0,context.text.length,baselineText);
        context.updateSelection(baselineStart,baselineEnd);
        return;
      }
      expose();
      if(composing) {
        compositionStart=Math.min(compositionStart,event.updateRangeStart);
        compositionEnd=Math.max(event.updateRangeStart+event.text.length,
          compositionEnd+event.text.length-(event.updateRangeEnd-event.updateRangeStart));
        const update=new CompositionEvent('compositionupdate',{
          bubbles:true,data:context.text.slice(compositionStart,compositionEnd),
        });
        Object.defineProperties(update,{
          gpuiSelectionStart:{value:context.selectionStart-compositionStart},
          gpuiSelectionEnd:{value:context.selectionEnd-compositionStart},
        });
        host.dispatchEvent(update);
      } else {
        host.dispatchEvent(new InputEvent('input',{bubbles:true,data:event.text,inputType:'insertText'}));
        document.dispatchEvent(new Event('selectionchange'));
      }
    });
    context.addEventListener('compositionend',event=>{
      if(readOnly)return;
      composing=false;expose();
      host.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:event.data}));
    });
    return host;
  }
}
