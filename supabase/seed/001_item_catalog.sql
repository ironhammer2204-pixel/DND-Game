insert into public.item_catalog (name, type, description, stats, value_gp, is_consumable)
values
  ('Dagger', 'weapon', 'A light blade for close quarters.', '{"damage":"1d4","property":"finesse"}', 2, false),
  ('Shortsword', 'weapon', 'A balanced one-handed blade.', '{"damage":"1d6","property":"finesse"}', 10, false),
  ('Longsword', 'weapon', 'A reliable martial sword.', '{"damage":"1d8","property":"versatile"}', 15, false),
  ('Shortbow', 'weapon', 'A simple ranged weapon.', '{"damage":"1d6","range":"80/320"}', 25, false),
  ('Leather Armor', 'armor', 'Light armor made from boiled leather.', '{"ac_base":11,"dex_bonus":true}', 10, false),
  ('Chain Mail', 'armor', 'Heavy interlocking metal rings.', '{"ac_base":16,"dex_bonus":false}', 75, false),
  ('Shield', 'armor', 'A sturdy shield gripped in one hand.', '{"ac_bonus":2}', 10, false),
  ('Potion of Healing', 'consumable', 'A red restorative potion.', '{"healing":"2d4+2"}', 50, true),
  ('Rope', 'gear', 'Fifty feet of hempen rope.', '{"length_ft":50}', 1, false),
  ('Torch', 'gear', 'A pitch-soaked torch.', '{"light_radius_ft":20,"duration_minutes":60}', 1, true)
on conflict do nothing;
