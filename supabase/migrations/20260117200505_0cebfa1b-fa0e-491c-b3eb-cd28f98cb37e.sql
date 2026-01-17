-- Clear names for all tiers except T5 and T11
UPDATE seed_definitions SET name = '' WHERE tier NOT IN (5, 11);