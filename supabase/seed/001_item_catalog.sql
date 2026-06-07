insert into public.item_catalog (name, type, description, stats, value_gp, is_consumable)
select name, type, description, stats::jsonb, value_gp, is_consumable
from (
  values
    ('Dagger', 'weapon', 'A light blade for close quarters.', '{"damage":"1d4","property":"finesse"}', 2, false),
    ('Shortsword', 'weapon', 'A balanced one-handed blade.', '{"damage":"1d6","property":"finesse"}', 10, false),
    ('Longsword', 'weapon', 'A reliable martial sword.', '{"damage":"1d8","property":"versatile"}', 15, false),
    ('Greatsword', 'weapon', 'A heavy two-handed blade built for decisive strikes.', '{"damage":"2d6","property":"heavy,two-handed"}', 50, false),
    ('Quarterstaff', 'weapon', 'A simple wooden staff useful for travel and defense.', '{"damage":"1d6","property":"versatile"}', 1, false),
    ('Shortbow', 'weapon', 'A simple ranged weapon.', '{"damage":"1d6","range":"80/320"}', 25, false),
    ('Light Crossbow', 'weapon', 'A compact crossbow with reliable stopping power.', '{"damage":"1d8","range":"80/320","property":"loading"}', 25, false),
    ('Leather Armor', 'armor', 'Light armor made from boiled leather.', '{"ac_base":11,"dex_bonus":true}', 10, false),
    ('Studded Leather Armor', 'armor', 'Flexible leather reinforced with metal studs.', '{"ac_base":12,"dex_bonus":true}', 45, false),
    ('Chain Mail', 'armor', 'Heavy interlocking metal rings.', '{"ac_base":16,"dex_bonus":false}', 75, false),
    ('Shield', 'armor', 'A sturdy shield gripped in one hand.', '{"ac_bonus":2}', 10, false),
    ('Potion of Healing', 'consumable', 'A red restorative potion.', '{"healing":"2d4+2"}', 50, true),
    ('Antitoxin', 'consumable', 'A bitter vial used to resist poison.', '{"effect":"advantage_vs_poison","duration_minutes":60}', 50, true),
    ('Rations', 'consumable', 'One day of dried meat, hard cheese, and trail bread.', '{"days":1}', 1, true),
    ('Torch', 'gear', 'A pitch-soaked torch.', '{"light_radius_ft":20,"duration_minutes":60}', 1, true),
    ('Rope', 'gear', 'Fifty feet of hempen rope.', '{"length_ft":50}', 1, false),
    ('Grappling Hook', 'gear', 'A hooked iron climbing tool.', '{"use":"climbing"}', 2, false),
    ('Thieves Tools', 'gear', 'Picks, files, and tension tools for delicate locks.', '{"skill":"sleightOfHand"}', 25, false),
    ('Spellbook', 'gear', 'A blank bound book suitable for arcane notes.', '{"pages":100}', 50, false),
    ('Bedroll', 'gear', 'A practical roll of bedding for camp.', '{"use":"rest"}', 1, false)
) as starter_items(name, type, description, stats, value_gp, is_consumable)
where not exists (
  select 1 from public.item_catalog existing
  where lower(existing.name) = lower(starter_items.name)
);
