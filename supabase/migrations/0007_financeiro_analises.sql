-- =====================================================================
-- Sacolão da Chácara · Financeiro (conta corrente por cliente), notas
-- fiscais e análise mensal. Rode no SQL Editor depois do 0006.
-- =====================================================================

-- ---------- Pedido sem forma de pagamento (cobrança é feita depois) ----------
alter table public.pedidos alter column pagamento drop not null;

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
  values (v_cliente, p_entrega_data, p_entrega_turno, left(trim(p_endereco),300),
          nullif(left(trim(coalesce(p_pagamento,'')),40),''),
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
            coalesce(v_prod.nome, nullif(left(trim(v_item->>'nome'),120),''), 'Item'),
            (v_item->>'quantidade')::numeric,
            v_un,
            case when v_prod.unidade = v_un then public.preco_vigente(v_prod) end);
  end loop;
  return v_num;
end $$;

-- ---------- Notas fiscais ----------
create table if not exists public.notas_fiscais (
  id          bigint generated always as identity primary key,
  cliente_id  uuid not null references public.clientes on delete restrict,
  numero      text not null,
  emitida_em  date not null default (now() at time zone 'America/Sao_Paulo')::date,
  valor       numeric(12,2) not null check (valor >= 0),
  observacao  text,
  created_at  timestamptz not null default now()
);
create index if not exists notas_cliente_idx on public.notas_fiscais (cliente_id, emitida_em desc);
alter table public.pedidos add column if not exists nota_id bigint references public.notas_fiscais on delete set null;
create index if not exists pedidos_nota_idx on public.pedidos (nota_id);

-- ---------- Pagamentos (valor livre, não precisa bater com pedido) ----------
create table if not exists public.pagamentos (
  id          bigint generated always as identity primary key,
  cliente_id  uuid not null references public.clientes on delete restrict,
  valor       numeric(12,2) not null check (valor > 0),
  pago_em     date not null default (now() at time zone 'America/Sao_Paulo')::date,
  forma       text,
  observacao  text,
  created_at  timestamptz not null default now()
);
create index if not exists pagamentos_cliente_idx on public.pagamentos (cliente_id, pago_em desc);

alter table public.notas_fiscais enable row level security;
alter table public.pagamentos    enable row level security;
drop policy if exists notas_adm on public.notas_fiscais;
create policy notas_adm on public.notas_fiscais for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists pagamentos_adm on public.pagamentos;
create policy pagamentos_adm on public.pagamentos for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- A view de resumo precisa ser recriada para enxergar a coluna nova nota_id
drop view if exists public.pedidos_resumo;
create view public.pedidos_resumo with (security_invoker = true) as
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
grant select on public.pedidos_resumo to authenticated;
revoke all on public.pedidos_resumo from anon;

-- Registrar nota cobrindo vários pedidos de uma vez
create or replace function public.registrar_nota(p_cliente uuid, p_numero text, p_emitida_em date,
                                                 p_valor numeric, p_pedidos uuid[], p_obs text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  if coalesce(trim(p_numero),'') = '' then raise exception 'Informe o número da nota'; end if;
  if exists (select 1 from public.pedidos where id = any(p_pedidos) and cliente_id <> p_cliente) then
    raise exception 'Há pedidos de outro cliente na seleção'; end if;
  insert into public.notas_fiscais (cliente_id, numero, emitida_em, valor, observacao)
  values (p_cliente, trim(p_numero), coalesce(p_emitida_em, (now() at time zone 'America/Sao_Paulo')::date),
          p_valor, nullif(trim(p_obs),''))
  returning id into v_id;
  update public.pedidos set nota_id = v_id where id = any(p_pedidos);
  return v_id;
end $$;

-- ---------- Resumo financeiro por cliente ----------
-- Faturado = pedidos entregues. Em aberto = faturado − pago.
create or replace function public.financeiro_resumo(p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  with fat as (
    select cliente_id, sum(total) total, count(*) n,
           count(*) filter (where nota_id is null) sem_nota,
           sum(total) filter (where nota_id is null) valor_sem_nota,
           max(entrega_data) ultima_entrega
      from public.pedidos_resumo where status = 'entregue' group by cliente_id
  ), andamento as (
    select cliente_id, sum(total) total, count(*) n
      from public.pedidos_resumo where status in ('recebido','preparando','em_entrega','aprovado') group by cliente_id
  ), pag as (
    select cliente_id, sum(valor) total, max(pago_em) ultimo from public.pagamentos group by cliente_id
  ), clientes_mov as (
    select id, coalesce(nome_fantasia, nome) nome from public.clientes c
     where exists (select 1 from fat where fat.cliente_id = c.id)
        or exists (select 1 from pag where pag.cliente_id = c.id)
        or exists (select 1 from andamento a where a.cliente_id = c.id)
  )
  select jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object(
        'cliente_id', c.id, 'nome', c.nome,
        'faturado', coalesce(f.total,0), 'pedidos', coalesce(f.n,0),
        'pago', coalesce(p.total,0), 'saldo', coalesce(f.total,0) - coalesce(p.total,0),
        'em_andamento', coalesce(a.total,0), 'sem_nota', coalesce(f.sem_nota,0),
        'valor_sem_nota', coalesce(f.valor_sem_nota,0),
        'ultimo_pagamento', p.ultimo, 'ultima_entrega', f.ultima_entrega)
        order by coalesce(f.total,0) - coalesce(p.total,0) desc, c.nome)
      from clientes_mov c left join fat f on f.cliente_id = c.id
      left join pag p on p.cliente_id = c.id left join andamento a on a.cliente_id = c.id), '[]'),
    'periodo', jsonb_build_object(
      'faturado', (select coalesce(sum(total),0) from public.pedidos_resumo where status = 'entregue' and entrega_data between p_de and p_ate),
      'recebido', (select coalesce(sum(valor),0) from public.pagamentos where pago_em between p_de and p_ate),
      'notas',    (select coalesce(sum(valor),0) from public.notas_fiscais where emitida_em between p_de and p_ate))
  ) into r;
  return r;
end $$;

-- ---------- Extrato (conta corrente) de um cliente ----------
create or replace function public.extrato_cliente(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  select jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'data', p.entrega_data, 'status', p.status, 'total', p.total,
        'nota_id', p.nota_id, 'nota_numero', n.numero) order by p.entrega_data desc, p.numero desc)
      from public.pedidos_resumo p left join public.notas_fiscais n on n.id = p.nota_id
      where p.cliente_id = p_cliente and p.status <> 'cancelado'), '[]'),
    'pagamentos', coalesce((select jsonb_agg(to_jsonb(g) order by g.pago_em desc, g.id desc)
      from public.pagamentos g where g.cliente_id = p_cliente), '[]'),
    'notas', coalesce((select jsonb_agg(to_jsonb(n) order by n.emitida_em desc, n.id desc)
      from public.notas_fiscais n where n.cliente_id = p_cliente), '[]')
  ) into r;
  return r;
end $$;

-- ---------- Análise mensal (por data de entrega) ----------
create or replace function public.analise_mensal(p_meses int default 12)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini date := (date_trunc('month', v_hoje) - make_interval(months => greatest(p_meses,1) - 1))::date;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  with base as (
    select p.*, to_char(p.entrega_data, 'YYYY-MM') mes
      from public.pedidos_resumo p
     where p.status <> 'cancelado' and p.entrega_data >= v_ini
  )
  select jsonb_build_object(
    'hoje', v_hoje,
    'meses', (select jsonb_agg(jsonb_build_object(
        'mes', to_char(g, 'YYYY-MM'),
        'faturamento', coalesce((select sum(total) from base b where b.mes = to_char(g,'YYYY-MM')),0),
        'pedidos', (select count(*) from base b where b.mes = to_char(g,'YYYY-MM')),
        'clientes', (select count(distinct cliente_id) from base b where b.mes = to_char(g,'YYYY-MM')))
        order by g)
      from generate_series(v_ini, date_trunc('month', v_hoje), interval '1 month') g),
    'mes_atual', jsonb_build_object(
      'realizado', (select coalesce(sum(total),0) from base where mes = to_char(v_hoje,'YYYY-MM') and entrega_data <= v_hoje),
      'agendado',  (select coalesce(sum(total),0) from base where mes = to_char(v_hoje,'YYYY-MM') and entrega_data > v_hoje),
      'dia', extract(day from v_hoje)::int,
      'dias_mes', extract(day from (date_trunc('month', v_hoje) + interval '1 month - 1 day'))::int),
    'clientes', coalesce((select jsonb_agg(x order by x.total desc) from (
        select b.cliente_id, coalesce(b.cliente_fantasia, b.cliente_nome) nome,
               sum(b.total) total, count(*) pedidos,
               jsonb_object_agg_strict_mes.meses,
               max(b.entrega_data) ultimo, min(b.entrega_data) primeiro
          from base b
          cross join lateral (
            select jsonb_object_agg(m.mes, m.v) meses from (
              select b2.mes, sum(b2.total) v from base b2 where b2.cliente_id = b.cliente_id group by b2.mes) m
          ) jsonb_object_agg_strict_mes
         group by b.cliente_id, coalesce(b.cliente_fantasia, b.cliente_nome), jsonb_object_agg_strict_mes.meses) x), '[]')
  ) into r;
  return r;
end $$;

revoke execute on function public.registrar_nota(uuid,text,date,numeric,uuid[],text) from anon, public;
revoke execute on function public.financeiro_resumo(date,date) from anon, public;
revoke execute on function public.extrato_cliente(uuid) from anon, public;
revoke execute on function public.analise_mensal(int) from anon, public;
grant execute on function public.registrar_nota(uuid,text,date,numeric,uuid[],text) to authenticated;
grant execute on function public.financeiro_resumo(date,date) to authenticated;
grant execute on function public.extrato_cliente(uuid) to authenticated;
grant execute on function public.analise_mensal(int) to authenticated;
