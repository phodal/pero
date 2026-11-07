import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { embeddedShortcut } from './shortcuts.ts';
import type { ShortcutMenu } from '../../../protocol/generated/shortcuts';

// Test the embedded-surface boundary: the top frame and App-local commands
// must not be consumed, and DOM navigation-key names match the Rust projection.
test('embedded entry dispatch respects focus, modifiers, repeat and composition', () => {
  const menu: ShortcutMenu = {entries:[
    {command:'keyboard_shortcuts',label_key:'shortcuts.title',accelerators:['Super+/','Control+Alt+left'],application_entry:true},
    {command:'toggle_sidebar',label_key:'shortcuts.sidebar',accelerators:['Super+B'],application_entry:false},
  ]};
  for (const [key, url, expected] of [
    [{type:'keyDown',key:'/',meta:true},'pero-app://insights/index.html','keyboard_shortcuts'],
    [{type:'keyDown',key:'ArrowLeft',control:true,alt:true},'pero-app://insights/index.html','keyboard_shortcuts'],
    [{type:'keyDown',key:'/',meta:true,shift:true},'pero-app://insights/index.html',undefined],
    [{type:'keyDown',key:'b',meta:true},'pero-app://insights/index.html',undefined],
    [{type:'keyDown',key:'/',meta:true},'pero://workbench/',undefined],
    [{type:'keyDown',key:'/',meta:true},'https://example.com',undefined],
    [{type:'keyUp',key:'/',meta:true},'pero-app://insights/index.html',undefined],
    [{type:'keyDown',key:'/',meta:true,isAutoRepeat:true},'pero-app://insights/index.html',undefined],
    [{type:'keyDown',key:'/',meta:true,isComposing:true},'pero-app://insights/index.html',undefined],
  ] as const) assert.equal(embeddedShortcut(menu,key,url),expected);
});
