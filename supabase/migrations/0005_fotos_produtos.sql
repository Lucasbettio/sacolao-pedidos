-- =====================================================================
-- Sacolão da Chácara · Fotos dos produtos (Supabase Storage)
-- Rode no SQL Editor depois do 0004. Cria a pasta pública "produtos":
-- todo mundo vê as fotos, só admin envia, troca ou apaga.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produtos', 'produtos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "fotos_produtos_admin_insert" on storage.objects;
create policy "fotos_produtos_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "fotos_produtos_admin_update" on storage.objects;
create policy "fotos_produtos_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'produtos' and public.is_admin());

drop policy if exists "fotos_produtos_admin_delete" on storage.objects;
create policy "fotos_produtos_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'produtos' and public.is_admin());
