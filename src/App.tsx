import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { configurado } from "./lib/supabase";
import Layout from "./components/Layout";
import { Carregando, Toaster } from "./components/ui";
import Login from "./pages/Login";
import NovoPedido from "./pages/cliente/NovoPedido";
import MeusPedidos from "./pages/cliente/MeusPedidos";
import AdminPedidos from "./pages/admin/Pedidos";
import Dashboard from "./pages/admin/Dashboard";
import Clientes from "./pages/admin/Clientes";
import Produtos from "./pages/admin/Produtos";

export default function App() {
  const { perfil, sair } = useAuth();

  if (!configurado) return (
    <div className="wrap" style={{ paddingBlock: 48 }}>
      <h1>Falta configurar o Supabase</h1>
      <p className="muted">Copie <code>.env.example</code> para <code>.env</code> e preencha a URL e a chave anon do projeto.</p>
    </div>
  );
  if (perfil.tipo === "carregando") return <Carregando />;
  if (perfil.tipo === "anonimo") return <><Login /><Toaster /></>;
  if (perfil.tipo === "sem_acesso") return (
    <div className="wrap" style={{ paddingBlock: 48, maxWidth: 520 }}>
      <h1 style={{ marginBottom: 10 }}>Acesso não liberado</h1>
      <p className="muted">Este login não está ligado a um cliente ativo. Fale com a loja para liberar o acesso.</p>
      <button className="btn" onClick={sair}>Voltar ao login</button>
    </div>
  );

  const admin = perfil.tipo === "admin";
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          {admin ? <>
            <Route path="/admin/pedidos" element={<AdminPedidos />} />
            <Route path="/admin/pedidos/:id" element={<AdminPedidos />} />
            <Route path="/admin/dashboard" element={<Dashboard />} />
            <Route path="/admin/clientes" element={<Clientes />} />
            <Route path="/admin/produtos" element={<Produtos />} />
            <Route path="*" element={<Navigate to="/admin/pedidos" replace />} />
          </> : <>
            <Route path="/pedido" element={<NovoPedido />} />
            <Route path="/meus-pedidos" element={<MeusPedidos />} />
            <Route path="/meus-pedidos/:id" element={<MeusPedidos />} />
            <Route path="*" element={<Navigate to="/pedido" replace />} />
          </>}
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
