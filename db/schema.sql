-- Remedy database schema (plan section 8). Reviewed SQL, applied by hand:
--   npm run db:migrate   (or: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql)
-- Every statement is idempotent (if not exists), so applying it twice changes nothing.
-- src/lib/db/schema.ts declares the same tables for Drizzle; tests/schema.test.ts keeps the two in step.
-- Money is numeric(10,2). Contact details are never stored in the clear: *_enc columns are AES-256-GCM
-- (src/lib/secure.ts) and *_hash columns are salted SHA-256.

begin;

-- Recalls and their proof rules (public CPSC data) --------------------------------------------------------------

create table if not exists recall (
  number            text primary key,
  title             text not null,
  date              date not null,
  units             integer,
  units_text        text not null default '',
  hazard            text not null default '',
  remedy_text       text not null default '',
  remedies          jsonb not null default '[]',
  products          jsonb not null default '[]',
  images            jsonb not null default '[]',
  retailers         jsonb not null default '[]',
  manufacturers     jsonb not null default '[]',
  consumer_contact  text not null default '',
  url               text not null default '',
  photo_refund      boolean not null default false,
  flags             jsonb not null default '{"photo":false,"refund":false,"marker":false,"cut":false,"email":false,"webmail":false}',
  raw               jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists recall_date_idx on recall (date);
create index if not exists recall_photo_refund_idx on recall (photo_refund);
-- Postgres full-text search, the fallback when Elastic is not connected. Query with the same expression.
create index if not exists recall_search_idx on recall using gin (
  to_tsvector('english', title || ' ' || hazard || ' ' || remedy_text)
);

create table if not exists proof_rule (
  id             serial primary key,
  recall_number  text not null references recall (number) on delete cascade,
  rule           jsonb not null,
  source         text not null default 'ai' check (source in ('ai', 'firm', 'baseline')),
  model          text,
  approved_by    text,
  approved_at    timestamptz,
  version        integer not null default 1,
  created_at     timestamptz not null default now()
);
create unique index if not exists proof_rule_recall_version_idx on proof_rule (recall_number, version);

-- Firms and their recalls -----------------------------------------------------------------------------------------

create table if not exists firm (
  id                      serial primary key,
  slug                    text not null,
  name                    text not null,
  is_sample               boolean not null default false,
  contact_email           text not null default '',
  paypal_client_id_enc    text,
  paypal_secret_enc       text,
  settings                jsonb not null default '{}',
  plan                    text not null default 'starter' check (plan in ('starter', 'pro')),
  paypal_subscription_id  text,
  created_at              timestamptz not null default now()
);
create unique index if not exists firm_slug_idx on firm (slug);

create table if not exists firm_recall (
  id               serial primary key,
  firm_id          integer not null references firm (id) on delete cascade,
  recall_number    text not null references recall (number),
  refund_by_model  jsonb not null default '{}',
  default_refund   numeric(10, 2),
  auto_cap         numeric(10, 2) not null default 50.00,
  daily_cap        numeric(10, 2) not null default 2500.00,
  status           text not null default 'active' check (status in ('active', 'paused', 'closed')),
  announced_on     date,
  created_at       timestamptz not null default now()
);
create unique index if not exists firm_recall_firm_recall_idx on firm_recall (firm_id, recall_number);

create table if not exists sale (
  id                 serial primary key,
  firm_id            integer not null references firm (id) on delete cascade,
  recall_number      text references recall (number),
  source             text not null check (source in ('csv', 'paypal', 'shop')),
  buyer_email_hash   text,
  buyer_contact_enc  text,
  item_name          text not null,
  sku                text,
  quantity           integer not null default 1 check (quantity > 0),
  amount             numeric(10, 2) not null check (amount >= 0),
  currency           text not null default 'USD',
  paid_at            timestamptz,
  paypal_order_id    text,
  paypal_capture_id  text,
  created_at         timestamptz not null default now()
);
create index if not exists sale_firm_idx on sale (firm_id);
create index if not exists sale_buyer_idx on sale (buyer_email_hash);
create unique index if not exists sale_capture_idx on sale (paypal_capture_id) where paypal_capture_id is not null;

-- Claims: the photo, the checks, the decision ---------------------------------------------------------------------

create table if not exists photo (
  id            uuid primary key default gen_random_uuid(),
  sha256        text not null,
  dhash         text,
  mime          text not null,
  size          integer not null check (size >= 0),
  width         integer,
  height        integer,
  bytes         bytea,
  storage_path  text,
  source        text not null default 'upload' check (source in ('upload', 'preset', 'email')),
  created_at    timestamptz not null default now()
);
create index if not exists photo_sha256_idx on photo (sha256);
create index if not exists photo_dhash_idx on photo (dhash);

create table if not exists claim (
  id               uuid primary key default gen_random_uuid(),
  recall_number    text not null references recall (number),
  firm_id          integer references firm (id),
  photo_id         uuid references photo (id),
  payee_type       text check (payee_type in ('email', 'phone', 'venmo')),
  payee_value_enc  text,
  payee_hash       text,
  payee_masked     text,
  linked_sale_id   integer references sale (id),
  units_claimed    integer not null default 1 check (units_claimed > 0),
  checks           jsonb not null default '{}',
  decision         text not null default 'pending' check (decision in ('pending', 'verified', 'retake', 'firm_review')),
  status           text not null default 'checking'
                     check (status in ('checking', 'verified', 'retake', 'firm_review', 'approved', 'paid', 'unclaimed', 'closed')),
  debate           jsonb,
  -- The rest of the verifier's answer beside the six checks: decided_by, guidance, summary, quality, timings, model.
  result           jsonb,
  amount           numeric(10, 2) check (amount >= 0),
  channel          text not null default 'web' check (channel in ('web', 'link', 'email', 'api', 'preset')),
  review_outcome   text check (review_outcome in ('approved', 'retake', 'declined')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  is_sample        boolean not null default false,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists claim_recall_idx on claim (recall_number);
create index if not exists claim_firm_status_idx on claim (firm_id, status);
create index if not exists claim_payee_idx on claim (payee_hash, recall_number);

-- Payments --------------------------------------------------------------------------------------------------------

create table if not exists payment_plan (
  id           serial primary key,
  claim_id     uuid not null references claim (id) on delete cascade,
  route        text not null check (route in ('refund', 'payout', 'replacement')),
  amount       numeric(10, 2) not null check (amount >= 0),
  currency     text not null default 'USD',
  approval     text check (approval in ('auto', 'reviewer')),
  approved_by  text,
  approved_at  timestamptz,
  status       text not null default 'planned' check (status in ('planned', 'approved', 'executing', 'done', 'failed', 'canceled')),
  detail       jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- One plan per claim: a second "pay" finds this plan and never pays twice.
create unique index if not exists payment_plan_claim_idx on payment_plan (claim_id);

create table if not exists payment (
  id                     serial primary key,
  plan_id                integer not null references payment_plan (id) on delete cascade,
  claim_id               uuid not null references claim (id) on delete cascade,
  route                  text not null check (route in ('refund', 'payout', 'replacement')),
  amount                 numeric(10, 2) not null check (amount >= 0),
  currency               text not null default 'USD',
  status                 text not null default 'pending'
                           check (status in ('pending', 'success', 'unclaimed', 'returned', 'failed', 'blocked', 'onhold', 'refunded', 'reversed', 'canceled')),
  paypal_status          text,
  sender_batch_id        text,
  sender_item_id         text,
  paypal_batch_id        text,
  paypal_item_id         text,
  paypal_transaction_id  text,
  paypal_refund_id       text,
  paypal_order_id        text,
  paypal_capture_id      text,
  recipient_type         text check (recipient_type in ('EMAIL', 'PHONE')),
  recipient_wallet       text check (recipient_wallet in ('PAYPAL', 'VENMO')),
  request_id             text,
  debug_id               text,
  error                  jsonb,
  paid_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists payment_claim_idx on payment (claim_id);
create index if not exists payment_batch_idx on payment (paypal_batch_id);
create unique index if not exists payment_request_idx on payment (request_id) where request_id is not null;
create unique index if not exists payment_item_idx on payment (paypal_item_id) where paypal_item_id is not null;

-- The firm's loop: notices, the corrective-action plan, monthly reports ----------------------------------------

create table if not exists notice (
  id                     serial primary key,
  firm_id                integer not null references firm (id) on delete cascade,
  recall_number          text references recall (number),
  sale_id                integer references sale (id),
  claim_id               uuid references claim (id),
  kind                   text not null default 'notice' check (kind in ('notice', 're_notice')),
  channel                text not null check (channel in ('email', 'sms', 'qr', 'letter')),
  recipient_hash         text,
  claim_link_token_hash  text,
  status                 text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'opened', 'claimed')),
  provider               text,
  provider_id            text,
  sent_at                timestamptz,
  opened_at              timestamptz,
  created_at             timestamptz not null default now()
);
create index if not exists notice_firm_idx on notice (firm_id, recall_number);
create unique index if not exists notice_token_idx on notice (claim_link_token_hash) where claim_link_token_hash is not null;

create table if not exists plan_task (
  id             serial primary key,
  firm_id        integer not null references firm (id) on delete cascade,
  recall_number  text references recall (number),
  parent_id      integer references plan_task (id) on delete cascade,
  name           text not null,
  kind           text not null default 'other'
                   check (kind in ('announcement', 'notice_wave', 'report', 'payout_batch', 'follow_up', 're_notice', 'milestone', 'other')),
  start_date     timestamptz,
  end_date       timestamptz,
  duration       numeric(8, 2),
  duration_unit  text not null default 'day',
  percent_done   numeric(5, 2) not null default 0 check (percent_done between 0 and 100),
  order_index    integer not null default 0,
  dependencies   jsonb not null default '[]',
  source         text not null default 'seed' check (source in ('seed', 'person', 'webhook', 'system')),
  ref            text,
  data           jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists plan_task_firm_idx on plan_task (firm_id, recall_number);
create index if not exists plan_task_ref_idx on plan_task (ref);

create table if not exists report (
  id               serial primary key,
  firm_id          integer not null references firm (id) on delete cascade,
  recall_number    text not null references recall (number),
  month            text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  numbers          jsonb not null,
  narrative        text,
  narrative_model  text,
  pdf              bytea,
  status           text not null default 'draft' check (status in ('draft', 'final', 'sent')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists report_firm_recall_month_idx on report (firm_id, recall_number, month);

create table if not exists image_hash (
  id             serial primary key,
  source         text not null check (source in ('official', 'claim')),
  ref            text not null,
  recall_number  text,
  dhash          text not null check (dhash ~ '^[0-9a-f]{16}$'),
  created_at     timestamptz not null default now()
);
create unique index if not exists image_hash_source_ref_idx on image_hash (source, ref);
create index if not exists image_hash_recall_idx on image_hash (recall_number);
create index if not exists image_hash_dhash_idx on image_hash (dhash);

-- Platform: keys, usage, the audit ledger, integrations, webhooks -----------------------------------------------

create table if not exists api_key (
  id            serial primary key,
  prefix        text not null,
  hash          text not null,
  name          text not null,
  email         text not null,
  purpose       text not null default '',
  scopes        jsonb not null default '["read","verify","payments:sandbox"]',
  owner_id      text not null,
  created_ip    text not null default '',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create unique index if not exists api_key_hash_idx on api_key (hash);

create table if not exists api_usage (
  id        serial primary key,
  key_id    integer references api_key (id),
  client    text not null default '',
  endpoint  text not null,
  status    integer not null,
  ms        integer not null,
  at        timestamptz not null default now()
);
create index if not exists api_usage_key_at_idx on api_usage (key_id, at);
create index if not exists api_usage_client_at_idx on api_usage (client, at);

-- AI spend: one row per live Claude call (replays from AI_CACHE_DIR cost nothing and are not logged). The spend
-- guard sums usd for the current UTC day; /status shows it in Technical view.
create table if not exists ai_usage (
  id                           serial primary key,
  at                           timestamptz not null default now(),
  route                        text not null,
  model                        text not null,
  effort                       text,
  batch                        boolean not null default false,
  input_tokens                 integer not null default 0,
  output_tokens                integer not null default 0,
  cache_read_input_tokens      integer not null default 0,
  cache_creation_input_tokens  integer not null default 0,
  usd                          numeric(12,6) not null default 0
);
create index if not exists ai_usage_at_idx on ai_usage (at);

-- Verification results, keyed by sha256(photo bytes) + recall number + proof-rule version + engine version, so the
-- same photo for the same recall is answered without a model call. source: live | precomputed (demo presets).
create table if not exists verify_result (
  key             text primary key,
  recall_number   text not null,
  photo_sha256    text not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  rule_version    text not null,
  engine_version  text not null,
  decision        text not null check (decision in ('verified', 'retake', 'firm_review')),
  result          jsonb not null,
  source          text not null default 'live' check (source in ('live', 'precomputed')),
  hits            integer not null default 0,
  created_at      timestamptz not null default now(),
  last_hit_at     timestamptz
);
create index if not exists verify_result_recall_idx on verify_result (recall_number);

create table if not exists audit_event (
  id         serial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null,
  ref        text not null,
  detail     jsonb not null default '{}',
  prev_hash  text not null,
  hash       text not null
);

create table if not exists integration_status (
  id             text primary key,
  mode           text not null check (mode in ('live', 'fallback', 'not_connected')),
  detail         text not null default '',
  last_ok_at     timestamptz,
  last_error_at  timestamptz,
  last_error     text,
  last_ms        integer,
  updated_at     timestamptz not null default now()
);

create table if not exists webhook_event (
  id             serial primary key,
  provider       text not null default 'paypal',
  event_id       text not null,
  event_type     text not null,
  resource_type  text,
  resource_id    text,
  verified       boolean not null default false,
  payload        jsonb not null,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  error          text
);
create unique index if not exists webhook_event_provider_event_idx on webhook_event (provider, event_id);
create index if not exists webhook_event_resource_idx on webhook_event (resource_id);

create table if not exists outbound_webhook (
  id                serial primary key,
  firm_id           integer references firm (id) on delete cascade,
  api_key_id        integer references api_key (id) on delete cascade,
  url               text not null,
  secret            text not null,
  events            jsonb not null default '["claim.verified","claim.paid","payout.unclaimed"]',
  active            boolean not null default true,
  last_status       integer,
  last_delivery_at  timestamptz,
  failures          integer not null default 0,
  created_at        timestamptz not null default now()
);

commit;
