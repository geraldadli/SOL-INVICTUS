const networks = {
  11155111: {
    chainId: '0xaa36a7', chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  31337: {
    chainId: '0x7a69', chainName: 'Sol Invictus Local',
    nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['http://127.0.0.1:8545'],
  },
};

function missingNetwork(error, chainId) {
  const errors = [error, error?.data?.originalError, error?.error, error?.info?.error, error?.cause].filter(Boolean);
  if (errors.some(e => [4001, -32002].includes(Number(e.code)) || e.code === 'ACTION_REJECTED')) return false;
  return errors.some(e => Number(e.code) === 4902 || (
    /unrecognized chain id/i.test(e.message ?? '') && (e.message ?? '').toLowerCase().includes(chainId)
  ));
}

export async function ensureWalletNetwork(wallet, chain) {
  const network = networks[chain];
  if (!network) throw new Error('Only Sepolia and the local demo network are supported.');
  const selected = () => wallet.request({ method: 'eth_chainId' });
  const switchNetwork = () => wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainId }] });
  if (BigInt(await selected()) === BigInt(chain)) return;
  try { await switchNetwork(); }
  catch (error) {
    if (!missingNetwork(error, network.chainId)) throw error;
    try {
      await wallet.request({ method: 'wallet_addEthereumChain', params: [network] });
      // Adding a network does not guarantee that the wallet selects it.
      if (BigInt(await selected()) !== BigInt(chain)) await switchNetwork();
    } catch (setupError) {
      if (!missingNetwork(setupError, network.chainId)) throw setupError;
      throw new Error(`MetaMask still cannot select ${network.chainName}. Open MetaMask → Networks → Show test networks, select ${network.chainName}, then reconnect.`, { cause: setupError });
    }
  }
  if (BigInt(await selected()) !== BigInt(chain)) throw new Error(`Select ${network.chainName} in your wallet, then reconnect.`);
}
