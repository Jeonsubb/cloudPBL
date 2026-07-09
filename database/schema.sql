create extension if not exists "uuid-ossp";

create table if not exists companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id),
  email text not null unique,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create table if not exists shipments (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references companies(id),
  name text not null,
  origin_port text not null,
  destination_port text not null,
  cargo_ready_date date,
  due_date date,
  container_type text,
  incoterms text,
  status text not null default 'REGISTERED',
  created_at timestamptz not null default now()
);

create table if not exists quotes (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid not null references shipments(id),
  forwarder_name text,
  freight_cost numeric,
  currency text default 'USD',
  surcharge numeric,
  valid_until date,
  etd date,
  eta date,
  raw_file_key text,
  created_at timestamptz not null default now()
);

create table if not exists market_indices (
  id uuid primary key default uuid_generate_v4(),
  source text not null,
  route text,
  value numeric,
  unit text,
  observed_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists market_events (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  source text,
  url text,
  event_type text,
  affected_routes text[],
  summary text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists risk_results (
  id uuid primary key default uuid_generate_v4(),
  shipment_id uuid not null references shipments(id),
  risk_score integer not null,
  risk_level text not null,
  reasons jsonb not null default '[]'::jsonb,
  recommended_actions jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now()
);

create index if not exists idx_shipments_company_id on shipments(company_id);
create index if not exists idx_quotes_shipment_id on quotes(shipment_id);
create index if not exists idx_market_indices_source_date on market_indices(source, observed_date);
create index if not exists idx_market_events_type on market_events(event_type);
create index if not exists idx_risk_results_shipment_id on risk_results(shipment_id);
