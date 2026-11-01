// Test-only transport seam for the existing native clone tool. No production
// URL policy or tool input accepts local paths. Real Git still writes/reads bytes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function prepareCloneFixture(directory) {
  const source = resolve(directory, 'owned-clone-source'), wrapper = resolve(directory, 'clone-shell.cjs');
  const marker = resolve(directory, 'clone-transport-called'), url = 'https://github.com/example/forecast';
  await mkdir(source);
  const git = args => execFileSync('git', ['-C', source, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
  git(['init', '--quiet', '--template=']);
  git(['config', 'user.name', 'Owned fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(resolve(source, 'README.md'), 'Owned clone transport fixture. Not a scientific result.\n');
  await writeFile(resolve(source, 'must-not-run.sh'), '#!/bin/sh\ntouch MUST_NOT_RUN\n');
  git(['add', '.']); git(['commit', '--quiet', '-m', 'owned fixture']);
  const revision = git(['rev-parse', 'HEAD']); assert.match(revision, /^[a-f0-9]{40}$/);
  const gitCommand = 'git -c protocol.allow=never -c protocol.https.allow=always -c http.followRedirects=false -c credential.helper= -c core.hooksPath=/dev/null -c init.templateDir= -c submodule.recurse=false -c filter.lfs.required=false';
  const target = "'reviewed-code'";
  const expectedCommand = 'export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_LFS_SKIP_SMUDGE=1; ' +
    'ulimit -f 131072 && mkdir -- ' + target + ' && ' + gitCommand + ' init --quiet --template= -- ' + target + ' && ' +
    gitCommand + ' -C ' + target + " config remote.origin.url '" + url + "' && " +
    gitCommand + ' -C ' + target + " fetch --quiet --no-tags --no-recurse-submodules --depth=1 -- '" + url + "' '" + revision + "' && " +
    gitCommand + ' -C ' + target + ' update-ref HEAD FETCH_HEAD && ' +
    gitCommand + ' -C ' + target + ' rev-parse --verify HEAD && ' + gitCommand + ' -C ' + target + ' config --get remote.origin.url';
  // --shell is existing trusted launch configuration. The wrapper accepts only
  // the fixed clone command and changes its transport, never origin or receipt.
  await writeFile(wrapper, `#!${process.execPath}\nconst assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');const {appendFileSync}=require('node:fs');
const args=process.argv.slice(2),command=args.at(-1);
assert.deepEqual(args.slice(0,-1),['--noprofile','--norc','-c']);
assert.equal(command,${JSON.stringify(expectedCommand)});
const needle=${JSON.stringify("-- '" + url + "' '")};assert.equal(command.split(needle).length,2);
args[args.length-1]=command.replaceAll('protocol.https.allow=always','protocol.file.allow=always').replace(needle,${JSON.stringify("-- '" + source + "' '")});
appendFileSync(${JSON.stringify(marker)},'transport invoked\\n');
const result=spawnSync('/bin/bash',args,{stdio:'inherit',env:process.env});process.exit(result.status??1);
`, { mode: 0o700 });
  return { source, wrapper, marker, url, revision, expectedCommand };
}
