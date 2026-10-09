import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureWalletNetwork } from '../src/wallet-network.js';

function wallet({ current = '0x1', missing = false, switchError, addError, autoSelect = false, ignoreSwitch = false } = {}) {
  const calls = [];
  return { calls, async request(call) {
    calls.push(call);
    if (call.method === 'eth_chainId') return current;
    if (call.method === 'wallet_switchEthereumChain') {
      if (switchError) throw switchError;
      if (missing) throw { code: 4902 };
      if (!ignoreSwitch) current = call.params[0].chainId;
    }
    if (call.method === 'wallet_addEthereumChain') {
      if (addError) throw addError;
      missing = false;
      if (autoSelect) current = call.params[0].chainId;
    }
  }};
}

test('missing Sepolia is added with the correct RPC, then explicitly selected', async () => {
  const w = wallet({missing:true});
  await ensureWalletNetwork(w, 11155111);
  const add = w.calls.find(c => c.method === 'wallet_addEthereumChain').params[0];
  assert.equal(add.chainId, '0xaa36a7');
  assert.equal(add.rpcUrls[0], 'https://ethereum-sepolia-rpc.publicnode.com');
  assert.equal(add.blockExplorerUrls[0], 'https://sepolia.etherscan.io');
  assert.equal(add.nativeCurrency.decimals, 18);
  assert.equal(await w.request({method:'eth_chainId'}), '0xaa36a7');
  assert.equal(w.calls.filter(c=>c.method==='wallet_switchEthereumChain').length, 2);
});

test('existing network and auto-selecting wallets avoid redundant prompts', async () => {
  const connected = wallet({current:'0xaa36a7'});
  await ensureWalletNetwork(connected,11155111);
  assert.equal(connected.calls.length,1);
  const existing = wallet();
  await ensureWalletNetwork(existing,11155111);
  assert.ok(!existing.calls.some(c=>c.method==='wallet_addEthereumChain'));
  const auto = wallet({missing:true,autoSelect:true});
  await ensureWalletNetwork(auto,11155111);
  assert.equal(auto.calls.filter(c=>c.method==='wallet_switchEthereumChain').length,1);
});

test('rejecting or failing a request never triggers additional prompts', async () => {
  for (const code of [4001,-32002,-32603]) {
    const error = {code};
    const w = wallet({switchError:error});
    await assert.rejects(ensureWalletNetwork(w,11155111), e=>e===error);
    assert.ok(!w.calls.some(c=>c.method==='wallet_addEthereumChain'));
  }
  const error = {code:4001};
  const w = wallet({missing:true,addError:error});
  await assert.rejects(ensureWalletNetwork(w,11155111), e=>e===error);
  assert.equal(w.calls.at(-1).method,'wallet_addEthereumChain');
});

test('wrapped missing-network errors, local chain, and failed switches are handled', async () => {
  const w = wallet({missing:true});
  const request = w.request.bind(w);
  w.request = async call => {
    try { return await request(call); }
    catch (error) { throw {code:-32603,data:{originalError:error}}; }
  };
  await ensureWalletNetwork(w,11155111);
  const local = wallet({missing:true});
  await ensureWalletNetwork(local,31337);
  assert.equal(local.calls.find(c=>c.method==='wallet_addEthereumChain').params[0].chainId,'0x7a69');
  await assert.rejects(ensureWalletNetwork(wallet({ignoreSwitch:true}),11155111), /Select Sepolia/);
  const unsupported = wallet();
  await assert.rejects(ensureWalletNetwork(unsupported,1), /Only Sepolia/);
  assert.equal(unsupported.calls.length,0);
});

test('the reported unrecognized-chain message and wrapped codes trigger setup', async () => {
  const message = 'Unrecognized chain ID "0xaa36a7". Try adding the chain using wallet_addEthereumChain first.';
  for (const error of [new Error(message), {code:'-32603',data:{originalError:{code:4902}}}, {info:{error:{code:4902}}}]) {
    const w = wallet({missing:true});
    const request = w.request.bind(w);
    w.request = async call => {
      try { return await request(call); } catch { throw error; }
    };
    await ensureWalletNetwork(w,11155111);
    assert.equal(w.calls.filter(c=>c.method==='wallet_addEthereumChain').length,1);
  }
  const rejected = wallet({switchError:{code:4001,message}});
  await assert.rejects(ensureWalletNetwork(rejected,11155111),e=>e.code===4001);
  assert.ok(!rejected.calls.some(c=>c.method==='wallet_addEthereumChain'));
  const wrongChain = wallet({switchError:new Error('Unrecognized chain ID "0x1".')});
  await assert.rejects(ensureWalletNetwork(wrongChain,11155111),/0x1/);
  assert.ok(!wrongChain.calls.some(c=>c.method==='wallet_addEthereumChain'));
});

test('a wallet that still rejects Sepolia after adding gets manual instructions, not a loop', async () => {
  const w = wallet({switchError:{code:4902}});
  await assert.rejects(ensureWalletNetwork(w,11155111),/Show test networks/);
  assert.equal(w.calls.filter(c=>c.method==='wallet_addEthereumChain').length,1);
  assert.equal(w.calls.filter(c=>c.method==='wallet_switchEthereumChain').length,2);
});
