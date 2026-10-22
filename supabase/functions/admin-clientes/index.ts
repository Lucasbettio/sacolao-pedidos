// Edge Function: admin-clientes
// Só admins chamam. Cria o login de um cliente, troca a senha ou bloqueia/libera o acesso.
// Deploy: supabase functions deploy admin-clientes
// Variáveis (Settings > Edge Functions > Secrets): LOGIN_DOMAIN (opcional)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LOGIN_DOMAIN = Deno.env.get("LOGIN_DOMAIN") ?? "clientes.sacolaodachacara.app";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const USUARIO_RE = /^[a-z0-9._-]{3,40}$/;
const CAMPOS = ["nome", "nome_fantasia", "documento", "telefone", "email_contato", "endereco",
  "bairro", "complemento", "cidade", "cep", "observacoes"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    // Confere quem chamou e se está na tabela de admins
    const { data: quem } = await admin.auth.getUser(token);
    if (!quem?.user) return json({ error: "Sessão expirada. Saia e entre de novo." }, 401);
    const { data: ehAdmin } = await admin.from("admins").select("user_id").eq("user_id", quem.user.id).maybeSingle();
    if (!ehAdmin) return json({ error: "Acesso restrito aos administradores." }, 403);
    const body = await req.json();

    if (body.acao === "criar") {
      const usuario = String(body.usuario ?? "").trim().toLowerCase();
      const senha = String(body.senha ?? "");
      if (!USUARIO_RE.test(usuario))
        return json({ error: "Usuário deve ter de 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou _." }, 400);
      if (senha.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
      if (!String(body.nome ?? "").trim()) return json({ error: "Informe o nome do cliente." }, 400);

      const { data: existe } = await admin.from("clientes").select("id").eq("usuario", usuario).maybeSingle();
      if (existe) return json({ error: "Esse usuário já existe." }, 409);

      const { data: u, error: e2 } = await admin.auth.admin.createUser({
        email: `${usuario}@${LOGIN_DOMAIN}`, password: senha, email_confirm: true,
        user_metadata: { tipo: "cliente", usuario },
      });
      if (e2 || !u.user) return json({ error: e2?.message ?? "Não foi possível criar o login." }, 400);

      const row: Record<string, unknown> = { user_id: u.user.id, usuario };
      for (const k of CAMPOS) if (body[k] !== undefined) row[k] = body[k] === "" ? null : body[k];
      if (row.documento) row.documento = String(row.documento).replace(/\D/g, "");
      const { data: cli, error: e3 } = await admin.from("clientes").insert(row).select().single();
      if (e3) {
        await admin.auth.admin.deleteUser(u.user.id);
        return json({ error: e3.message }, 400);
      }
      return json({ cliente: cli });
    }

    if (body.acao === "senha") {
      const senha = String(body.senha ?? "");
      if (senha.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
      const { data: cli } = await admin.from("clientes").select("user_id").eq("id", body.cliente_id).single();
      if (!cli?.user_id) return json({ error: "Cliente sem login." }, 404);
      const { error } = await admin.auth.admin.updateUserById(cli.user_id, { password: senha });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.acao === "ativo") {
      const ativo = !!body.ativo;
      const { data: cli } = await admin.from("clientes").select("user_id").eq("id", body.cliente_id).single();
      if (!cli) return json({ error: "Cliente não encontrado." }, 404);
      if (cli.user_id) {
        const { error } = await admin.auth.admin.updateUserById(cli.user_id, { ban_duration: ativo ? "none" : "876000h" });
        if (error) return json({ error: error.message }, 400);
      }
      await admin.from("clientes").update({ ativo }).eq("id", body.cliente_id);
      return json({ ok: true });
    }

    return json({ error: "Ação desconhecida." }, 400);
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
