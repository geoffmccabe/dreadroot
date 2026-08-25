-- Move items stranded in the legacy table into the slots the grid reads.
--
-- pickup_egg (and anything else that predated the move to user_slots) wrote
-- item_type='item' rows into user_inventory. The inventory grid takes only
-- BLOCKS AND SEEDS from that table, so these rows are owned but invisible:
-- paid for, removed from the world, and impossible to use.
--
-- One row per player at a time is not a concern here — there are 4 in total
-- across the whole database. Anything that cannot be placed because the bag is
-- full is LEFT ALONE rather than deleted, so nothing is destroyed by this.

DO $$
DECLARE
  r RECORD;
  v_slot INTEGER;
BEGIN
  FOR r IN
    SELECT ui.id, ui.user_id, ui.item_id, ui.cooldown_until
      FROM user_inventory ui
     WHERE ui.item_type = 'item'
       AND ui.item_id IS NOT NULL
       AND ui.quantity > 0
     ORDER BY ui.created_at
  LOOP
    v_slot := public._first_empty_slot(r.user_id, 'inventory', 0);
    IF v_slot IS NULL THEN
      v_slot := public._first_empty_slot(r.user_id, 'quick_select', 0);
      IF v_slot IS NULL THEN
        CONTINUE;   -- no room: leave it where it is rather than destroy it
      END IF;
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (r.user_id, 'quick_select', 0, v_slot, r.item_id, 1);
    ELSE
      INSERT INTO user_slots (user_id, region, page, slot, item_id, quantity)
      VALUES (r.user_id, 'inventory', 0, v_slot, r.item_id, 1);
    END IF;
    DELETE FROM user_inventory WHERE id = r.id;
  END LOOP;
END $$;
