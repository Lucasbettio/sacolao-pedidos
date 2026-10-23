import { NavLink, Outlet, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import logo from "../assets/logo.jpg";

export default function Layout() {
  const { perfil, sair } = useAuth();
  const admin = perfil.tipo === "admin";
  const [novos, setNovos] = useState(0);

  // Contador de pedidos novos no menu do admin (atualiza em tempo real)
  useEffect(() => {
    if (!admin) return;
    const contar = () => supabase.from("pedidos").select("id", { count: "exact", head: true })
      .eq("status", "recebido").then(({ count }) => setNovos(count ?? 0));
    contar();
    const ch = supabase.channel("menu-novos")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, contar).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [admin]);

  const nome = perfil.tipo === "admin" ? perfil.nome
    : perfil.tipo === "cliente" ? (perfil.cliente.nome_fantasia || perfil.cliente.nome) : "";

  return (
    <>
      <header className="top">
        <div className="wrap">
          <Link className="brand" to="/">
            <img src={logo} alt="Sacolão da Chácara" />
            <span><b>Sacolão da Chácara</b><small>{admin ? "Painel da loja" : "Pedidos com entrega"}</small></span>
          </Link>
          <nav className="nav" aria-label="Menu">
            {admin ? <>
              <NavLink to="/admin/pedidos">Pedidos{novos > 0 && <span className="badge tnum">{novos}</span>}</NavLink>
              <NavLink to="/admin/precos">Preços de hoje</NavLink>
              <NavLink to="/admin/ceasa">Lista da Ceasa</NavLink>
              <NavLink to="/admin/dashboard">Análises</NavLink>
              <NavLink to="/admin/clientes">Clientes</NavLink>
              <NavLink to="/admin/produtos">Produtos</NavLink>
              <NavLink to="/admin/visao-cliente">Visão do cliente</NavLink>
            </> : <>
              <NavLink to="/pedido" end>Fazer pedido</NavLink>
              <NavLink to="/meus-pedidos">Meus pedidos</NavLink>
            </>}
            <span className="who" style={{ marginLeft: 8 }}>
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nome}</span>
              <button className="btn ghost sm" onClick={sair}>Sair</button>
            </span>
          </nav>
        </div>
      </header>
      <main className="wrap"><Outlet /></main>
    </>
  );
}
