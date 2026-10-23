-- =====================================================================
-- Sacolão da Chácara · Ofertas do dia e histórico de preços
-- Rode no SQL Editor depois do 0005.
-- =====================================================================

-- ---------- Ofertas ----------
alter table public.produtos add column if not exists preco_oferta numeric(10,2)
  check (preco_oferta is null or preco_oferta >= 0);
alter table public.produtos add column if not exists oferta_ate date;

-- Preço que vale hoje: oferta (até a data, inclusive) ou o preço normal
create or replace function public.preco_vigente(p public.produtos)
returns numeric language sql stable as $$
  select case
    when p.preco_oferta is not null
     and (p.oferta_ate is null or p.oferta_ate >= (now() at time zone 'America/Sao_Paulo')::date)
    then p.preco_oferta else p.preco end;
$$;

-- Pedido do cliente usa o preço vigente (com oferta)
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
            case when v_prod.unidade = v_un then public.preco_vigente(v_prod) end);
  end loop;
  return v_num;
end $$;

-- ---------- Histórico de preços ----------
-- Cada mudança de preço (ou de oferta) fica registrada. Base para variação e índice de preços.
create table if not exists public.produto_precos (
  id           bigint generated always as identity primary key,
  produto_id   bigint not null references public.produtos on delete cascade,
  preco        numeric(10,2),
  preco_oferta numeric(10,2),
  em           timestamptz not null default now()
);
create index if not exists produto_precos_idx on public.produto_precos (produto_id, em desc);
alter table public.produto_precos enable row level security;
drop policy if exists produto_precos_adm on public.produto_precos;
create policy produto_precos_adm on public.produto_precos for select to authenticated using (public.is_admin());

create or replace function public.tg_produto_hist()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.preco is distinct from old.preco or new.preco_oferta is distinct from old.preco_oferta then
    insert into public.produto_precos (produto_id, preco, preco_oferta) values (new.id, new.preco, new.preco_oferta);
  end if;
  return null;
end $$;
drop trigger if exists produtos_hist_aiu on public.produtos;
create trigger produtos_hist_aiu after insert or update on public.produtos
  for each row execute function public.tg_produto_hist();

-- Ponto de partida do histórico: o preço atual de cada produto
insert into public.produto_precos (produto_id, preco, preco_oferta)
select p.id, p.preco, p.preco_oferta from public.produtos p
where p.preco is not null and not exists (select 1 from public.produto_precos h where h.produto_id = p.id);

-- Variação: preço atual x preço de N dias atrás (só admin)
create or replace function public.variacao_precos(p_dias int default 7)
returns table (produto_id bigint, preco_atual numeric, preco_antes numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.preco,
         (select h.preco from public.produto_precos h
           where h.produto_id = p.id and h.em <= now() - make_interval(days => p_dias)
           order by h.em desc limit 1)
    from public.produtos p
   where public.is_admin() and p.ativo;
$$;

revoke execute on function public.variacao_precos(int) from anon, public;
grant execute on function public.variacao_precos(int) to authenticated;
revoke execute on function public.tg_produto_hist() from anon, public;
