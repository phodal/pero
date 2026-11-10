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
    ['open-session',{sessionId:'existing-session'},{kind:'session',sessionId:'existing-session'}],
    ['use-skill',{source:'pero-market-skill:lab/skill@revision'},{kind:'skill',source:'pero-market-skill:lab/skill@revision',message:''}],
    ['use-skill',{source:'pero-market-skill:lab/skill@revision',message:'Review these results'},{kind:'skill',source:'pero-market-skill:lab/skill@revision',message:'Review these results'}],
    ['badge',{count:0},{kind:'badge',count:0}],
  ] as const) assert.deepEqual(appPresentation(operation,input),expected);
  for (const [operation,input] of [
    ['navigate',{path:'https://example.org'}],['navigate',{path:'/apps/../lab'}],['navigate',{path:'/unknown'}],
    ['open-session',{sessionId:''}],['open-session',{sessionId:' '.repeat(2)}],['open-session',{sessionId:'x'.repeat(129)}],['open-session',{sessionId:'existing',submit:true}],
    ['use-skill',{source:'C:/private/SKILL.md'}],['use-skill',{source:'pero-market-skill:x',submit:true}],['use-skill',{source:'pero-market-skill:x',message:2}],['use-skill',{source:'pero-market-skill:x',message:'x'.repeat(64001)}],
    ['notify',{message:''}],['notify',{message:'x'.repeat(4001)}],['badge',{count:-1}],['badge',{count:1.5}],['badge',{count:Infinity}],
  ] as const) assert.throws(() => appPresentation(operation,input));
});

test('Notebook source navigation accepts only exact Paper and Control Lab locations', () => {
  const digest = 'a'.repeat(64), id = 'a'.repeat(32);
  const paper = `pero-app-location://paper-agent/main/report/${digest}/citation/0`;
  const trial = `pero-app-location://control-lab/main/experiment/${id}/trial/${id}`;
  const experiment = `pero-app-location://control-lab/main/experiment/${id}`;
  for (const [href, app] of [[paper, 'paper-agent'], [trial, 'control-lab'], [experiment, 'control-lab']])
    assert.deepEqual(appPresentation('open-research-source', { href }), { kind: 'research-source', app, href });
  for (const input of [{ href: paper, unexpected: 1 }, { href: paper + '?extra=1' }, { href: paper.replace('main', 'other') },
    { href: experiment + '/trial' }, { href: trial.replace('control-lab', 'lab') }])
    assert.throws(() => appPresentation('open-research-source', input));
});
