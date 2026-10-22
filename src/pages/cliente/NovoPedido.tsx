import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, msgErro } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { hojeISO, dataCurta, qtd, slug } from "../../lib/format";
import type { Produto, Unidade } from "../../lib/types";
import { Carregando, toast } from "../../components/ui";

export interface ItemCarrinho { produto_id: number | null; nome: string; quantidade: number; unidade: Unidade }
const chaveCarrinho = (cid: string) => `sacolao_carrinho_${cid}`;
export function salvarCarrinho(cid: string, itens: Record<string, ItemCarrinho>) {
  try { localStorage.setItem(chaveCarrinho(cid), JSON.stringify(itens)); } catch { /* sem armazenamento */ }
}
function lerCarrinho(cid: string): Record<string, ItemCarrinho> {
  try { return JSON.parse(localStorage.getItem(chaveCarrinho(cid)) || "{}"); } catch { return {}; }
}
const passo = (u: Unidade) => (u === "kg" ? 0.5 : 1);

export default function NovoPedido() {
  const { perfil } = useAuth();
  const cliente = perfil.tipo === "cliente" ? perfil.cliente : null;
  const nav = useNavigate();
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [carrinho, setCarrinho] = useState<Record<string, ItemCarrinho>>(() => (cliente ? lerCarrinho(cliente.id) : {}));
  const [cat, setCat] = useState("Todos");
  const [busca, setBusca] = useState("");
  const [extra, setExtra] = useState("");
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const enderecoCadastro = [cliente?.endereco, cliente?.complemento, cliente?.bairro].filter(Boolean).join(" · ");
  const [outroEnd, setOutroEnd] = useState(false);
  const [endereco, setEndereco] = useState("");
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => hojeISO(i)), []);
  const [dia, setDia] = useState(dias[1]);
  const [turno, setTurno] = useState("manhã");
  const [pagamento, setPagamento] = useState("Pix");
  const [subst, setSubst] = useState(true);
  const [obs, setObs] = useState("");

  useEffect(() => {
    supabase.from("produtos").select("*").eq("ativo", true).order("ordem").order("nome")
      .then(({ data, error }) => { if (error) toast(msgErro(error)); setProdutos((data as Produto[]) ?? []); });
  }, []);
  useEffect(() => { if (cliente) salvarCarrinho(cliente.id, carrinho); }, [carrinho, cliente]);

  const categorias = useMemo(() => [...new Set((produtos ?? []).map(p => p.categoria))], [produtos]);
  const filtrados = useMemo(() => {
    const b = slug(busca.trim());
    return (produtos ?? []).filter(p => (cat === "Todos" || p.categoria === cat) && (!b || slug(p.nome).includes(b)));
  }, [produtos, cat, busca]);

  if (!cliente) return null;
  if (!produtos) return <Carregando />;

  const altera = (p: Produto, delta: number, unidade?: Unidade) => setCarrinho(c => {
    const k = String(p.id); const atual = c[k]; const n = { ...c };
    if (!atual) { if (delta > 0) n[k] = { produto_id: p.id, nome: p.nome, quantidade: 1, unidade: unidade ?? p.unidade }; return n; }
    const q = Math.round((atual.quantidade + delta * passo(atual.unidade)) * 1000) / 1000;
    if (q <= 0) delete n[k]; else n[k] = { ...atual, quantidade: q };
    return n;
  });
  const trocaUnidade = (p: Produto, u: Unidade) => setCarrinho(c => {
    const atual = c[String(p.id)]; if (!atual) return c;
    return { ...c, [p.id]: { ...atual, unidade: u, quantidade: Math.max(1, Math.round(atual.quantidade)) } };
  });
  const remove = (k: string) => setCarrinho(c => { const n = { ...c }; delete n[k]; return n; });
  const addExtra = () => {
    const t = extra.trim(); if (!t) return;
    setCarrinho(c => ({ ...c, ["x" + Date.now()]: { produto_id: null, nome: t, quantidade: 1, unidade: "un" } }));
    setExtra("");
  };

  const itens = Object.entries(carrinho);
  async function enviar() {
    setErro("");
    const end = outroEnd ? endereco.trim() : enderecoCadastro;
    if (!end) { setErro("Informe o endereço de entrega."); return; }
    setEnviando(true);
    const { data, error } = await supabase.rpc("criar_pedido", {
      p_entrega_data: dia, p_entrega_turno: turno, p_endereco: end, p_pagamento: pagamento,
      p_aceita_substituicao: subst, p_observacoes: obs,
      p_itens: itens.map(([, i]) => ({ produto_id: i.produto_id, nome: i.nome, quantidade: i.quantidade, unidade: i.unidade })),
    });
    setEnviando(false);
    if (error) { setErro(msgErro(error)); return; }
    setCarrinho({}); setObs(""); setAberto(false);
    toast(`Pedido nº ${data} enviado`);
    nav("/meus-pedidos");
  }

  const sacola = (
    <aside className={`sacola ${aberto ? "open" : ""}`} aria-label="Seu pedido">
      <header><h2>Seu pedido</h2><span className="hint tnum">{itens.length ? `${itens.length} ${itens.length === 1 ? "item" : "itens"}` : ""}</span><span className="sp" />
        {aberto && <button className="x" onClick={() => setAberto(false)} aria-label="Fechar">✕</button>}</header>
      <div className="body">
        {itens.length ? <ul className="cart">{itens.map(([k, i]) => (
          <li key={k}><span className="q tnum">{qtd(i.quantidade)} {i.unidade}</span><span className="n">{i.nome}</span>
            <button className="x" onClick={() => remove(k)} aria-label={`Remover ${i.nome}`}>✕</button></li>))}</ul>
          : <p className="hint">Sua lista está vazia. Toque em “Adicionar” nos produtos.</p>}
        <div style={{ display: "flex", gap: 6 }}>
          <input className="inp" id="extra" value={extra} onChange={e => setExtra(e.target.value)} onKeyDown={e => e.key === "Enter" && addExtra()} placeholder="Item fora da lista" aria-label="Item fora da lista" />
          <button className="btn ghost sm" onClick={addExtra}>Incluir</button>
        </div>

        <div className="field"><span>Entregar em</span>
          {!outroEnd && <div className="endbox">{enderecoCadastro || <span className="muted">Sem endereço no cadastro</span>}</div>}
          <label className="check"><input type="checkbox" checked={outroEnd} onChange={e => setOutroEnd(e.target.checked)} /> Entregar em outro endereço</label>
          {outroEnd && <input className="inp" id="end" value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, bairro" />}
        </div>
        <div className="grid2">
          <label className="field"><span>Dia</span><select className="inp" id="dia" value={dia} onChange={e => setDia(e.target.value)}>
            {dias.map((d, i) => <option key={d} value={d}>{i === 0 ? "Hoje" : i === 1 ? "Amanhã" : dataCurta(d)}</option>)}</select></label>
          <label className="field"><span>Turno</span><select className="inp" id="turno" value={turno} onChange={e => setTurno(e.target.value)}>
            <option>manhã</option><option>tarde</option></select></label>
        </div>
        <label className="field"><span>Pagamento</span><select className="inp" id="pag" value={pagamento} onChange={e => setPagamento(e.target.value)}>
          {["Pix", "Boleto", "Cartão na entrega", "Dinheiro", "Faturado"].map(p => <option key={p}>{p}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={subst} onChange={e => setSubst(e.target.checked)} /> Se faltar algum produto, pode trocar por similar</label>
        <label className="field"><span>Observações</span><textarea className="inp" id="obs" value={obs} onChange={e => setObs(e.target.value)} placeholder="Ex.: bananas mais verdes, tomate para molho" /></label>
      </div>
      <footer>
        {erro && <p className="erro" role="alert" style={{ margin: 0 }}>{erro}</p>}
        <button className="btn block" disabled={!itens.length || enviando} onClick={enviar}>{enviando ? "Enviando…" : "Enviar pedido"}</button>
        <p className="hint" style={{ margin: 0 }}>O preço vem na aprovação, com os valores do dia e o peso conferido.</p>
      </footer>
    </aside>
  );

  return (
    <>
      <div className="ptitle"><h1>Fazer pedido</h1></div>
      <div className="shop">
        <div>
          <div className="toolbar">
            <div className="search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ color: "var(--muted)" }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input id="busca" type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar: tomate, alface, banana…" aria-label="Buscar produto" />
            </div>
            <div className="chips" role="group" aria-label="Categorias">
              {["Todos", ...categorias].map(c => <button key={c} className="chip" aria-pressed={c === cat} onClick={() => setCat(c)}>{c}</button>)}
            </div>
          </div>
          {categorias.filter(c => cat === "Todos" || c === cat).map(c => {
            const ps = filtrados.filter(p => p.categoria === c);
            if (!ps.length) return null;
            return (
              <section className="banca" key={c}><h2>{c}</h2><div className="rows">
                {ps.map(p => {
                  const it = carrinho[String(p.id)];
                  const unidades: Unidade[] = p.aceita_unidade ? [p.unidade, "un"] : [p.unidade];
                  return (
                    <div className={`prod ${it ? "on" : ""}`} key={p.id}>
                      <div className="nm"><b>{p.nome}</b><span>por {p.aceita_unidade ? `${p.unidade} ou unidade` : p.unidade}</span></div>
                      {it && unidades.length > 1 && <select className="unit" value={it.unidade} onChange={e => trocaUnidade(p, e.target.value as Unidade)} aria-label="Unidade">
                        {unidades.map(u => <option key={u}>{u}</option>)}</select>}
                      {it ? <span className="step"><button onClick={() => altera(p, -1)} aria-label="Diminuir">−</button>
                        <output className="tnum">{qtd(it.quantidade)} {it.unidade}</output>
                        <button onClick={() => altera(p, 1)} aria-label="Aumentar">+</button></span>
                        : <button className="add" onClick={() => altera(p, 1)}>Adicionar</button>}
                    </div>);
                })}
              </div></section>);
          })}
          {!filtrados.length && <p className="empty">Nenhum produto com esse nome. Peça assim mesmo em “Item fora da lista”.</p>}
        </div>
        {sacola}
      </div>
      {aberto && <div className="scrim" onClick={() => setAberto(false)} />}
      <div className="mbar"><span className="tnum hint">{itens.length ? `${itens.length} ${itens.length === 1 ? "item" : "itens"}` : "Lista vazia"}</span>
        <button className="btn" onClick={() => setAberto(true)}>Ver pedido</button></div>
    </>
  );
}
