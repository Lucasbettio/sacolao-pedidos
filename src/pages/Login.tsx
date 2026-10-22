import { useState, type FormEvent } from "react";
import { supabase, loginParaEmail, msgErro, WHATSAPP_LOJA } from "../lib/supabase";
import { waLink } from "../lib/format";
import logo from "../assets/logo.jpg";

export default function Login() {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(""); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: loginParaEmail(usuario), password: senha });
    setEnviando(false);
    if (error) setErro(msgErro(error));
  }

  return (
    <div className="login">
      <section className="lado">
        <img src={logo} alt="Sacolão da Chácara" />
        <div>
          <h1>A feira da semana, entregue na sua porta.</h1>
          <p style={{ opacity: .9, maxWidth: "48ch", fontSize: 16 }}>Área de pedidos para clientes cadastrados do Sacolão da Chácara.</p>
        </div>
        <ol>
          <li><b>1</b>Monte a lista com quilos, molhos, dúzias e bandejas.</li>
          <li><b>2</b>A loja separa e confere o peso de cada item.</li>
          <li><b>3</b>Acompanhe aqui até a entrega chegar.</li>
        </ol>
      </section>
      <section className="form">
        <form onSubmit={entrar}>
          <h2 style={{ fontSize: 28 }}>Entrar</h2>
          <label className="field"><span>Usuário</span>
            <input className="inp" id="usuario" value={usuario} onChange={e => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" required /></label>
          <label className="field"><span>Senha</span>
            <input className="inp" id="senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} autoComplete="current-password" required /></label>
          {erro && <p className="erro" role="alert" style={{ margin: 0 }}>{erro}</p>}
          <button className="btn block" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
          <p className="hint" style={{ margin: 0 }}>
            O acesso é criado pela loja. Ainda não tem usuário ou esqueceu a senha?{" "}
            {WHATSAPP_LOJA ? <a href={waLink(WHATSAPP_LOJA, "Olá! Gostaria de um acesso para fazer pedidos pelo site.")} target="_blank" rel="noopener">Chame no WhatsApp</a> : "Fale com a loja."}
          </p>
        </form>
      </section>
    </div>
  );
}
