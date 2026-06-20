-- The Divi token theme predates the on-chain columns, so its ticker_symbol/blockchain were never set.
-- The holdings sync (sync-holdings) maps the SSO's returned 'DIVI' symbol to a token_theme by ticker +
-- chain, so without these the Divi gate can't resolve. Set them deterministically (Divi is unambiguous).
update public.token_themes
   set ticker_symbol = coalesce(nullif(ticker_symbol, ''), 'DIVI'),
       blockchain    = coalesce(nullif(blockchain, ''), 'Divi')
 where name = 'divi';
