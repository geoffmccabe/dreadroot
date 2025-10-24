-- Move Waterfall_Logo_1 and Geoff Block to ICONIC class
UPDATE blocks 
SET class = 'iconic' 
WHERE key IN ('waterfall_logo_1', 'geoff_block', 'waterfall_logo_block');