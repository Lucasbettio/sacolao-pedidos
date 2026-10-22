import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const configurado = Boolean(url && key);

export const supabase = createClient(url || "http://localhost", key || "anon", {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string) || "clientes.sacolaodachacara.app";
export const WHATSAPP_LOJA = (import.meta.env.VITE_WHATSAPP_LOJA as string) || "";

/** "usuario" vira e-mail interno; quem digita um e-mail (admins) entra direto. */
export function loginParaEmail(login: string) {
  const l = login.trim().toLowerCase();
  return l.includes("@") ? l : `${l}@${LOGIN_DOMAIN}`;
}

/** Mensagem de erro do Supabase em português, para mostrar na tela. */
export function msgErro(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/Invalid login credentials/i.test(m)) return "Usuário ou senha incorretos.";
  if (/banned|User is banned/i.test(m)) return "Este acesso está bloqueado. Fale com a loja.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return m;
}
