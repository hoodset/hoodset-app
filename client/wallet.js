import { isAddress } from 'ethers';

export const walletId = info => info.rdns || info.uuid;

// Restoration only reads a permission the user already granted. It never opens a prompt.
export async function walletSession(provider, requestAccess = false) {
  const accounts = await provider.request({ method: requestAccess ? 'eth_requestAccounts' : 'eth_accounts' });
  if (!accounts?.length && !requestAccess) return null;
  if (!isAddress(accounts?.[0])) throw Error('The wallet did not return a valid account.');
  const chain = Number(BigInt(await provider.request({ method: 'eth_chainId' })));
  if (!Number.isSafeInteger(chain) || chain <= 0) throw Error('Invalid wallet network.');
  return { account: accounts[0].toLowerCase(), chain };
}

export function observeWallet(provider, onAccounts, onChain, onDisconnect) {
  const listeners = [['accountsChanged', onAccounts], ['chainChanged', onChain], ['disconnect', onDisconnect]];
  for (const [event, fn] of listeners) provider.on?.(event, fn);
  return () => { for (const [event, fn] of listeners) provider.removeListener?.(event, fn); };
}
