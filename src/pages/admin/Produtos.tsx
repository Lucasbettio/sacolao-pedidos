import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, dataCurta, slug } from "../../lib/format";
import { UNIDADES, type Produto, type Unidade } from "../../lib/types";
import { Carregando, toast } from "../../components/ui";

export default function Produtos() {
  const [lista, setLista] = useState<Produto[] | null>(null);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState({ nome: "", categoria: "Frutas", unidade: "kg" as Unidade });

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("produtos").select("*").order("categoria").order("ordem").order("nome");
    if (error) toast(msgErro(error));
    setLista((data as Produto[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const categorias = useMemo(() => [...new Set((lista ?? []).map(p => p.categoria))], [lista]);
  if (!lista) return <Carregando />;

  const vis = lista.filter(p => !busca || slug(p.nome + " " + p.categoria).includes(slug(busca)));
  async function muda(p: Produto, patch: Partial<Produto>) {
    setLista(l => l!.map(x => (x.id === p.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("produtos").update(patch).eq("id", p.id);
    if (error) { toast(msgErro(error)); carregar(); }
  }
  async function adicionar() {
    if (!novo.nome.trim()) return;
    const ordem = Math.max(0, ...lista!.filter(p => p.categoria === novo.categoria).map(p => p.ordem)) + 10;
    const { error } = await supabase.from("produtos").insert({ ...novo, nome: novo.nome.trim(), categoria: novo.categoria.trim() || "Outros", ordem });
    if (error) { toast(/duplicate/.test(error.message) ? "Já existe um produto com esse nome." : msgErro(error)); return; }
    setNovo(n => ({ ...n, nome: "" })); toast("Produto incluído"); carregar();
  }

  return (
    <>
      <div className="ptitle"><h1>Produtos</h1><span className="hint tnum">{lista.filter(p => p.ativo).length} à venda</span></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <span className="lbl">Novo produto</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input className="inp" style={{ flex: "2 1 200px" }} id="np-nome" placeholder="Nome (ex.: Mexerica ponkan)" value={novo.nome} onChange={e => setNovo(n => ({ ...n, nome: e.target.value }))} onKeyDown={e => e.key === "Enter" && adicionar()} />
          <input className="inp" style={{ flex: "1 1 140px" }} id="np-cat" list="cats" placeholder="Categoria" value={novo.categoria} onChange={e => setNovo(n => ({ ...n, categoria: e.target.value }))} />
          <datalist id="cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          <select className="inp" style={{ flex: "0 1 120px" }} id="np-un" value={novo.unidade} onChange={e => setNovo(n => ({ ...n, unidade: e.target.value as Unidade }))}>{UNIDADES.map(u => <option key={u}>{u}</option>)}</select>
          <button className="btn" onClick={adicionar}>Incluir</button>
        </div>
      </div>
      <div className="search" style={{ marginBottom: 12, maxWidth: 420 }}>
        <input id="busca-prod" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" />
      </div>
      <div className="card" style={{ padding: 0 }}><div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 700 }}>
        <thead><tr><th style={{ paddingLeft: 16 }}>Produto</th><th>Categoria</th><th>Unidade</th><th>Também por unidade</th><th className="r">Último preço</th><th>À venda</th></tr></thead>
        <tbody>{vis.map(p => (
          <tr key={p.id} style={p.ativo ? undefined : { opacity: .55 }}>
            <td style={{ paddingLeft: 16 }}><b>{p.nome}</b></td>
            <td>{p.categoria}</td>
            <td><select className="unit" value={p.unidade} onChange={e => muda(p, { unidade: e.target.value as Unidade })} aria-label="Unidade">{UNIDADES.map(u => <option key={u}>{u}</option>)}</select></td>
            <td>{p.unidade === "kg" ? <input type="checkbox" checked={p.aceita_unidade} onChange={e => muda(p, { aceita_unidade: e.target.checked })} aria-label="Aceita pedido por unidade" /> : <span className="hint">—</span>}</td>
            <td className="r tnum">{p.ultimo_preco != null ? <>{brl(p.ultimo_preco)}<span className="hint">/{p.unidade}{p.preco_em ? ` · ${dataCurta(p.preco_em)}` : ""}</span></> : <span className="hint">—</span>}</td>
            <td><label className="check"><input type="checkbox" checked={p.ativo} onChange={e => muda(p, { ativo: e.target.checked })} /> {p.ativo ? "Sim" : "Fora"}</label></td>
          </tr>))}</tbody>
      </table></div></div>
      <p className="hint">Produto marcado como “Fora” some do catálogo dos clientes, mas continua nos pedidos antigos. O último preço é atualizado sozinho quando um pedido é aprovado e serve de sugestão no próximo.</p>
    </>
  );
}
