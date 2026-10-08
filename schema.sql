-- Lead sheet for the AI lead responder. Apply: docker exec -i va-pg psql -U va -d va < schema.sql
create table if not exists leads (
  id serial primary key,
  name text,
  email text,
  message text,
  reply text,
  created_at timestamptz default now()
);
