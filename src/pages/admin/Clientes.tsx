import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { doc, slug } from "../../lib/format";
import type { Cliente } from "../../lib/types";
import { Carregando, Modal, copiar, toast } from "../../components/ui";
import { Th, useOrdenacao } from "../../components/Ordenacao";

async function chamar(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("admin-clientes", { body });
  if (error) {
    const ctx = (error as { context?: unknown }).context;
    // Resposta HTTP da função: ela devolve { error } com a explicação
    if (ctx instanceof Response) {
      let msg = "";
      try { msg = (await ctx.clone().json())?.error ?? ""; } catch { /* não era JSON */ }
      if (!msg && ctx.status === 404) msg = "A função admin-clientes não foi encontrada no Supabase. Publique com: supabase functions deploy admin-clientes";
      if (!msg && ctx.status === 401) msg = "Sessão expirada. Saia e entre de novo.";
      throw new Error(msg || `Erro ${ctx.status} na função admin-clientes.`);
    }
    // Falha antes de chegar na função (não publicada, bloqueio de CORS ou sem internet)
    if (error.name === "FunctionsFetchError")
      throw new Error("Não foi possível chamar a função admin-clientes. Confira se ela foi publicada no Supabase (supabase functions deploy admin-clientes).");
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
const senhaNova = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; };
const sugerirUsuario = (n: string) => slug(n).replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 30);
const site = () => window.location.origin + import.meta.env.BASE_URL;
const msgAcesso = (nome: string, u: string, s: string) =>
  `Olá, ${nome}! Seu acesso para fazer pedidos no Sacolão da Chácara:\n\nSite: ${site()}\nUsuário: ${u}\nSenha: ${s}\n\nÉ só entrar, montar a lista e enviar. A gente confirma com os preços do dia.`;

type Form = Partial<Cliente> & { senha?: string };
const CAMPOS: [keyof Cliente, string, string?][] = [
  ["nome", "Razão social ou nome"], ["nome_fantasia", "Nome fantasia"], ["documento", "CNPJ ou CPF"],
  ["telefone", "WhatsApp"], ["email_contato", "E-mail"], ["endereco", "Endereço (rua e número)"],
  ["bairro", "Bairro"], ["complemento", "Complemento"], ["cep", "CEP"],
];

export default function Clientes() {
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [cred, setCred] = useState<{ nome: string; usuario: string; senha: string } | null>(null);
  const [excluindo, setExcluindo] = useState<Cliente | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("clientes").select("*").order("nome");
    if (error) toast(msgErro(error));
    setLista((data as Cliente[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const b = slug(busca.trim()); const d = busca.replace(/\D/g, "");
    return (lista ?? []).filter(c => !b || slug(`${c.nome} ${c.nome_fantasia ?? ""} ${c.usuario}`).includes(b) || (d.length >= 3 && (c.documento ?? "").includes(d)));
  }, [lista, busca]);
  const { ordenados: vis, ord, alternar } = useOrdenacao(filtrados, {
    nome: c => c.nome_fantasia || c.nome, usuario: c => c.usuario, documento: c => c.documento,
    telefone: c => c.telefone, bairro: c => c.bairro, ativo: c => (c.ativo ? 0 : 1),
  }, { chave: "nome", dir: "asc" }, "clientes");

  if (!lista) return <Carregando />;
  const novo = !form?.id;

  async function salvar(e: FormEvent) {
    e.preventDefault(); if (!form) return;
    setErro(""); setSalvando(true);
    try {
      if (novo) {
        const usuario = (form.usuario ?? "").trim().toLowerCase();
        const senha = form.senha || senhaNova();
        await chamar({ acao: "criar", ...form, usuario, senha });
        setCred({ nome: form.nome_fantasia || form.nome || "", usuario, senha });
      } else {
        const patch: Record<string, unknown> = {};
        for (const [k] of CAMPOS) patch[k] = (form[k] as string)?.toString().trim() || null;
        patch.documento = (form.documento ?? "").replace(/\D/g, "") || null;
        patch.observacoes = form.observacoes?.trim() || null;
        const { error } = await supabase.from("clientes").update(patch).eq("id", form.id!);
        if (error) throw error;
        if (form.senha) await chamar({ acao: "senha", cliente_id: form.id, senha: form.senha });
        if (form.senha) setCred({ nome: form.nome_fantasia || form.nome || "", usuario: form.usuario!, senha: form.senha });
        else toast("Cadastro atualizado");
      }
      setForm(null); carregar();
    } catch (err) { setErro(msgErro(err)); }
    finally { setSalvando(false); }
  }
  async function alternarAtivo(c: Cliente) {
    try { await chamar({ acao: "ativo", cliente_id: c.id, ativo: !c.ativo }); toast(c.ativo ? "Acesso bloqueado" : "Acesso liberado"); carregar(); }
    catch (err) { toast(msgErro(err)); }
  }

  return (
    <>
      <div className="ptitle"><h1>Clientes</h1><span className="hint tnum">{lista.filter(c => c.ativo).length} com acesso ativo</span><span className="sp" />
        <button className="btn sm" onClick={() => { setErro(""); setForm({ cidade: "Porto Alegre", senha: senhaNova() }); }}>Cadastrar cliente</button></div>
      <div className="search" style={{ marginBottom: 12, maxWidth: 420 }}>
        <input id="busca-cli" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, usuário ou CNPJ" aria-label="Buscar cliente" />
      </div>
      {!lista.length ? <div className="card empty"><h3>Nenhum cliente cadastrado</h3><p>Cadastre aqui um por um, ou importe a lista do sistema da loja com o script descrito no guia.</p></div> :
        <div className="card" style={{ padding: 0 }}><div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 720 }}>
          <thead><tr>
            <Th chave="nome" ord={ord} alternar={alternar} style={{ paddingLeft: 16 }}>Cliente</Th>
            <Th chave="usuario" ord={ord} alternar={alternar}>Usuário</Th>
            <Th chave="documento" ord={ord} alternar={alternar}>CNPJ/CPF</Th>
            <Th chave="telefone" ord={ord} alternar={alternar}>WhatsApp</Th>
            <Th chave="bairro" ord={ord} alternar={alternar}>Bairro</Th>
            <Th chave="ativo" ord={ord} alternar={alternar}>Acesso</Th><th /></tr></thead>
          <tbody>{vis.map(c => (
            <tr key={c.id} style={c.ativo ? undefined : { opacity: .6 }}>
              <td style={{ paddingLeft: 16 }}><b>{c.nome_fantasia || c.nome}</b>{c.nome_fantasia && <div className="hint">{c.nome}</div>}</td>
              <td className="tnum">{c.usuario}</td><td className="tnum">{doc(c.documento) || "—"}</td>
              <td className="tnum">{c.telefone || "—"}</td><td>{c.bairro || "—"}</td>
              <td>{c.ativo ? <span className="pill st-em_entrega">Ativo</span> : <span className="pill st-cancelado">Bloqueado</span>}</td>
              <td style={{ whiteSpace: "nowrap", textAlign: "right", paddingRight: 12 }}>
                <button className="btn ghost sm" onClick={() => { setErro(""); setForm({ ...c, senha: "" }); }}>Editar</button>{" "}
                <button className="btn ghost sm" onClick={() => alternarAtivo(c)}>{c.ativo ? "Bloquear" : "Liberar"}</button>{" "}
                <button className="btn ghost sm perigo" onClick={() => setExcluindo(c)}>Excluir</button>
              </td>
            </tr>))}</tbody>
        </table></div></div>}

      {form && <Modal titulo={novo ? "Cadastrar cliente" : "Editar cliente"} onClose={() => setForm(null)}>
        <form onSubmit={salvar} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="grid2">
            {CAMPOS.map(([k, rot]) => (
              <label className="field" key={k}><span>{rot}</span>
                <input className="inp" id={`c-${k}`} required={k === "nome"} value={(form[k] as string) ?? ""}
                  onChange={e => setForm(f => {
                    const n = { ...f!, [k]: e.target.value };
                    if (novo && (k === "nome_fantasia" || (k === "nome" && !f!.nome_fantasia)) && (!f!.usuario || f!.usuario === sugerirUsuario((k === "nome" ? f!.nome : f!.nome_fantasia) ?? ""))) n.usuario = sugerirUsuario(e.target.value);
                    return n;
                  })} /></label>))}
          </div>
          <label className="field"><span>Notas internas (o cliente não vê)</span>
            <input className="inp" id="c-obs" value={form.observacoes ?? ""} onChange={e => setForm(f => ({ ...f!, observacoes: e.target.value }))} placeholder="Ex.: entregar antes das 10h, pagamento quinzenal" /></label>
          <div className="grid2" style={{ background: "var(--bg)", borderRadius: 12, padding: 12 }}>
            <label className="field"><span>Usuário de acesso</span>
              <input className="inp" id="c-usuario" value={form.usuario ?? ""} disabled={!novo} required pattern="[a-z0-9._\-]{3,40}"
                title="3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou _" onChange={e => setForm(f => ({ ...f!, usuario: e.target.value.toLowerCase() }))} /></label>
            <label className="field"><span>{novo ? "Senha provisória" : "Nova senha (deixe vazio para manter)"}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="inp tnum" id="c-senha" value={form.senha ?? ""} minLength={novo ? 6 : undefined} required={novo}
                  onChange={e => setForm(f => ({ ...f!, senha: e.target.value }))} />
                <button type="button" className="btn ghost sm" onClick={() => setForm(f => ({ ...f!, senha: senhaNova() }))}>Gerar</button>
              </div></label>
          </div>
          {erro && <p className="erro" role="alert" style={{ margin: 0 }}>{erro}</p>}
          <div className="acoes" style={{ marginTop: 0 }}>
            <button className="btn" disabled={salvando}>{salvando ? "Salvando…" : novo ? "Cadastrar e criar acesso" : "Salvar"}</button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      </Modal>}

      {excluindo && <ExcluirCliente c={excluindo} onClose={() => setExcluindo(null)}
        onBloquear={async () => { await alternarAtivo(excluindo); setExcluindo(null); }}
        onExcluido={() => { setExcluindo(null); carregar(); }} />}

      {cred && <Modal titulo="Acesso pronto" onClose={() => setCred(null)}>
        <p className="muted" style={{ margin: 0 }}>Envie estes dados para {cred.nome}. A senha não fica visível depois que esta janela fechar.</p>
        <div className="cred">Usuário: <code>{cred.usuario}</code><br />Senha: <code>{cred.senha}</code></div>
        <div className="acoes" style={{ marginTop: 0 }}>
          <button className="btn" onClick={() => copiar(msgAcesso(cred.nome, cred.usuario, cred.senha))}>Copiar mensagem para o cliente</button>
          <button className="btn ghost" onClick={() => setCred(null)}>Fechar</button>
        </div>
      </Modal>}
    </>
  );
}

/** Confirmação para excluir cliente. Com histórico, não deixa excluir e oferece bloquear. */
function ExcluirCliente({ c, onClose, onBloquear, onExcluido }: { c: Cliente; onClose: () => void; onBloquear: () => void; onExcluido: () => void }) {
  const [hist, setHist] = useState<{ pedidos: number; pagamentos: number; notas: number } | null>(null);
  const [apagando, setApagando] = useState(false);
  const nome = c.nome_fantasia || c.nome;
  useEffect(() => {
    supabase.rpc("historico_cliente", { p_id: c.id }).then(({ data, error }) => {
      if (error) { toast(msgErro(error)); onClose(); } else setHist(data);
    });
  }, [c.id]);
  const temHistorico = !!hist && hist.pedidos + hist.pagamentos + hist.notas > 0;
  async function excluir() {
    setApagando(true);
    const { error } = await supabase.rpc("excluir_cliente", { p_id: c.id });
    if (error) { setApagando(false); toast(msgErro(error)); return; }
    toast(`${nome} excluído`); onExcluido();
  }
  const partes = hist ? [
    hist.pedidos && `${hist.pedidos} ${hist.pedidos === 1 ? "pedido" : "pedidos"}`,
    hist.pagamentos && `${hist.pagamentos} ${hist.pagamentos === 1 ? "pagamento" : "pagamentos"}`,
    hist.notas && `${hist.notas} ${hist.notas === 1 ? "nota" : "notas"}`,
  ].filter(Boolean).join(", ") : "";
  return (
    <Modal titulo="Excluir cliente" onClose={onClose}>
      {!hist ? <p className="hint" style={{ margin: 0 }}>Verificando histórico…</p> : temHistorico ? <>
        <p style={{ margin: 0 }}><b>{nome}</b> tem {partes} registrados e por isso não pode ser excluído: o histórico de vendas e o financeiro dependem desses dados.</p>
        <p className="hint" style={{ margin: 0 }}>{c.ativo ? "Para tirar o acesso, bloqueie o cliente. Ele não consegue mais entrar, e o histórico continua nas análises e no financeiro." : "O cliente já está bloqueado e não consegue entrar."}</p>
        <div className="acoes" style={{ marginTop: 0 }}>
          {c.ativo && <button className="btn red" onClick={onBloquear}>Bloquear acesso</button>}
          <button className="btn ghost" onClick={onClose}>{c.ativo ? "Cancelar" : "Fechar"}</button>
        </div>
      </> : <>
        <p style={{ margin: 0 }}>Excluir <b>{nome}</b> e o login <b>{c.usuario}</b>? Essa ação não pode ser desfeita.</p>
        <p className="hint" style={{ margin: 0 }}>Ele não tem pedidos, pagamentos nem notas.</p>
        <div className="acoes" style={{ marginTop: 0 }}>
          <button className="btn red" disabled={apagando} onClick={excluir}>{apagando ? "Excluindo…" : "Excluir cliente"}</button>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </>}
    </Modal>
  );
}
