-- =====================================================================
-- Sacolão da Chácara · Ajustes pós-apresentação
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez),
-- depois de 0001 e 0002.
--  1. "maço" passa a ser "molho"
--  2. Produtos com preço (aparece para o cliente e já vai no pedido)
--  3. Fluxo sem aprovação: Novo → Em preparo → Em entrega → Entregue
--  4. Lista de compras da Ceasa (itens dos pedidos somados)
-- =====================================================================

-- ---------- 1. molho ----------
alter table public.produtos drop constraint if exists produtos_unidade_check;
update public.produtos     set unidade = 'molho' where unidade = 'maço';
update public.pedido_itens set unidade = 'molho' where unidade = 'maço';
alter table public.produtos add constraint produtos_unidade_check
  check (unidade in ('kg','un','molho','dúzia','bandeja'));

-- ---------- 2. preço do produto ----------
alter table public.produtos add column if not exists preco numeric(10,2)
  check (preco is null or preco >= 0);
update public.produtos set preco = ultimo_preco where preco is null and ultimo_preco is not null;

create or replace function public.tg_produto_preco()
returns trigger language plpgsql as $$
begin
  if new.preco is distinct from old.preco then new.preco_em := current_date; end if;
  return new;
end $$;
drop trigger if exists produtos_preco_bu on public.produtos;
create trigger produtos_preco_bu before update on public.produtos
  for each row execute function public.tg_produto_preco();

-- ---------- 3. fluxo sem aprovação ----------
update public.pedidos set status = 'preparando' where status = 'aprovado';

create or replace function public.tg_pedido_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if (tg_op = 'INSERT' or new.status is distinct from old.status) and new.status = 'entregue' then
    new.entregue_em := now();
  end if;
  return new;
end $$;

create or replace function public.tg_pedido_evento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.pedido_eventos (pedido_id, status) values (new.id, new.status);
  end if;
  return null;
end $$;

-- Pedido do cliente: o preço do catálogo já vai em cada item
create or replace function public.criar_pedido(
  p_entrega_data date, p_entrega_turno text, p_endereco text, p_pagamento text,
  p_aceita_substituicao boolean, p_observacoes text, p_itens jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_cliente uuid := public.meu_cliente_id();
  v_id uuid; v_num bigint; v_item jsonb; v_prod public.produtos; v_un text;
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
    v_un := case when v_item->>'unidade' in ('kg','un','molho','dúzia','bandeja')
                 then v_item->>'unidade' else 'un' end;
    insert into public.pedido_itens (pedido_id, produto_id, nome, quantidade, unidade, preco_unitario)
    values (v_id, v_prod.id,
            coalesce(v_prod.nome, left(trim(v_item->>'nome'),120)),
            (v_item->>'quantidade')::numeric,
            v_un,
            case when v_prod.unidade = v_un then v_prod.preco end);
  end loop;
  return v_num;
end $$;

-- Dashboard: todo pedido não cancelado já tem valor
create or replace function public.dashboard(p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  with base as (
    select r.*, (r.created_at at time zone 'America/Sao_Paulo')::date as dia
      from public.pedidos_resumo r
     where (r.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ), validos as (select * from base where status <> 'cancelado')
  select jsonb_build_object(
    'pedidos',      (select count(*) from validos),
    'cancelados',   (select count(*) from base where status = 'cancelado'),
    'aguardando',   (select count(*) from public.pedidos where status = 'recebido'),
    'faturamento',  (select coalesce(sum(total),0) from validos),
    'ticket_medio', (select coalesce(avg(total),0) from validos),
    'clientes',     (select count(distinct cliente_id) from validos),
    'por_dia', (select coalesce(jsonb_agg(d order by d.dia),'[]') from (
        select g::date as dia,
               count(b.id) filter (where b.status <> 'cancelado') as pedidos,
               coalesce(sum(b.total) filter (where b.status <> 'cancelado'),0) as faturamento
          from generate_series(p_de, p_ate, interval '1 day') g
          left join base b on b.dia = g::date
         group by g) d),
    'por_status', (select coalesce(jsonb_object_agg(status, n),'{}') from (
        select status, count(*) n from base group by status) s),
    'por_dia_semana', (select coalesce(jsonb_agg(w order by w.dow),'[]') from (
        select extract(dow from dia)::int dow, count(*) pedidos from validos group by 1) w),
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

-- ---------- 4. lista da Ceasa ----------
-- Soma os itens dos pedidos com entrega no período, por produto e unidade.
create or replace function public.lista_compras(p_de date, p_ate date, p_status text[] default array['recebido','preparando'])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  select jsonb_build_object(
    'pedidos', (select count(*) from public.pedidos p
                 where p.entrega_data between p_de and p_ate and p.status::text = any(p_status)),
    'itens', coalesce((select jsonb_agg(t order by t.ordem_cat, t.categoria, t.nome) from (
        select coalesce(pr.categoria, 'Fora do catálogo') as categoria,
               case when pr.id is null then 1 else 0 end as ordem_cat,
               coalesce(pr.nome, pi.nome) as nome,
               pi.unidade,
               sum(pi.quantidade) as quantidade,
               count(distinct p.id) as pedidos,
               jsonb_agg(jsonb_build_object(
                 'numero', p.numero, 'cliente', coalesce(c.nome_fantasia, c.nome),
                 'quantidade', pi.quantidade, 'entrega', p.entrega_data, 'turno', p.entrega_turno)
                 order by p.entrega_data, p.numero) as detalhe
          from public.pedido_itens pi
          join public.pedidos p  on p.id = pi.pedido_id
          join public.clientes c on c.id = p.cliente_id
          left join public.produtos pr on pr.id = pi.produto_id
         where p.entrega_data between p_de and p_ate
           and p.status::text = any(p_status)
           and not pi.em_falta
         group by 1, 2, 3, 4) t), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke execute on function public.lista_compras(date,date,text[]) from anon, public;
grant execute on function public.lista_compras(date,date,text[]) to authenticated;
revoke execute on function public.tg_produto_preco() from anon, public;
