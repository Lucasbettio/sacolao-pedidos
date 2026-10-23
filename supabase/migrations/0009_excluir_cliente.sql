-- =====================================================================
-- Sacolão da Chácara · Excluir cliente (e o login dele)
-- Só exclui quem não tem pedidos, pagamentos nem notas; para os demais,
-- use "Bloquear" (o histórico precisa continuar existindo).
-- Rode no SQL Editor depois do 0008.
-- =====================================================================

create or replace function public.historico_cliente(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'pedidos',    (select count(*) from public.pedidos where cliente_id = p_id),
    'pagamentos', (select count(*) from public.pagamentos where cliente_id = p_id),
    'notas',      (select count(*) from public.notas_fiscais where cliente_id = p_id)) end;
$$;

create or replace function public.excluir_cliente(p_id uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid; v_hist jsonb;
begin
  if not public.is_admin() then raise exception 'Acesso restrito'; end if;
  select user_id into v_user from public.clientes where id = p_id;
  if not found then raise exception 'Cliente não encontrado'; end if;
  v_hist := public.historico_cliente(p_id);
  if (v_hist->>'pedidos')::int + (v_hist->>'pagamentos')::int + (v_hist->>'notas')::int > 0 then
    raise exception 'Este cliente tem histórico (pedidos, pagamentos ou notas) e não pode ser excluído. Use Bloquear.';
  end if;
  delete from public.clientes where id = p_id;
  if v_user is not null then delete from auth.users where id = v_user; end if;
end $$;

revoke execute on function public.historico_cliente(uuid) from anon, public;
revoke execute on function public.excluir_cliente(uuid) from anon, public;
grant execute on function public.historico_cliente(uuid) to authenticated;
grant execute on function public.excluir_cliente(uuid) to authenticated;
