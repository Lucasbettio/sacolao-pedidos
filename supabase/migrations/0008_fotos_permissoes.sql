-- =====================================================================
-- Sacolão da Chácara · Correção das permissões das fotos
-- Erro corrigido: "new row violates row-level security policy" ao enviar foto.
-- O Storage exige permissão de leitura (SELECT) para gravar e apagar arquivos.
-- Pode rodar mesmo que o 0005 não tenha sido rodado: cria tudo o que falta.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos_produtos_leitura" on storage.objects;
create policy "fotos_produtos_leitura" on storage.objects for select to authenticated
  using (bucket_id = 'produtos');

drop policy if exists "fotos_produtos_admin_insert" on storage.objects;
create policy "fotos_produtos_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "fotos_produtos_admin_update" on storage.objects;
create policy "fotos_produtos_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and public.is_admin())
  with check (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "fotos_produtos_admin_delete" on storage.objects;
create policy "fotos_produtos_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and public.is_admin());

-- Conferência: deve listar as 4 regras acima
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'fotos_produtos%';
