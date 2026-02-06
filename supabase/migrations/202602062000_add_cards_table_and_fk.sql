create table if not exists public.cards (
  card_id text primary key,
  card_name text not null
);

insert into public.cards (card_id, card_name)
select distinct pdc.card_id, pdc.card_id
from public.player_deck_cards pdc
left join public.cards c on c.card_id = pdc.card_id
where c.card_id is null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'player_deck_cards_card_id_fk_cards'
      and conrelid = 'public.player_deck_cards'::regclass
  ) then
    alter table public.player_deck_cards
      drop constraint player_deck_cards_card_id_fk_cards;
  end if;
end;
$$;

alter table public.player_deck_cards
  add constraint player_deck_cards_card_id_fk_cards
  foreign key (card_id) references public.cards(card_id)
  on update cascade
  on delete restrict;

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

  insert into public.cards (card_id, card_name)
  select distinct card.card_id, card.card_id
  from unnest(p_card_ids) as card(card_id)
  on conflict (card_id) do nothing;

  delete from public.player_deck_cards
  where deck_id = v_row.deck_id;

  insert into public.player_deck_cards (deck_id, card_id)
  select v_row.deck_id, card.card_id
  from unnest(p_card_ids) as card(card_id);

  return v_row;
end;
$$;
