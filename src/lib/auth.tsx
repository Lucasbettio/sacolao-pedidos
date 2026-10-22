import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Cliente } from "./types";

type Perfil =
  | { tipo: "carregando" }
  | { tipo: "anonimo" }
  | { tipo: "admin"; nome: string }
  | { tipo: "cliente"; cliente: Cliente }
  | { tipo: "sem_acesso" };

const Ctx = createContext<{ perfil: Perfil; session: Session | null; sair: () => Promise<void>; recarregar: () => void }>({
  perfil: { tipo: "carregando" }, session: null, sair: async () => {}, recarregar: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil>({ tipo: "carregando" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!uid) { setPerfil({ tipo: "anonimo" }); return; }
      setPerfil({ tipo: "carregando" });
      const [{ data: adm }, { data: cli }] = await Promise.all([
        supabase.from("admins").select("nome").eq("user_id", uid).maybeSingle(),
        supabase.from("clientes").select("*").eq("user_id", uid).maybeSingle(),
      ]);
      if (!vivo) return;
      if (adm) setPerfil({ tipo: "admin", nome: adm.nome });
      else if (cli && cli.ativo) setPerfil({ tipo: "cliente", cliente: cli as Cliente });
      else setPerfil({ tipo: "sem_acesso" });
    })();
    return () => { vivo = false; };
  }, [uid, tick]);

  const sair = async () => { await supabase.auth.signOut(); };
  return <Ctx.Provider value={{ perfil, session, sair, recarregar: () => setTick(t => t + 1) }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
