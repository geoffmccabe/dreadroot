// Resolve an NFT contract → collection name via the SSO contract registry (/api/nft-lookup). Used by
// the supporter-requirements editor to auto-fill the NFT name when an admin enters a contract.
const SSO_BASE_URL = ((import.meta.env.VITE_SSO_BASE_URL as string | undefined) || 'https://sso.lightningworks.io').replace(/\/$/, '');

export interface NftLookupResult { found: boolean; name: string | null; symbol?: string | null; chain?: string | null }

export async function lookupNftName(chain: string, contract: string): Promise<NftLookupResult | null> {
  const c = contract.trim();
  if (!c) return null;
  try {
    const res = await fetch(`${SSO_BASE_URL}/api/nft-lookup?chain=${encodeURIComponent(chain)}&contract=${encodeURIComponent(c)}`);
    if (!res.ok) return null;
    return (await res.json()) as NftLookupResult;
  } catch { return null; }
}
