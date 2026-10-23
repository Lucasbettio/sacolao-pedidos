import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, msgErro } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { brl, dataCurta, dataHora, qtd } from "../../lib/format";
import { STATUS_INFO, type Evento, type Item, type PedidoResumo } from "../../lib/types";
import { Carregando, StatusPill, Trilha, toast } from "../../components/ui";
import { salvarCarrinho, type ItemCarrinho } from "./NovoPedido";

export default function MeusPedidos() {
  const { perfil } = useAuth();
  const cliente = perfil.tipo === "cliente" ? perfil.cliente : null;
  const { id } = useParams();
  const nav = useNavigate();
  const [lista, setLista] = useState<PedidoResumo[] | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("pedidos_resumo").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) toast(msgErro(error));
    setLista((data as PedidoResumo[]) ?? []);
  }, []);
  useEffect(() => {
    carregar();
    const ch = supabase.channel("meus-pedidos")
      .on("postgres_changes", { event: "*", schema: "public", table: "pedidos" }, carregar).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [carregar]);

  if (!lista) return <Carregando />;
  const sel = lista.find(p => p.id === id) ?? null;

  return (
    <>
      <div className="ptitle"><h1>Meus pedidos</h1><span className="sp" /><Link className="btn sm" to="/pedido">Novo pedido</Link></div>
      {!lista.length ? (
        <div className="card empty"><h3>Você ainda não fez pedidos</h3><p>Monte sua lista em “Fazer pedido”. Ela chega direto para a loja.</p></div>
      ) : (
        <div className="split">
          <div className="plist">
            {lista.map(p => (
              <Link key={p.id} to={`/meus-pedidos/${p.id}`} className={`pcard ${sel?.id === p.id ? "sel" : ""}`}>
                <span className="t tnum">Pedido nº {p.numero}</span><StatusPill s={p.status} />
                <span className="meta tnum">Entrega {dataCurta(p.entrega_data)} · {p.entrega_turno} · {p.itens} itens{p.status !== "cancelado" ? ` · ${brl(p.total)}` : ""}</span>
              </Link>))}
          </div>
          <div>{sel ? <Detalhe p={sel} onRepetir={(itens) => { if (cliente) { salvarCarrinho(cliente.id, itens); nav("/pedido"); toast("Itens colocados na lista. Confira e envie."); } }} />
            : <div className="card empty"><h3>Escolha um pedido</h3><p>Veja itens, valores e o andamento da entrega.</p></div>}</div>
        </div>
      )}
    </>
  );
}

function Detalhe({ p, onRepetir }: { p: PedidoResumo; onRepetir: (i: Record<string, ItemCarrinho>) => void }) {
  const [itens, setItens] = useState<Item[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [confirmaCancel, setConfirmaCancel] = useState(false);

  useEffect(() => {
    supabase.from("pedido_itens").select("*").eq("pedido_id", p.id).order("id").then(({ data }) => setItens((data as Item[]) ?? []));
    supabase.from("pedido_eventos").select("*").eq("pedido_id", p.id).order("created_at").then(({ data }) => setEventos((data as Evento[]) ?? []));
  }, [p.id, p.updated_at]);

  const comPreco = p.status !== "cancelado";
  const estimado = p.status === "recebido" || p.status === "preparando";
  async function cancelar() {
    const { error } = await supabase.rpc("cancelar_pedido", { p_id: p.id });
    if (error) toast(msgErro(error)); else toast("Pedido cancelado");
    setConfirmaCancel(false);
  }
  const repetir = () => {
    const c: Record<string, ItemCarrinho> = {};
    itens.forEach((i, ix) => { c[i.produto_id ? String(i.produto_id) : "x" + ix] = { produto_id: i.produto_id, nome: i.nome, quantidade: Number(i.quantidade), unidade: i.unidade }; });
    onRepetir(c);
  };

  return (
    <div className="card">
      <div className="dhead"><div><span className="lbl tnum">Pedido nº {p.numero}</span><h2>{STATUS_INFO[p.status].cliente}</h2></div></div>
      <Trilha s={p.status} />
      {p.nota_admin && <p className="endbox" style={{ marginTop: 12 }}><b>Recado da loja:</b> {p.nota_admin}</p>}
      <div className="infos" style={{ marginTop: 14 }}>
        <div><span className="lbl">Entrega</span><br />{dataCurta(p.entrega_data)} · {p.entrega_turno}</div>
        <div><span className="lbl">Endereço</span><br />{p.endereco_entrega}</div>
        <div><span className="lbl">Troca por similar</span><br />{p.aceita_substituicao ? "Pode trocar" : "Não trocar"}</div>
      </div>
      <div className="tablewrap"><table className="t">
        <thead><tr><th>Produto</th><th className="r">Pedido</th>{comPreco && <><th className="r">Separado</th><th className="r">Preço</th><th className="r">Subtotal</th></>}</tr></thead>
        <tbody>{itens.map(i => {
          const q = i.quantidade_final ?? i.quantidade;
          return <tr key={i.id} style={i.em_falta ? { opacity: .55 } : undefined}>
            <td>{i.nome}{i.em_falta && <span className="hint"> · em falta</span>}</td>
            <td className="r tnum">{qtd(i.quantidade)} {i.unidade}</td>
            {comPreco && <><td className="r tnum">{i.em_falta ? "—" : `${qtd(q)} ${i.unidade}`}</td>
              <td className="r tnum">{i.preco_unitario != null && !i.em_falta ? brl(i.preco_unitario) : i.em_falta ? "—" : "a confirmar"}</td>
              <td className="r tnum">{i.preco_unitario != null && !i.em_falta ? brl(Number(q) * Number(i.preco_unitario)) : "—"}</td></>}
          </tr>;
        })}</tbody>
      </table></div>
      {comPreco ? (
        <div className="totais tnum">
          <span className="hint">Produtos</span><span style={{ textAlign: "right" }}>{brl(p.subtotal)}</span>
          {Number(p.taxa_entrega) > 0 && <><span className="hint">Entrega</span><span style={{ textAlign: "right" }}>{brl(p.taxa_entrega)}</span></>}
          {Number(p.desconto) > 0 && <><span className="hint">Desconto</span><span style={{ textAlign: "right" }}>−{brl(p.desconto)}</span></>}
          <span className="lbl">{estimado ? "Total estimado" : "Total"}</span><span className="grand">{brl(p.total)}</span>
        </div>
      ) : null}
      {comPreco && estimado && <p className="hint" style={{ textAlign: "right" }}>O valor final é ajustado com o peso separado.{p.itens_sem_preco > 0 ? ` ${p.itens_sem_preco} ${p.itens_sem_preco === 1 ? "item com preço" : "itens com preço"} a confirmar.` : ""}</p>}
      {p.observacoes && <p className="hint"><b>Suas observações:</b> {p.observacoes}</p>}
      <ul className="timeline" style={{ marginTop: 12 }}>{eventos.map(e => <li key={e.id} className="tnum">{dataHora(e.created_at)} · {STATUS_INFO[e.status].rotulo}</li>)}</ul>
      <div className="acoes">
        <button className="btn ghost sm" onClick={repetir} disabled={!itens.length}>Repetir este pedido</button>
        {p.status === "recebido" && (confirmaCancel
          ? <><span className="hint">Cancelar o pedido?</span><button className="btn red sm" onClick={cancelar}>Sim, cancelar</button><button className="btn ghost sm" onClick={() => setConfirmaCancel(false)}>Não</button></>
          : <button className="btn ghost sm" onClick={() => setConfirmaCancel(true)}>Cancelar pedido</button>)}
      </div>
    </div>
  );
}
