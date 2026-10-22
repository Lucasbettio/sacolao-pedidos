-- =====================================================================
-- Sacolão da Chácara · Sistema de pedidos
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos ----------
do $$ begin
  create type public.pedido_status as enum
    ('recebido','aprovado','preparando','em_entrega','entregue','cancelado');
exception when duplicate_object then null; end $$;

-- ---------- Admins (donos) ----------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  nome       text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Clientes (cadastrados pelo admin) ----------
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid unique references auth.users on delete set null,
  usuario        text not null unique check (usuario ~ '^[a-z0-9._-]{3,40}$'),
  nome           text not null,              -- razão social ou nome
  nome_fantasia  text,
  documento      text,                       -- CNPJ/CPF, só dígitos
  telefone       text,
  email_contato  text,
  endereco       text,
  bairro         text,
  complemento    text,
  cidade         text default 'Porto Alegre',
  cep            text,
  observacoes    text,                       -- notas internas (só admin vê na tela)
  ativo          boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists clientes_documento_idx on public.clientes (documento);

create or replace function public.meu_cliente_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.clientes where user_id = auth.uid() and ativo;
$$;

-- ---------- Produtos ----------
create table if not exists public.produtos (
  id             bigint generated always as identity primary key,
  nome           text not null unique,
  categoria      text not null,
  unidade        text not null check (unidade in ('kg','un','maço','dúzia','bandeja')),
  aceita_unidade boolean not null default false,  -- produto por kg que também pode ser pedido por unidade
  ativo          boolean not null default true,
  ordem          int not null default 0,
  ultimo_preco   numeric(10,2),                   -- atualizado quando um pedido é aprovado
  preco_em       date
);

-- ---------- Pedidos ----------
create table if not exists public.pedidos (
  id                  uuid primary key default gen_random_uuid(),
  numero              bigint generated always as identity (start with 1001) unique,
  cliente_id          uuid not null references public.clientes on delete restrict,
  status              public.pedido_status not null default 'recebido',
  entrega_data        date not null,
  entrega_turno       text not null check (entrega_turno in ('manhã','tarde')),
  endereco_entrega    text not null,
  pagamento           text not null,
  aceita_substituicao boolean not null default true,
  observacoes         text,
  taxa_entrega        numeric(10,2) not null default 0,
  desconto            numeric(10,2) not null default 0,
  nota_admin          text,                         -- recado ao cliente (aparece para ele)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  aprovado_em         timestamptz,
  entregue_em         timestamptz
);
create index if not exists pedidos_cliente_idx on public.pedidos (cliente_id, created_at desc);
create index if not exists pedidos_status_idx  on public.pedidos (status, entrega_data);

create table if not exists public.pedido_itens (
  id               bigint generated always as identity primary key,
  pedido_id        uuid not null references public.pedidos on delete cascade,
  produto_id       bigint references public.produtos on delete set null,
  nome             text not null,
  quantidade       numeric(10,3) not null check (quantidade > 0),
  unidade          text not null,
  quantidade_final numeric(10,3),     -- peso/quantidade real separada
  preco_unitario   numeric(10,2),
  em_falta         boolean not null default false
);
create index if not exists pedido_itens_pedido_idx on public.pedido_itens (pedido_id);

create table if not exists public.pedido_eventos (
  id         bigint generated always as identity primary key,
  pedido_id  uuid not null references public.pedidos on delete cascade,
  status     public.pedido_status not null,
  autor      uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pedido_eventos_pedido_idx on public.pedido_eventos (pedido_id, created_at);

-- ---------- Resumo com totais ----------
create or replace view public.pedidos_resumo with (security_invoker = true) as
select p.*,
       c.nome          as cliente_nome,
       c.nome_fantasia as cliente_fantasia,
       c.telefone      as cliente_telefone,
       coalesce(i.itens, 0)    as itens,
       coalesce(i.sem_preco,0) as itens_sem_preco,
       coalesce(i.subtotal,0)  as subtotal,
       greatest(coalesce(i.subtotal,0) + p.taxa_entrega - p.desconto, 0) as total
from public.pedidos p
join public.clientes c on c.id = p.cliente_id
left join lateral (
  select count(*)                                                          as itens,
         count(*) filter (where not em_falta and preco_unitario is null)   as sem_preco,
         sum(coalesce(quantidade_final, quantidade) * preco_unitario)
           filter (where not em_falta)                                     as subtotal
  from public.pedido_itens pi where pi.pedido_id = p.id
) i on true;

-- ---------- Gatilhos ----------
create or replace function public.tg_pedido_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'aprovado' and new.aprovado_em is null then new.aprovado_em := now(); end if;
    if new.status = 'entregue' then new.entregue_em := now(); end if;
  end if;
  return new;
end $$;

drop trigger if exists pedidos_status_bi on public.pedidos;
create trigger pedidos_status_bi before insert or update on public.pedidos
  for each row execute function public.tg_pedido_status();

create or replace function public.tg_pedido_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.pedido_eventos (pedido_id, status) values (new.id, new.status);
    -- Ao aprovar, guarda o preço praticado como referência para os próximos pedidos
    if new.status = 'aprovado' then
      update public.produtos pr
         set ultimo_preco = pi.preco_unitario, preco_em = current_date
        from public.pedido_itens pi
       where pi.pedido_id = new.id and pi.produto_id = pr.id
         and pi.preco_unitario is not null and not pi.em_falta
         and pi.unidade = pr.unidade;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists pedidos_evento_ai on public.pedidos;
create trigger pedidos_evento_ai after insert or update on public.pedidos
  for each row execute function public.tg_pedido_evento();

-- ---------- Funções chamadas pelo app ----------

-- Cliente cria pedido (pedido + itens numa só transação)
create or replace function public.criar_pedido(
  p_entrega_data date, p_entrega_turno text, p_endereco text, p_pagamento text,
  p_aceita_substituicao boolean, p_observacoes text, p_itens jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid := public.meu_cliente_id();
  v_id uuid; v_num bigint; v_item jsonb; v_prod public.produtos;
begin
  if v_cliente is null then raise exception 'Acesso de cliente não encontrado ou inativo'; end if;
  if p_entrega_data < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data de entrega já passou'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido está vazio'; end if;
  if jsonb_array_length(p_itens) > 150 then raise exception 'Pedido com itens demais'; end if;

  insert into public.pedidos (cliente_id, entrega_data, entrega_turno, endereco_entrega, pagamento,
                              aceita_substituicao, observacoes)
  values (v_cliente, p_entrega_data, p_entrega_turno, left(trim(p_endereco),300), left(p_pagamento,40),
          coalesce(p_aceita_substituicao,true), left(nullif(trim(p_observacoes),''),1000))
  returning id, numero into v_id, v_num;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_prod := null;
    if (v_item->>'produto_id') is not null then
      select * into v_prod from public.produtos where id = (v_item->>'produto_id')::bigint and ativo;
    end if;
    insert into public.pedido_itens (pedido_id, produto_id, nome, quantidade, unidade)
    values (v_id, v_prod.id,
            coalesce(v_prod.nome, left(trim(v_item->>'nome'),120)),
            (v_item->>'quantidade')::numeric,
            case when v_item->>'unidade' in ('kg','un','maço','dúzia','bandeja')
                 then v_item->>'unidade' else 'un' end);
  end loop;
  return v_num;
end $$;

-- Cliente cancela enquanto ainda não foi aprovado
create or replace function public.cancelar_pedido(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.pedidos set status = 'cancelado'
   where id = p_id and cliente_id = public.meu_cliente_id() and status = 'recebido';
  if not found then raise exception 'Este pedido não pode mais ser cancelado pelo site'; end if;
end $$;

-- Dashboard (só admin)
create or replace function public.dashboard(p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  with base as (
    select r.*, (r.created_at at time zone 'America/Sao_Paulo')::date as dia
      from public.pedidos_resumo r
     where (r.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ), validos as (select * from base where status not in ('recebido','cancelado'))
  select jsonb_build_object(
    'pedidos',      (select count(*) from base where status <> 'cancelado'),
    'cancelados',   (select count(*) from base where status = 'cancelado'),
    'aguardando',   (select count(*) from public.pedidos where status = 'recebido'),
    'faturamento',  (select coalesce(sum(total),0) from validos),
    'ticket_medio', (select coalesce(avg(total),0) from validos),
    'clientes',     (select count(distinct cliente_id) from base where status <> 'cancelado'),
    'por_dia', (select coalesce(jsonb_agg(d order by d.dia),'[]') from (
        select g::date as dia,
               count(b.id) filter (where b.status <> 'cancelado') as pedidos,
               coalesce(sum(b.total) filter (where b.status not in ('recebido','cancelado')),0) as faturamento
          from generate_series(p_de, p_ate, interval '1 day') g
          left join base b on b.dia = g::date
         group by g) d),
    'por_status', (select coalesce(jsonb_object_agg(status, n),'{}') from (
        select status, count(*) n from base group by status) s),
    'por_dia_semana', (select coalesce(jsonb_agg(w order by w.dow),'[]') from (
        select extract(dow from dia)::int dow, count(*) pedidos from base
         where status <> 'cancelado' group by 1) w),
    'top_produtos', (select coalesce(jsonb_agg(t),'[]') from (
        select pi.nome, pi.unidade,
               sum(coalesce(pi.quantidade_final,pi.quantidade)) as quantidade,
               coalesce(sum(coalesce(pi.quantidade_final,pi.quantidade)*pi.preco_unitario),0) as valor,
               count(distinct pi.pedido_id) as pedidos
          from public.pedido_itens pi join validos v on v.id = pi.pedido_id
         where not pi.em_falta
         group by pi.nome, pi.unidade order by valor desc, quantidade desc limit 10) t),
    'top_clientes', (select coalesce(jsonb_agg(t),'[]') from (
        select coalesce(cliente_fantasia, cliente_nome) as nome, count(*) pedidos, sum(total) valor
          from validos group by 1 order by valor desc limit 10) t),
    'em_falta', (select coalesce(jsonb_agg(t),'[]') from (
        select pi.nome, count(*) vezes
          from public.pedido_itens pi join base b on b.id = pi.pedido_id
         where pi.em_falta group by pi.nome order by vezes desc limit 8) t)
  ) into r;
  return r;
end $$;

-- ---------- Segurança (RLS) ----------
alter table public.admins          enable row level security;
alter table public.clientes        enable row level security;
alter table public.produtos        enable row level security;
alter table public.pedidos         enable row level security;
alter table public.pedido_itens    enable row level security;
alter table public.pedido_eventos  enable row level security;

drop policy if exists admins_sel on public.admins;
create policy admins_sel on public.admins for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists clientes_sel on public.clientes;
create policy clientes_sel on public.clientes for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists clientes_adm on public.clientes;
create policy clientes_adm on public.clientes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists produtos_sel on public.produtos;
create policy produtos_sel on public.produtos for select to authenticated
  using (ativo or public.is_admin());
drop policy if exists produtos_adm on public.produtos;
create policy produtos_adm on public.produtos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists pedidos_sel on public.pedidos;
create policy pedidos_sel on public.pedidos for select to authenticated
  using (cliente_id = public.meu_cliente_id() or public.is_admin());
drop policy if exists pedidos_adm on public.pedidos;
create policy pedidos_adm on public.pedidos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists itens_sel on public.pedido_itens;
create policy itens_sel on public.pedido_itens for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.pedidos p where p.id = pedido_id and p.cliente_id = public.meu_cliente_id()));
drop policy if exists itens_adm on public.pedido_itens;
create policy itens_adm on public.pedido_itens for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists eventos_sel on public.pedido_eventos;
create policy eventos_sel on public.pedido_eventos for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.pedidos p where p.id = pedido_id and p.cliente_id = public.meu_cliente_id()));

-- Nada é acessível sem login
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_admin(), public.meu_cliente_id(), public.criar_pedido(date,text,text,text,boolean,text,jsonb),
  public.cancelar_pedido(uuid), public.dashboard(date,date) to authenticated;
grant select on public.pedidos_resumo to authenticated;

-- Tempo real (painel atualiza sozinho quando chega pedido)
do $$ begin
  alter publication supabase_realtime add table public.pedidos;
exception when duplicate_object then null; when undefined_object then null; end $$;
