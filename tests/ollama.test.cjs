const {test} = require('node:test');
const assert = require('node:assert/strict');
const {launchCommand, ensureOllama} = require('../desktop/ollama.cjs');
test('Windows uses installed binary, including spaces in account path', () => {
  assert.deepEqual(launchCommand('win32', {LOCALAPPDATA:'C:\\Users\\Test User\\AppData\\Local'}, () => true), ['C:\\Users\\Test User\\AppData\\Local\\Programs\\Ollama\\ollama.exe', ['serve']]);
});
test('Windows custom install falls back to PATH', () => assert.deepEqual(launchCommand('win32', {}, () => false), ['ollama.exe',['serve']]));
test('Mac retains application launcher', () => assert.deepEqual(launchCommand('darwin'), ['/usr/bin/open',['-a','Ollama']]));
test('existing server is not started twice', async () => assert.equal(await ensureOllama({check:async()=>true,start:async()=>assert.fail('unexpected launch')}),true));
test('waits for launched server', async () => {let n=0, launches=0; assert.equal(await ensureOllama({check:async()=>++n===3,start:async()=>launches++,wait:async()=>{}}),true);assert.equal(launches,1);});
test('timeout returns disconnected', async () => assert.equal(await ensureOllama({check:async()=>false,start:async()=>{},wait:async()=>{},attempts:2}),false));
test('missing installation rejects clearly', async () => assert.rejects(ensureOllama({check:async()=>false,start:async()=>{throw new Error('ENOENT')}}),/ENOENT/));
