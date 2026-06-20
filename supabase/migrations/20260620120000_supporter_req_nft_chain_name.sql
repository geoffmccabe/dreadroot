-- NFT requirements span multiple chains (WAX AtomicAssets + EVM contracts), so capture the chain and
-- a human name. nft_collection holds the contract address (EVM) or AtomicAssets collection (WAX);
-- nft_name is auto-filled from the LW contract registry via the SSO /api/nft-lookup. See
-- docs/SUPPORTER_TIERS_PLAN.md.
alter table public.supporter_requirements
  add column if not exists nft_chain text,
  add column if not exists nft_name  text;
