-- =====================================================================
-- Backfill shpider textures from the matching-tier Shombie. Body, leg,
-- and face all start as the same Shombie texture for that tier.
-- =====================================================================
-- Per design: shpider tier N starts visually identical to shombie tier
-- N. Admins replace any of the three columns when they're ready by
-- uploading via the design panel — this only fills blanks.
--
-- Idempotent: COALESCE leaves any admin-set value alone.
-- =====================================================================

UPDATE public.shpider_definitions s
SET
  body_texture_url = COALESCE(NULLIF(s.body_texture_url, ''), sh.texture_url),
  leg_texture_url  = COALESCE(NULLIF(s.leg_texture_url,  ''), sh.texture_url),
  face_texture_url = COALESCE(NULLIF(s.face_texture_url, ''), sh.texture_url)
FROM public.shombie_definitions sh
WHERE sh.tier = s.tier
  AND (
    s.body_texture_url IS NULL OR s.body_texture_url = ''
    OR s.leg_texture_url  IS NULL OR s.leg_texture_url  = ''
    OR s.face_texture_url IS NULL OR s.face_texture_url = ''
  );
