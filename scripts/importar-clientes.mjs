// Importa os clientes que já existem no sistema da loja e cria o login de cada um.
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importar-clientes.mjs clientes.csv
//
// CSV com cabeçalho, separado por ; ou , (exemplo em scripts/clientes-exemplo.csv).
// Colunas aceitas: usuario, senha, nome, nome_fantasia, documento, telefone, email_contato,
//                  endereco, bairro, complemento, cidade, cep, observacoes
// - "usuario" vazio: gerado a partir do nome fantasia ou nome.
// - "senha" vazia: gerada uma senha provisória.
// Gera "credenciais-<data>.csv" com usuário e senha de quem foi criado, para repassar aos clientes.
// A chave service_role dá acesso total ao banco: rode só no seu computador e nunca a coloque no site.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const LOGIN_DOMAIN = process.env.LOGIN_DOMAIN ?? "clientes.sacolaodachacara.app";
const arquivo = process.argv[2];
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !arquivo) {
  console.error("Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importar-clientes.mjs clientes.csv");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function parseCSV(txt) {
  const sep = txt.split("\n")[0].includes(";") ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && txt[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter(r => r.some(x => x.trim()));
  const keys = head.map(h => h.trim().toLowerCase());
  return data.map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
const slug = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 30);
const senhaNova = () => {
  const a = "abcdefghjkmnpqrstuvwxyz23456789"; let s = "";
  for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};
const CAMPOS = ["nome", "nome_fantasia", "documento", "telefone", "email_contato", "endereco", "bairro", "complemento", "cidade", "cep", "observacoes"];

const linhas = parseCSV(readFileSync(arquivo, "utf8").replace(/^﻿/, ""));
const saida = [["usuario", "senha", "nome"]];
let ok = 0, falhas = 0;

for (const l of linhas) {
  if (!l.nome) { console.warn("Linha sem nome, ignorada"); continue; }
  let usuario = (l.usuario || slug(l.nome_fantasia || l.nome)).toLowerCase();
  const { data: ja } = await sb.from("clientes").select("id").eq("usuario", usuario).maybeSingle();
  if (ja && !l.usuario) usuario = `${usuario}.${Math.floor(Math.random() * 900 + 100)}`;
  else if (ja) { console.warn(`Já existe: ${usuario}`); falhas++; continue; }
  const senha = l.senha || senhaNova();

  const { data: u, error } = await sb.auth.admin.createUser({
    email: `${usuario}@${LOGIN_DOMAIN}`, password: senha, email_confirm: true,
    user_metadata: { tipo: "cliente", usuario },
  });
  if (error) { console.warn(`Falhou ${usuario}: ${error.message}`); falhas++; continue; }
  const row = { user_id: u.user.id, usuario };
  for (const k of CAMPOS) if (l[k]) row[k] = k === "documento" ? l[k].replace(/\D/g, "") : l[k];
  const { error: e2 } = await sb.from("clientes").insert(row);
  if (e2) { await sb.auth.admin.deleteUser(u.user.id); console.warn(`Falhou ${usuario}: ${e2.message}`); falhas++; continue; }
  saida.push([usuario, senha, l.nome_fantasia || l.nome]); ok++;
  console.log(`✓ ${usuario}`);
}

const out = `credenciais-${new Date().toISOString().slice(0, 10)}.csv`;
writeFileSync(out, saida.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n"));
console.log(`\n${ok} criados, ${falhas} com problema. Logins salvos em ${out}`);
