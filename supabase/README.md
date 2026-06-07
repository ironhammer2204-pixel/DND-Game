# Supabase Setup

This folder owns the database contract for the D&D game.

## Local workflow

```sh
supabase start
supabase db reset
```

The initial migration creates the core game schema from `brain.md`, enables RLS, and adds baseline policies for private campaign access.

## Remote workflow

After creating the free Supabase project:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

Keep AI narration display-only. The database is the source of truth for dice, combat, inventory, quests, and campaign state.
