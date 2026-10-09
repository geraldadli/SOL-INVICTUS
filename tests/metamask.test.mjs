import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMetaMaskProvider } from '../src/metamask.js';

function announce(target, rdns, provider) {
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail:{info:{rdns},provider}}));
}

test('selects MetaMask even when another extension owns window.ethereum', async () => {
  const target = new EventTarget();
  const other = {isMetaMask:true,request:()=>{throw Error('Wrong wallet was called');}};
  const metamask = {request:async()=> '0xaa36a7'};
  target.ethereum = other;
  target.addEventListener('eip6963:requestProvider',()=> {
    announce(target,'com.trustwallet.app',other);
    announce(target,'io.metamask',metamask);
  });
  assert.equal(await getMetaMaskProvider(target),metamask);
});

test('allows asynchronous MetaMask discovery and ignores malformed announcements', async () => {
  const target = new EventTarget();
  const metamask = {request:async()=>null};
  target.addEventListener('eip6963:requestProvider',()=> {
    target.dispatchEvent(new Event('eip6963:announceProvider'));
    announce(target,'io.metamask',{});
    setTimeout(()=>announce(target,'io.metamask',metamask),10);
  });
  assert.equal(await getMetaMaskProvider(target),metamask);
});

test('missing MetaMask fails clearly instead of falling back to another wallet', async () => {
  const target = new EventTarget();
  target.ethereum = {isMetaMask:true,request:()=>{throw Error('Must not use global provider');}};
  const removed = [];
  const remove = target.removeEventListener.bind(target);
  target.removeEventListener = (...args)=>{removed.push(args[0]);remove(...args);};
  await assert.rejects(getMetaMaskProvider(target), /MetaMask was not detected/);
  assert.deepEqual(removed,['eip6963:announceProvider']);
});
