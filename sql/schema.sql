create table chess_state (
  id int primary key default 1,
  tournament_name text default 'Schachturnier',
  status text default 'registration',      -- registration | running | finished
  num_rounds int default 6,
  current_round int default 0,
  time_control text default '5+3',
  updated_at timestamptz default now()
);
insert into chess_state (id) values (1) on conflict do nothing;

create table chess_players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  klasse text,
  withdrawn boolean default false,
  created_at timestamptz default now()
);

create table chess_pairings (
  id uuid primary key default gen_random_uuid(),
  round int not null,
  board int not null,
  white_id uuid,
  black_id uuid,                            -- null = Freilos
  result text,                              -- '1-0' | '0-1' | 'draw' | 'bye' | null
  created_at timestamptz default now()
);

alter table chess_state enable row level security;
alter table chess_players enable row level security;
alter table chess_pairings enable row level security;
create policy "open" on chess_state    for all using (true) with check (true);
create policy "open" on chess_players  for all using (true) with check (true);
create policy "open" on chess_pairings for all using (true) with check (true);

-- Pokal-Inhaber (aktuell) + "schon vergeben"-Flag:
alter table chess_state add column if not exists champions jsonb default '[]'::jsonb;
alter table chess_state add column if not exists awarded boolean default false;
alter table chess_state add column if not exists event_code text default '';

-- Anmeldemodus, live im Admin-Panel umschaltbar: 'none' | 'code' | 'email'
alter table chess_state add column if not exists verify_mode text default 'code';

-- optionale Anmeldebestätigung:
alter table chess_players add column if not exists email text;
alter table chess_players add column if not exists verified boolean default false;

-- Wall of Fame (Archiv aller bisherigen Sieger):
create table if not exists chess_halloffame (
  id uuid primary key default gen_random_uuid(),
  tournament_name text,
  event_date date,
  rank int,                                -- 1, 2 oder 3
  name text,
  klasse text,
  created_at timestamptz default now()
);
alter table chess_halloffame enable row level security;
create policy "open" on chess_halloffame for all using (true) with check (true);

alter publication supabase_realtime add table chess_state, chess_players, chess_pairings, chess_halloffame;
