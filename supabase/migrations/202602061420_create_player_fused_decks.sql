create table if not exists public.player_fused_decks (
  fused_deck_id text primary key,
  deck_name text not null,
  owner_name text not null,
  source_deck_1_id text not null,
  source_deck_2_id text not null,
  synced_at timestamptz not null default now(),
  constraint player_fused_decks_sources_distinct
    check (source_deck_1_id <> source_deck_2_id)
);

create index if not exists idx_player_fused_decks_owner_name_lower
  on public.player_fused_decks (lower(owner_name));

create index if not exists idx_player_fused_decks_synced_at_desc
  on public.player_fused_decks (synced_at desc);

create index if not exists idx_player_fused_decks_source_deck_1_id
  on public.player_fused_decks (source_deck_1_id);

create index if not exists idx_player_fused_decks_source_deck_2_id
  on public.player_fused_decks (source_deck_2_id);

create or replace function public.upsert_player_fused_deck(
  p_fused_deck_id text,
  p_deck_name text,
  p_owner_name text,
  p_source_deck_1_id text,
  p_source_deck_2_id text
)
returns public.player_fused_decks
language sql
as $$
  insert into public.player_fused_decks (
    fused_deck_id,
    deck_name,
    owner_name,
    source_deck_1_id,
    source_deck_2_id
  )
  values (
    p_fused_deck_id,
    p_deck_name,
    p_owner_name,
    p_source_deck_1_id,
    p_source_deck_2_id
  )
  on conflict (fused_deck_id) do update
  set
    deck_name = excluded.deck_name,
    owner_name = excluded.owner_name,
    source_deck_1_id = excluded.source_deck_1_id,
    source_deck_2_id = excluded.source_deck_2_id,
    synced_at = now()
  returning *;
$$;
