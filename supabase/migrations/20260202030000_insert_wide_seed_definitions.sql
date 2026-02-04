-- Insert default wide seed definitions for tiers 1-10
-- These are needed for wide tree planting to work (foreign key on seed_definition_id)

INSERT INTO seed_definitions (tier, name, tree_type, cost, width_factor, branching_factor, growth_factor, fruiting_factor, rarity, low_branch_height, spike_chance, spike_length, nob_chance, nob_size, cross_chance, cross_length, shroom_chance, shroom_length, shroom_cap_diameter, symmetry, in_bracket_menu)
VALUES
  (1, 'Wide T1', 'wide', 50, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (2, 'Wide T2', 'wide', 100, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (3, 'Wide T3', 'wide', 150, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (4, 'Wide T4', 'wide', 200, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (5, 'Wide T5', 'wide', 250, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (6, 'Wide T6', 'wide', 300, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (7, 'Wide T7', 'wide', 350, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (8, 'Wide T8', 'wide', 400, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (9, 'Wide T9', 'wide', 450, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true),
  (10, 'Wide T10', 'wide', 500, 0.3, 0.5, 0.5, 0.5, 'common', 2, 0, 4, 0, 1, 0, 4, 0, 5, 3, 'none', true);
