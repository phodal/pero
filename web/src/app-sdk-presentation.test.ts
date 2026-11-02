import test from 'node:test';
import assert from 'node:assert/strict';
import { appPresentation } from './app-sdk-presentation.ts';

test('App presentation maps native pages and panels and bounds visible messages and counts', () => {
  for (const [operation,input,expected] of [
    ['navigate',{path:'/'},{kind:'page',page:'projects'}],
    ['navigate',{path:'/tasks'},{kind:'page',page:'tasks'}],
    ['navigate',{path:'/apps/data'},{kind:'app',name:'data',panel:'main'}],
    ['navigate',{path:'/apps/lab/workbench'},{kind:'app',name:'lab',panel:'workbench'}],
    ['notify',{message:'Saved',type:'success'},{kind:'notify',message:'Saved',tone:'success'}],
    ['badge',{count:0},{kind:'badge',count:0}],
  ] as const) assert.deepEqual(appPresentation(operation,input),expected);
  for (const [operation,input] of [
    ['navigate',{path:'https://example.org'}],['navigate',{path:'/apps/../lab'}],['navigate',{path:'/unknown'}],
    ['notify',{message:''}],['notify',{message:'x'.repeat(4001)}],['badge',{count:-1}],['badge',{count:1.5}],['badge',{count:Infinity}],
  ] as const) assert.throws(() => appPresentation(operation,input));
});
