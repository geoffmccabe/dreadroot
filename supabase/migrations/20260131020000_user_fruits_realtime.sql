-- Enable realtime for fruit tables so harvested fruits appear in panel and disappear from trees
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_fruits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tree_fruits;
