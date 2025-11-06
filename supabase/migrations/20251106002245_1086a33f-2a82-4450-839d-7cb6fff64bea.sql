-- Add missing blockchain fields to token_themes table
ALTER TABLE token_themes 
ADD COLUMN IF NOT EXISTS rpc_url TEXT,
ADD COLUMN IF NOT EXISTS chain_id TEXT,
ADD COLUMN IF NOT EXISTS block_explorer_url TEXT;