drop function if exists public.upsert_player_deck(
  text,
  text,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  timestamptz,
  text[]
);

do $$
begin
  if to_regclass('public.player_deck_cards') is not null then
    drop trigger if exists trg_player_deck_cards_exactly_10 on public.player_deck_cards;
  end if;
end;
$$;

drop function if exists public.check_player_deck_cards_exactly_10();
drop table if exists public.player_deck_cards;

drop table if exists public.player_decks_legacy cascade;

create table public.player_decks_new (
  deck_id text primary key,
  deck_name text not null,
  owner_name text not null,
  faction text,
  forgeborn_id text,
  set_id text not null,
  deck_score numeric,
  elo numeric default null,
  expire_date timestamptz,
  synced_at timestamptz not null default now(),
  constraint player_decks_set_id_upper check (set_id = upper(set_id)),
  constraint player_decks_set_id_allowed check (set_id in ('B1', 'B2', 'B3', 'S1', 'S2', 'S3', 'S4', 'D0'))
);

insert into public.player_decks_new (
  deck_id,
  deck_name,
  owner_name,
  faction,
  forgeborn_id,
  set_id,
  deck_score,
  elo,
  expire_date,
  synced_at
)
select
  pd.deck_id,
  pd.deck_name,
  coalesce(pp.player_name, 'unknown') as owner_name,
  pd.faction,
  pd.forgeborn_id,
  case
    when upper(coalesce(pd.card_set_id, pd.card_set_no, 'D0')) in ('B1', 'B2', 'B3', 'S1', 'S2', 'S3', 'S4', 'D0')
      then upper(coalesce(pd.card_set_id, pd.card_set_no, 'D0'))
    else 'D0'
  end as set_id,
  pd.deck_score,
  pd.elo,
  null::timestamptz as expire_date,
  coalesce(pd.updated_at, now()) as synced_at
from public.player_decks pd
left join public.player_profiles pp on pp.user_id = pd.user_id;

alter table public.player_decks rename to player_decks_legacy;
alter table public.player_decks_new rename to player_decks;

create index idx_player_decks_v2_owner_name_lower
  on public.player_decks (lower(owner_name));

create index idx_player_decks_v2_faction
  on public.player_decks (faction);

create index idx_player_decks_v2_set_id
  on public.player_decks (set_id);

create index idx_player_decks_v2_synced_at_desc
  on public.player_decks (synced_at desc);

create index idx_player_decks_v2_expire_date
  on public.player_decks (expire_date);

create table public.player_deck_cards (
  id bigint generated always as identity primary key,
  deck_id text not null references public.player_decks(deck_id) on delete cascade,
  card_id text not null
);

create index idx_player_deck_cards_deck_id
  on public.player_deck_cards (deck_id);

create index idx_player_deck_cards_card_id
  on public.player_deck_cards (card_id);

create or replace function public.check_player_deck_cards_exactly_10()
returns trigger
language plpgsql
as $$
declare
  v_deck_id text;
  v_count integer;
begin
  for v_deck_id in
    select distinct deck_id
    from (
      values
        (case when tg_op in ('INSERT', 'UPDATE') then new.deck_id else null end),
        (case when tg_op in ('UPDATE', 'DELETE') then old.deck_id else null end)
    ) as affected(deck_id)
    where deck_id is not null
  loop
    if exists (select 1 from public.player_decks d where d.deck_id = v_deck_id) then
      select count(*) into v_count
      from public.player_deck_cards c
      where c.deck_id = v_deck_id;

      if v_count <> 10 then
        raise exception
          'Deck % must have exactly 10 card rows in player_deck_cards (current: %)',
          v_deck_id,
          v_count;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

create constraint trigger trg_player_deck_cards_exactly_10
after insert or update or delete on public.player_deck_cards
deferrable initially deferred
for each row
execute function public.check_player_deck_cards_exactly_10();

create or replace function public.upsert_player_deck(
  p_deck_id text,
  p_deck_name text,
  p_owner_name text,
  p_faction text,
  p_forgeborn_id text,
  p_set_id text,
  p_deck_score numeric,
  p_elo numeric,
  p_expire_date timestamptz,
  p_card_ids text[]
)
returns public.player_decks
language plpgsql
as $$
declare
  v_set_id text;
  v_card_count integer;
  v_row public.player_decks%rowtype;
begin
  if p_deck_id is null or btrim(p_deck_id) = '' then
    raise exception 'p_deck_id is required';
  end if;

  if p_deck_name is null or btrim(p_deck_name) = '' then
    raise exception 'p_deck_name is required';
  end if;

  if p_owner_name is null or btrim(p_owner_name) = '' then
    raise exception 'p_owner_name is required';
  end if;

  if p_set_id is null or btrim(p_set_id) = '' then
    raise exception 'p_set_id is required';
  end if;

  if p_card_ids is null then
    raise exception 'p_card_ids is required';
  end if;

  v_card_count := coalesce(array_length(p_card_ids, 1), 0);
  if v_card_count <> 10 then
    raise exception 'p_card_ids must contain exactly 10 elements, got %', v_card_count;
  end if;

  if exists (
    select 1
    from unnest(p_card_ids) as card(card_id)
    where card.card_id is null or btrim(card.card_id) = ''
  ) then
    raise exception 'p_card_ids cannot contain null or empty values';
  end if;

  v_set_id := upper(p_set_id);
  if v_set_id not in ('B1', 'B2', 'B3', 'S1', 'S2', 'S3', 'S4', 'D0') then
    raise exception 'p_set_id must be one of B1,B2,B3,S1,S2,S3,S4,D0, got %', p_set_id;
  end if;

  insert into public.player_decks (
    deck_id,
    deck_name,
    owner_name,
    faction,
    forgeborn_id,
    set_id,
    deck_score,
    elo,
    expire_date,
    synced_at
  )
  values (
    p_deck_id,
    p_deck_name,
    p_owner_name,
    p_faction,
    p_forgeborn_id,
    v_set_id,
    p_deck_score,
    p_elo,
    p_expire_date,
    now()
  )
  on conflict (deck_id) do update
  set
    deck_name = excluded.deck_name,
    owner_name = excluded.owner_name,
    faction = excluded.faction,
    forgeborn_id = excluded.forgeborn_id,
    set_id = excluded.set_id,
    deck_score = excluded.deck_score,
    elo = excluded.elo,
    expire_date = excluded.expire_date,
    synced_at = now()
  returning * into v_row;

  delete from public.player_deck_cards
  where deck_id = v_row.deck_id;

  insert into public.player_deck_cards (deck_id, card_id)
  select v_row.deck_id, card_id
  from unnest(p_card_ids) as card_id;

  return v_row;
end;
$$;

do $$
declare
  v_legacy_count bigint;
  v_new_count bigint;
begin
  select count(*) into v_legacy_count from public.player_decks_legacy;
  select count(*) into v_new_count from public.player_decks;

  if v_legacy_count <> v_new_count then
    raise exception
      'Smoke check failed: migrated row count mismatch (legacy %, new %)',
      v_legacy_count,
      v_new_count;
  end if;
end;
$$;

drop table public.player_decks_legacy;
