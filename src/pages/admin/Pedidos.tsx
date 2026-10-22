import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, dataCurta, dataHora, hojeISO, num, qtd, slug, waLink } from "../../lib/format";
import { ACAO_PROXIMO, FLUXO, STATUS_INFO, STATUS_USADOS, UNIDADES, type Evento, type Item, type PedidoResumo, type Produto, type Status, type Unidade } from "../../lib/types";
import { Carregando, StatusPill, toast, copiar } from "../../components/ui";

const FILTROS: [string, string, (p: PedidoResumo) => boolean][] = [
  ["novos", "Novos", p => p.status === "recebido"],
  ["preparo", "Em preparo", p => p.status === "preparando" || p.status === "aprovado"],
  ["entrega", "Em entrega", p => p.status === "em_entrega"],
  ["hoje", "Entregas de hoje", p => p.entrega_data === hojeISO() && p.status !== "cancelado"],
  ["fechados", "Entregues e cancelados", p => ["entregue", "cancelado"].includes(p.status)],
  ["todos", "Todos", () => true],
];

export default function AdminPedidos() {
  const { id } = useParams();
  const [lista, setLista] = useState<PedidoResumo[] | null>(null);
  const [filtro, setFiltro] = useState("novos");
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("pedidos_resumo").select("*")
      .order("created_at", { ascending: false }).limit(400);
    if (error) toast(msgErro(error));
    setLista((data as PedidoResumo[]) ?? []);
  }, []);
  useEffect(() => {
    carregar();
    const ch = supabase.channel("admin-pedidos")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pedidos" }, () => { toast("Novo pedido recebido"); carregar(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pedidos" }, carregar)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "pedidos" }, carregar)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [carregar]);

  const visiveis = useMemo(() => {
    if (!lista) return [];
    const f = FILTROS.find(x => x[0] === filtro)![2];
    const b = slug(busca.trim());
    return lista.filter(p => f(p) && (!b || slug(`${p.cliente_nome} ${p.cliente_fantasia ?? ""} ${p.numero}`).includes(b)))
      .sort((a, b) => ["preparo", "entrega", "hoje"].includes(filtro)
        ? a.entrega_data.localeCompare(b.entrega_data) || a.entrega_turno.localeCompare(b.entrega_turno) : 0);
  }, [lista, filtro, busca]);

  if (!lista) return <Carregando />;
  const conta = (k: string) => lista.filter(FILTROS.find(x => x[0] === k)![2]).length;
  const sel = lista.find(p => p.id === id) ?? null;

  return (
    <>
      <div className="ptitle"><h1>Pedidos</h1></div>
      <div className="split">
        <div>
          <div className="search" style={{ marginBottom: 10 }}>
            <input id="busca-pedido" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente ou nº do pedido" aria-label="Buscar pedido" />
          </div>
          <div className="chips" style={{ flexWrap: "wrap", marginBottom: 10 }}>
            {FILTROS.map(([k, l]) => <button key={k} className="chip" aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
              {l}{k !== "todos" && k !== "fechados" ? ` · ${conta(k)}` : ""}</button>)}
          </div>
          <div className="plist">
            {visiveis.map(p => (
              <Link key={p.id} to={`/admin/pedidos/${p.id}`} className={`pcard ${sel?.id === p.id ? "sel" : ""}`}>
                <span className="t">{p.cliente_fantasia || p.cliente_nome}</span><StatusPill s={p.status} />
                <span className="meta tnum">nº {p.numero} · {dataHora(p.created_at)} · entrega {dataCurta(p.entrega_data)} {p.entrega_turno} · {p.itens} itens · {brl(p.total)}</span>
              </Link>))}
            {!visiveis.length && <div className="card empty"><h3>{filtro === "novos" ? "Nenhum pedido novo" : "Nenhum pedido aqui"}</h3>
              <p>{filtro === "novos" ? "Quando um cliente enviar um pedido, ele aparece aqui na hora." : "Troque o filtro para ver outros pedidos."}</p></div>}
          </div>
        </div>
        <div>{sel ? <Editor key={sel.id} p={sel} /> : <div className="card empty"><h3>Selecione um pedido</h3><p>Abra um pedido para conferir os itens, ajustar o peso separado e avançar a situação.</p></div>}</div>
      </div>
    </>
  );
}

type Linha = Omit<Item, "id" | "pedido_id"> & { id?: number; k: string; precoTxt: string; sepTxt: string };
const precoTxt = (v: number | null) => (v != null ? Number(v).toFixed(2).replace(".", ",") : "");
const paraLinha = (i: Item, preco = i.preco_unitario): Linha =>
  ({ ...i, preco_unitario: preco, k: String(i.id), precoTxt: precoTxt(preco), sepTxt: i.quantidade_final != null ? qtd(i.quantidade_final) : "" });

function Editor({ p }: { p: PedidoResumo }) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [removidos, setRemovidos] = useState<number[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [taxa, setTaxa] = useState(String(p.taxa_entrega || ""));
  const [desc, setDesc] = useState(String(p.desconto || ""));
  const [nota, setNota] = useState(p.nota_admin ?? "");
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  useEffect(() => {
    (async () => {
      const [{ data: its }, { data: prods }, { data: evs }] = await Promise.all([
        supabase.from("pedido_itens").select("*").eq("pedido_id", p.id).order("id"),
        supabase.from("produtos").select("*").order("nome"),
        supabase.from("pedido_eventos").select("*").eq("pedido_id", p.id).order("created_at"),
      ]);
      const ps = (prods as Produto[]) ?? [];
      setProdutos(ps); setEventos((evs as Evento[]) ?? []);
      setLinhas(((its as Item[]) ?? []).map(i => paraLinha(i)));
    })();
  }, [p.id]);

  if (!linhas) return <div className="card"><Carregando /></div>;

  const edita = (ix: number, patch: Partial<Linha>) => { setLinhas(ls => ls!.map((l, i) => (i === ix ? { ...l, ...patch } : l))); setSujo(true); };
  const subtotal = linhas.reduce((s, l) => (l.em_falta || l.preco_unitario == null ? s : s + Number(l.quantidade_final ?? l.quantidade) * Number(l.preco_unitario)), 0);
  const total = Math.max(0, subtotal + (num(taxa) || 0) - (num(desc) || 0));
  const semPreco = linhas.filter(l => !l.em_falta && l.preco_unitario == null).length;

  async function salvar(novoStatus?: Status) {
    if (!linhas) return false;
    setSalvando(true);
    try {
      for (const id of removidos) { const { error } = await supabase.from("pedido_itens").delete().eq("id", id); if (error) throw error; }
      const campos = (l: Linha) => ({ produto_id: l.produto_id, nome: l.nome.trim() || "Item", quantidade: Number(l.quantidade) > 0 ? l.quantidade : 1,
        unidade: l.unidade, quantidade_final: l.quantidade_final, preco_unitario: l.preco_unitario, em_falta: l.em_falta });
      const novos = linhas.filter(l => !l.id).map(l => ({ ...campos(l), pedido_id: p.id }));
      if (novos.length) { const { error } = await supabase.from("pedido_itens").insert(novos); if (error) throw error; }
      await Promise.all(linhas.filter(l => l.id).map(async l => {
        const { error } = await supabase.from("pedido_itens").update(campos(l)).eq("id", l.id!); if (error) throw error;
      }));
      const patch: Record<string, unknown> = { taxa_entrega: num(taxa) || 0, desconto: num(desc) || 0, nota_admin: nota.trim() || null };
      if (novoStatus) patch.status = novoStatus;
      const { error } = await supabase.from("pedidos").update(patch).eq("id", p.id);
      if (error) throw error;
      const { data: its } = await supabase.from("pedido_itens").select("*").eq("pedido_id", p.id).order("id");
      setLinhas(((its as Item[]) ?? []).map(i => paraLinha(i))); setRemovidos([]); setSujo(false);
      toast(novoStatus ? `Pedido ${STATUS_INFO[novoStatus].rotulo.toLowerCase()}` : "Alterações salvas");
      return true;
    } catch (e) { toast(msgErro(e)); return false; }
    finally { setSalvando(false); }
  }

  const resumoWhats = () => {
    const L = [`*Sacolão da Chácara · Pedido nº ${p.numero}*`, STATUS_INFO[p.status].cliente, ""];
    linhas.forEach(l => L.push(l.em_falta ? `- ${l.nome}: em falta`
      : `- ${qtd(l.quantidade_final ?? l.quantidade)} ${l.unidade} ${l.nome}${l.preco_unitario != null ? ` × ${brl(l.preco_unitario)}` : ""}`));
    L.push("", `*Total: ${brl(total)}*`, `Entrega: ${dataCurta(p.entrega_data)} · ${p.entrega_turno}`);
    return L.join("\n");
  };
  // Pedidos antigos "aprovado" seguem para entrega
  const atual = p.status === "aprovado" ? "preparando" : p.status;
  const proximo = FLUXO.includes(atual) ? (FLUXO[FLUXO.indexOf(atual) + 1] as Status | undefined) : undefined;

  return (
    <div className="card">
      <div className="dhead">
        <div><span className="lbl tnum">Pedido nº {p.numero} · feito {dataHora(p.created_at)}</span><h2>{p.cliente_fantasia || p.cliente_nome}</h2></div>
        <span className="sp" /><StatusPill s={p.status} />
      </div>
      <div className="infos">
        <div><span className="lbl">Entrega</span><br />{dataCurta(p.entrega_data)} · {p.entrega_turno}</div>
        <div><span className="lbl">Endereço</span><br />{p.endereco_entrega}</div>
        <div><span className="lbl">Pagamento</span><br />{p.pagamento}</div>
        <div><span className="lbl">Contato</span><br /><span className="tnum" style={{ userSelect: "all" }}>{p.cliente_telefone || "—"}</span></div>
        <div><span className="lbl">Substituição</span><br />{p.aceita_substituicao ? "Pode trocar por similar" : "Não trocar"}</div>
        {p.observacoes && <div><span className="lbl">Observações do cliente</span><br />{p.observacoes}</div>}
      </div>

      <div className="tablewrap"><table className="t edit">
        <thead><tr><th>Produto</th><th className="r">Pedido</th><th style={{ width: 96 }}>Unid.</th><th style={{ width: 96 }} className="r">Separado</th><th style={{ width: 110 }} className="r">Preço/unid.</th><th className="r">Subtotal</th><th>Falta</th><th /></tr></thead>
        <tbody>{linhas.map((l, ix) => {
          const q = Number(l.quantidade_final ?? l.quantidade);
          return (
            <tr key={l.k} className={`${l.em_falta ? "falta" : ""} ${!l.em_falta && l.preco_unitario == null ? "semp" : ""}`}>
              <td><input list="lista-produtos" value={l.nome} aria-label="Produto" onChange={e => {
                const pr = produtos.find(x => x.nome === e.target.value);
                if (pr) { const preco = l.preco_unitario ?? pr.preco; edita(ix, { nome: pr.nome, produto_id: pr.id, unidade: pr.unidade, preco_unitario: preco, precoTxt: precoTxt(preco) }); }
                else edita(ix, { nome: e.target.value, produto_id: null });
              }} /></td>
              <td className="r tnum" style={{ whiteSpace: "nowrap" }}>{l.id ? qtd(l.quantidade) : <input className="tnum" style={{ textAlign: "right", width: 70 }} defaultValue={qtd(l.quantidade)} onChange={e => edita(ix, { quantidade: num(e.target.value) || 1 })} aria-label="Quantidade pedida" />}</td>
              <td><select value={l.unidade} onChange={e => edita(ix, { unidade: e.target.value as Unidade })} aria-label="Unidade">{UNIDADES.map(u => <option key={u}>{u}</option>)}</select></td>
              <td><input className="tnum" style={{ textAlign: "right" }} placeholder={qtd(l.quantidade)} value={l.sepTxt}
                onChange={e => { const v = num(e.target.value); edita(ix, { sepTxt: e.target.value, quantidade_final: isNaN(v) ? null : v }); }} aria-label="Quantidade separada" inputMode="decimal" /></td>
              <td className="pr"><input className="tnum" style={{ textAlign: "right" }} placeholder="R$" value={l.precoTxt}
                onChange={e => { const v = num(e.target.value); edita(ix, { precoTxt: e.target.value, preco_unitario: isNaN(v) ? null : Math.round(v * 100) / 100 }); }} aria-label="Preço por unidade" inputMode="decimal" /></td>
              <td className="r tnum">{l.em_falta || l.preco_unitario == null ? "—" : brl(q * Number(l.preco_unitario))}</td>
              <td style={{ textAlign: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={l.em_falta} onChange={e => edita(ix, { em_falta: e.target.checked })} aria-label="Em falta" /></td>
              <td><button className="x" aria-label="Remover item" onClick={() => { if (l.id) setRemovidos(r => [...r, l.id!]); setLinhas(ls => ls!.filter((_, i) => i !== ix)); setSujo(true); }}>✕</button></td>
            </tr>);
        })}</tbody>
      </table>
      <datalist id="lista-produtos">{produtos.map(pr => <option key={pr.id} value={pr.nome} />)}</datalist></div>
      <button className="btn ghost sm" onClick={() => { setLinhas(ls => [...ls!, { k: "n" + Date.now(), produto_id: null, nome: "", quantidade: 1, unidade: "kg", quantidade_final: null, preco_unitario: null, em_falta: false, precoTxt: "", sepTxt: "" }]); setSujo(true); }}>+ Adicionar item</button>

      <div className="totais tnum" style={{ marginTop: 10 }}>
        <span className="hint">Produtos</span><span style={{ textAlign: "right" }}>{brl(subtotal)}</span>
        <label className="hint" htmlFor="taxa">Taxa de entrega</label><input className="inp" id="taxa" value={taxa} onChange={e => { setTaxa(e.target.value); setSujo(true); }} placeholder="0,00" inputMode="decimal" />
        <label className="hint" htmlFor="desc">Desconto</label><input className="inp" id="desc" value={desc} onChange={e => { setDesc(e.target.value); setSujo(true); }} placeholder="0,00" inputMode="decimal" />
        <span className="lbl">Total</span><span className="grand">{brl(total)}</span>
      </div>
      {semPreco > 0 && <p className="hint" style={{ textAlign: "right", margin: "4px 0 0" }}>{semPreco} {semPreco === 1 ? "item sem preço (fora do catálogo ou pedido por unidade)" : "itens sem preço (fora do catálogo ou pedidos por unidade)"}</p>}
      {p.status === "preparando" && <p className="hint" style={{ margin: "8px 0 0" }}>Em preparo: preencha a coluna <b>Separado</b> com o peso real e marque <b>Falta</b> no que não tiver. O cliente vê o valor atualizado.</p>}

      <label className="field" style={{ marginTop: 14 }}><span>Recado para o cliente (aparece no pedido dele)</span>
        <input className="inp" id="nota" value={nota} onChange={e => { setNota(e.target.value); setSujo(true); }} placeholder="Ex.: trocamos a rúcula por agrião" /></label>

      <div className="acoes">
        {proximo && <button className="btn" disabled={salvando} onClick={() => salvar(proximo)}>{ACAO_PROXIMO[p.status] ?? `Marcar como ${STATUS_INFO[proximo].rotulo.toLowerCase()}`}</button>}
        <button className="btn ghost" disabled={!sujo || salvando} onClick={() => salvar()}>{salvando ? "Salvando…" : sujo ? "Salvar alterações" : "Salvo"}</button>
        <span className="sp" />
        {p.cliente_telefone && <a className="btn ghost sm" href={waLink(p.cliente_telefone, resumoWhats())} target="_blank" rel="noopener">WhatsApp do cliente</a>}
        <button className="btn ghost sm" onClick={() => copiar(resumoWhats())}>Copiar resumo</button>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary className="hint" style={{ cursor: "pointer" }}>Mudar situação manualmente e histórico</summary>
        <div className="status-bar" style={{ margin: "10px 0" }}>
          {STATUS_USADOS.map(s => <button key={s} className="chip" aria-pressed={p.status === s} disabled={salvando || p.status === s} onClick={() => salvar(s)}>{STATUS_INFO[s].rotulo}</button>)}
        </div>
        <ul className="timeline">{eventos.map(e => <li key={e.id} className="tnum">{dataHora(e.created_at)} · {STATUS_INFO[e.status].rotulo}</li>)}</ul>
      </details>
    </div>
  );
}
