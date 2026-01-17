-- Clear names for all tiers except T5, T11, and T29
UPDATE seed_definitions SET name = '' WHERE tier NOT IN (5, 11, 29);