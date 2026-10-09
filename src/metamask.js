// Use MetaMask's announced provider, never another extension's window.ethereum.
export function getMetaMaskProvider(target = window) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener('eip6963:announceProvider', onProvider);
      reject(new Error('MetaMask was not detected. Open this site in the browser where MetaMask is enabled, unlock it, and reload.'));
    }, 1500);
    function onProvider(event) {
      const detail = event.detail;
      if (detail?.info?.rdns !== 'io.metamask' || typeof detail.provider?.request !== 'function') return;
      clearTimeout(timer);
      target.removeEventListener('eip6963:announceProvider', onProvider);
      resolve(detail.provider);
    }
    target.addEventListener('eip6963:announceProvider', onProvider);
    target.dispatchEvent(new Event('eip6963:requestProvider'));
  });
}
