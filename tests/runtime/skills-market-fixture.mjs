// Shared test-only delay seam: acquisition still forwards to the real Go Harness.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export async function buildForwarder(directory,{realHarness,ready=join(directory,'acquisition-ready'),release=join(directory,'acquisition-release'),holdPath='skills/slow/SKILL.md'}) {
  const source=join(directory,'forwarder.go');
  const command=join(directory,'market-forwarder'+(process.platform==='win32'?'.exe':''));
  await writeFile(source,`package main
import("context";"errors";"fmt";"os";"os/exec";"os/signal";"syscall";"time")
func main(){
 args:=os.Args[1:];ctx,stop:=signal.NotifyContext(context.Background(),os.Interrupt,syscall.SIGTERM);defer stop()
 if len(args)>5&&args[0]=="plugins"&&args[1]=="fetch-skill"&&args[5]==os.Getenv("MARKET_HOLD_PATH"){
  if err:=os.WriteFile(os.Getenv("MARKET_HOLD_READY"),[]byte(args[5]),0600);err!=nil{fmt.Fprintln(os.Stderr,err);os.Exit(2)}
  for{if _,err:=os.Stat(os.Getenv("MARKET_HOLD_RELEASE"));err==nil{break}else if !errors.Is(err,os.ErrNotExist){os.Exit(3)};select{case<-ctx.Done():os.Exit(4);case<-time.After(20*time.Millisecond):}}
 }
 command:=exec.CommandContext(ctx,os.Getenv("MARKET_REAL_HARNESS"),args...);command.Stdin=os.Stdin;command.Stdout=os.Stdout;command.Stderr=os.Stderr
 if err:=command.Run();err!=nil{var exited *exec.ExitError;if errors.As(err,&exited){os.Exit(exited.ExitCode())};fmt.Fprintln(os.Stderr,err);os.Exit(5)}
}
`);
  execFileSync('go',['build','-o',command,source],{env:{...process.env,GOWORK:'off'},stdio:['ignore','pipe','pipe']});
  return {command,ready,release,env:{MARKET_REAL_HARNESS:realHarness,MARKET_HOLD_PATH:holdPath,MARKET_HOLD_READY:ready,MARKET_HOLD_RELEASE:release}};
}

export async function createSourceFixture(directory, {generalName='fast'} = {}) {
  const repo=join(directory,'source');await mkdir(repo,{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const records=[];
  for(const [name,title] of [['slow','慢速科研技能'],['fast','另一科研技能']]){
    const path=`skills/${name}/SKILL.md`;
    const body=`---\nname: ${name}\ndescription: Verify observed research data with evidence.\nauthor: Research fixture\nlicense: MIT\ntags: [Research]\ndependencies: [Python]\n---\nMARKET_${name.toUpperCase()}_EVIDENCE. Keep missing observations visible.\n`;
    await mkdir(join(repo,`skills/${name}`),{recursive:true});await writeFile(join(repo,path),body);
    records.push({id:`fixture/research-skills/${path}`,name,title_zh:title,description:'Verify observed research data.',description_zh:'核查数据并保留来源与缺失信息。',category:'statistics',category_zh:'统计与实证分析',kind:name===generalName?'general_skill':'research_skill',source:{repository:'fixture/research-skills',path,sha256:createHash('sha256').update(body).digest('hex')},sources:[],license:{spdx:'MIT',status:'declared_in_skill',evidence_url:'https://github.com/fixture/research-skills'},compatibility:{declared:[],status:name===generalName?'static_instructions':'unverified'},dependencies:[],verification:{content:'parsed',runtime:'not_run',notes:[]}});
  }
  git('init','-b','main');git('config','user.name','Market fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','Independent research skill fixture');
  const commit=git('rev-parse','HEAD');
  for(const record of records){Object.assign(record.source,{commit,url:`https://github.com/fixture/research-skills/blob/${commit}/${record.source.path}`});}
  const catalog={schema_version:1,collection_status:'complete',generated_at:'2026-11-08',issue_url:'https://github.com/phodal/pero/issues/156',source_document:'',sources:[],skills:records,resources:[],exclusions:[],stats:{}};
  const catalogPath=join(directory,'catalog.json'),gitconfig=join(directory,'gitconfig');
  await writeFile(catalogPath,JSON.stringify(catalog));await writeFile(gitconfig,`[url "${repo.replaceAll('\\','/')}"]\n  insteadOf = https://github.com/fixture/research-skills.git\n`);
  return {repo,catalogPath,gitconfig,catalog,slow:records[0],fast:records[1]};
}
