import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, dataCurta, emOferta, hojeISO, num, slug } from "../../lib/format";
import { casar, escolhaClara, lerPreco } from "../../lib/lista";
import { UNIDADES, type Produto, type Unidade } from "../../lib/types";
import { Carregando, toast } from "../../components/ui";
import { porNome } from "../../components/Ordenacao";

const precoTxt = (v: number | null) => (v != null ? Number(v).toFixed(2).replace(".", ",") : "");

interface LinhaColada {
  texto: string; nome: string; preco: number;
  escolha: string;                     // id do produto, "novo" ou "ignorar"
  candidatos: Produto[]; clara: boolean;
  novaCategoria: string; novaUnidade: Unidade;
}

export default function Precos() {
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<LinhaColada[] | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [novaOferta, setNovaOferta] = useState({ nome: "", preco: "", ate: hojeISO() });

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("produtos").select("*").order("ordem").order("nome");
    if (error) toast(msgErro(error));
    setProdutos((data as Produto[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const ativos = useMemo(() => (produtos ?? []).filter(p => p.ativo), [produtos]);
  const categorias = useMemo(() => [...new Set(ativos.map(p => p.categoria))], [ativos]);
  const porId = useMemo(() => new Map((produtos ?? []).map(p => [String(p.id), p])), [produtos]);
  if (!produtos) return <Carregando />;

  // ---------- Colar tabela ----------
  function conferir() {
    const ls: LinhaColada[] = [];
    for (const bruta of texto.split(/\r?\n/)) {
      const lp = lerPreco(bruta); if (!lp) continue;
      const cands = casar(lp.nome, produtos!);
      const clara = escolhaClara(cands);
      ls.push({ texto: lp.texto, nome: lp.nome, preco: lp.preco, candidatos: cands.map(c => c.produto),
        escolha: clara ? String(clara.id) : cands[0] ? String(cands[0].produto.id) : "ignorar",
        clara: !!clara, novaCategoria: "Outros", novaUnidade: "kg" });
    }
    setLinhas(ls);
  }
  const muda = (i: number, patch: Partial<LinhaColada>) => setLinhas(ls => ls!.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const paraAtualizar = (linhas ?? []).filter(l => porId.has(l.escolha));
  const paraCriar = (linhas ?? []).filter(l => l.escolha === "novo");
  const mudam = paraAtualizar.filter(l => Number(porId.get(l.escolha)!.preco ?? -1) !== l.preco).length;
  const duvidas = (linhas ?? []).filter(l => porId.has(l.escolha) && !l.clara).length;

  async function salvarColados() {
    setSalvando(true);
    try {
      // Se o mesmo produto aparecer duas vezes, vale a última linha
      const mapa = new Map<number, number>();
      paraAtualizar.forEach(l => mapa.set(Number(l.escolha), l.preco));
      if (mapa.size) {
        const { error } = await supabase.rpc("atualizar_precos", { p_itens: [...mapa].map(([id, preco]) => ({ id, preco })) });
        if (error) throw error;
      }
      if (paraCriar.length) {
        const maxOrdem = Math.max(0, ...produtos!.map(p => p.ordem));
        const { error } = await supabase.from("produtos").insert(paraCriar.map((l, i) => ({
          nome: l.nome.trim(), categoria: l.novaCategoria.trim() || "Outros", unidade: l.novaUnidade, preco: l.preco, ordem: maxOrdem + (i + 1) * 10,
        })));
        if (error) throw new Error(/duplicate/.test(error.message) ? "Um dos produtos novos já existe com esse nome." : error.message);
      }
      toast(`${mapa.size} ${mapa.size === 1 ? "preço atualizado" : "preços atualizados"}${paraCriar.length ? ` e ${paraCriar.length} ${paraCriar.length === 1 ? "produto criado" : "produtos criados"}` : ""}`);
      setLinhas(null); setTexto(""); carregar();
    } catch (e) { toast(msgErro(e)); }
    finally { setSalvando(false); }
  }

  // ---------- Ofertas ----------
  const comOferta = (produtos ?? []).filter(p => p.preco_oferta != null).sort((a, b) => (a.oferta_ate ?? "9").localeCompare(b.oferta_ate ?? "9"));
  async function salvarOferta(p: Produto, preco: number | null, ate: string | null) {
    const { error } = await supabase.from("produtos").update({ preco_oferta: preco, oferta_ate: ate }).eq("id", p.id);
    if (error) { toast(msgErro(error)); return false; }
    toast(preco == null ? `Oferta de ${p.nome} encerrada` : `Oferta de ${p.nome} criada`); carregar(); return true;
  }
  async function criarOferta() {
    const p = ativos.find(x => x.nome === novaOferta.nome);
    const v = num(novaOferta.preco);
    if (!p) { toast("Escolha um produto da lista"); return; }
    if (isNaN(v) || v <= 0) { toast("Informe o preço da oferta"); return; }
    if (p.preco != null && v >= Number(p.preco)) { toast("O preço da oferta precisa ser menor que o preço normal"); return; }
    if (await salvarOferta(p, Math.round(v * 100) / 100, novaOferta.ate || null)) setNovaOferta({ nome: "", preco: "", ate: hojeISO() });
  }

  // ---------- Edição rápida ----------
  const alterados = Object.entries(edits).filter(([id, v]) => {
    const p = porId.get(id); if (!p) return false;
    const n = v.trim() === "" ? null : num(v);
    return n === null ? p.preco != null : !isNaN(n) && n >= 0 && Math.round(n * 100) / 100 !== Number(p.preco ?? -1);
  });
  async function salvarEdicao() {
    setSalvando(true);
    const itens = alterados.map(([id, v]) => ({ id: Number(id), preco: v.trim() === "" ? null : Math.round(num(v) * 100) / 100 }));
    const { error } = await supabase.rpc("atualizar_precos", { p_itens: itens });
    setSalvando(false);
    if (error) { toast(msgErro(error)); return; }
    toast(`${itens.length} ${itens.length === 1 ? "preço salvo" : "preços salvos"}`); setEdits({}); carregar();
  }
  const b = slug(busca.trim());
  const lista = ativos.filter(p => !b || slug(p.nome).includes(b));

  return (
    <>
      <div className="ptitle"><h1>Preços de hoje</h1><span className="hint tnum">{ativos.filter(p => p.preco == null).length} sem preço</span></div>

      <div className="card" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div><h2 style={{ fontSize: 18 }}>Colar tabela de preços</h2>
          <p className="hint" style={{ margin: "4px 0 0" }}>Cole a lista do WhatsApp, da planilha ou do Ceasa, um produto por linha com o preço no fim. Exemplo: “Tomate italiano 11,99” ou “Abacate;KG;5,89”. Você confere antes de salvar.</p></div>
        {!linhas ? <>
          <textarea className="inp" id="tabela-precos" rows={7} value={texto} onChange={e => setTexto(e.target.value)} placeholder={"Abacate 5,89\nBanana Prata Padrão 6,99\nTomate Italiano - R$ 11,99/kg"} />
          <div><button className="btn" disabled={!texto.trim()} onClick={conferir}>Conferir preços</button></div>
        </> : <>
          <p className="hint" style={{ margin: 0 }}>{mudam} {mudam === 1 ? "preço muda" : "preços mudam"}{paraCriar.length ? `, ${paraCriar.length} novos` : ""}.
            {duvidas > 0 && <b style={{ color: "var(--tomato-ink)" }}> Confira as linhas marcadas: tem mais de um produto parecido.</b>}</p>
          <div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 640 }}>
            <thead><tr><th>Linha colada</th><th>Produto</th><th className="r">Atual</th><th className="r">Novo</th><th className="r">Variação</th></tr></thead>
            <tbody>{linhas.map((l, i) => {
              const p = porId.get(l.escolha); const atual = p?.preco != null ? Number(p.preco) : null;
              const varia = atual ? ((l.preco - atual) / atual) * 100 : null;
              return (
                <tr key={i} style={{ opacity: l.escolha === "ignorar" ? .5 : 1, background: p && !l.clara ? "var(--tomato-soft)" : undefined }}>
                  <td className="hint" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>{l.texto}</td>
                  <td style={{ minWidth: 220 }}>
                    <select className="inp" style={{ padding: "6px 8px" }} value={l.escolha} aria-label="Produto" onChange={e => muda(i, { escolha: e.target.value, clara: true })}>
                      {l.candidatos.map(c => <option key={c.id} value={String(c.id)}>{c.nome}{c.ativo ? "" : " (fora do catálogo)"}</option>)}
                      <option value="novo">Criar produto novo: “{l.nome}”</option>
                      <option value="ignorar">Ignorar esta linha</option>
                    </select>
                    {l.escolha === "novo" && <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <input className="inp" style={{ padding: "6px 8px" }} list="cats-precos" value={l.novaCategoria} onChange={e => muda(i, { novaCategoria: e.target.value })} aria-label="Categoria" />
                      <select className="inp" style={{ width: 96, padding: "6px 8px" }} value={l.novaUnidade} onChange={e => muda(i, { novaUnidade: e.target.value as Unidade })} aria-label="Unidade">
                        {UNIDADES.map(u => <option key={u}>{u}</option>)}</select>
                    </div>}
                  </td>
                  <td className="r tnum">{l.escolha === "novo" ? "—" : atual != null ? brl(atual) : "—"}</td>
                  <td className="r tnum"><b>{brl(l.preco)}</b>{p ? <span className="hint">/{p.unidade}</span> : null}</td>
                  <td className="r tnum" style={{ color: varia == null || Math.abs(varia) < 0.5 ? "var(--muted)" : varia > 0 ? "var(--tomato-ink)" : "var(--green-ink)" }}>
                    {varia == null ? "—" : Math.abs(varia) < 0.5 ? "igual" : `${varia > 0 ? "+" : ""}${varia.toFixed(0)}%`}</td>
                </tr>);
            })}</tbody>
          </table></div>
          <datalist id="cats-precos">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          <div className="acoes" style={{ marginTop: 0 }}>
            <button className="btn" disabled={salvando || (!paraAtualizar.length && !paraCriar.length)} onClick={salvarColados}>{salvando ? "Salvando…" : "Salvar preços"}</button>
            <button className="btn ghost" onClick={() => setLinhas(null)}>Voltar ao texto</button>
          </div>
        </>}
      </div>

      <div className="card" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div><h2 style={{ fontSize: 18 }}>Ofertas do dia</h2>
          <p className="hint" style={{ margin: "4px 0 0" }}>A oferta aparece em destaque no topo do catálogo, com o preço normal riscado, e vale até o fim do dia escolhido. Bom para girar produto parado.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field" style={{ flex: "2 1 220px" }}><span>Produto</span>
            <input className="inp" id="oferta-produto" list="lista-ofertas" value={novaOferta.nome} onChange={e => setNovaOferta(o => ({ ...o, nome: e.target.value }))} placeholder="Comece a digitar…" /></label>
          <datalist id="lista-ofertas">{[...ativos].sort(porNome).map(p => <option key={p.id} value={p.nome}>{p.preco != null ? `${brl(p.preco)}/${p.unidade}` : ""}</option>)}</datalist>
          <label className="field" style={{ flex: "0 1 120px" }}><span>Preço oferta</span>
            <input className="inp tnum" id="oferta-preco" inputMode="decimal" placeholder="R$" value={novaOferta.preco} onChange={e => setNovaOferta(o => ({ ...o, preco: e.target.value }))} /></label>
          <label className="field" style={{ flex: "0 1 160px" }}><span>Vale até</span>
            <input className="inp" id="oferta-ate" type="date" min={hojeISO()} value={novaOferta.ate} onChange={e => setNovaOferta(o => ({ ...o, ate: e.target.value }))} /></label>
          <button className="btn" onClick={criarOferta}>Criar oferta</button>
        </div>
        {comOferta.length > 0 && <div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 520 }}>
          <thead><tr><th>Produto</th><th className="r">Normal</th><th className="r">Oferta</th><th>Vale até</th><th /></tr></thead>
          <tbody>{comOferta.map(p => (
            <tr key={p.id} style={emOferta(p) ? undefined : { opacity: .55 }}>
              <td><b>{p.nome}</b>{!emOferta(p) && <span className="hint"> · vencida</span>}</td>
              <td className="r tnum"><s className="muted">{p.preco != null ? brl(p.preco) : "—"}</s></td>
              <td className="r tnum"><b style={{ color: "var(--tomato-ink)" }}>{brl(p.preco_oferta)}</b><span className="hint">/{p.unidade}</span></td>
              <td>{p.oferta_ate ? dataCurta(p.oferta_ate) : "sem data"}</td>
              <td style={{ textAlign: "right" }}><button className="btn ghost sm" onClick={() => salvarOferta(p, null, null)}>{emOferta(p) ? "Encerrar" : "Remover"}</button></td>
            </tr>))}</tbody>
        </table></div>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "14px 16px" }}>
          <h2 style={{ fontSize: 18 }}>Edição rápida</h2><span className="sp" />
          <div className="search" style={{ flex: "1 1 220px", maxWidth: 320 }}><input id="busca-precos" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" /></div>
          <button className="btn sm" disabled={!alterados.length || salvando} onClick={salvarEdicao}>{alterados.length ? `Salvar ${alterados.length} ${alterados.length === 1 ? "preço" : "preços"}` : "Nada alterado"}</button>
        </div>
        {categorias.map(cat => {
          const ps = lista.filter(p => p.categoria === cat).sort(porNome); if (!ps.length) return null;
          return (
            <section key={cat}>
              <h3 style={{ padding: "8px 16px", fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--green-ink)", background: "var(--bg)", borderTop: "1px solid var(--line)" }}>{cat}</h3>
              <div className="rows" style={{ padding: "0 16px" }}>
                {ps.map(p => {
                  const v = edits[p.id] ?? precoTxt(p.preco); const mudou = edits[p.id] !== undefined && edits[p.id] !== precoTxt(p.preco);
                  return (
                    <label className="prod" key={p.id} style={{ cursor: "text" }}>
                      <span className="nm"><b>{p.nome}</b><span>por {p.unidade}</span></span>
                      <span className="hint">R$</span>
                      <input className="inp tnum" style={{ width: 92, textAlign: "right", padding: "6px 8px", borderColor: mudou ? "var(--green)" : undefined }} inputMode="decimal"
                        value={v} placeholder="—" aria-label={`Preço de ${p.nome}`} onChange={e => setEdits(x => ({ ...x, [p.id]: e.target.value }))} />
                    </label>);
                })}
              </div>
            </section>);
        })}
      </div>
    </>
  );
}
