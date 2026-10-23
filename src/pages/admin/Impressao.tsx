import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, dataCurta, dataHora, doc, qtd } from "../../lib/format";
import { itensDosPedidos, lerImpressao } from "../../lib/exportar";
import { STATUS_INFO, type Item, type PedidoResumo } from "../../lib/types";
import { Carregando } from "../../components/ui";
import logo from "../../assets/logo.jpg";

interface Folha { p: PedidoResumo; itens: Item[]; documento: string | null }

export default function Impressao() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [folhas, setFolhas] = useState<Folha[] | null>(null);
  const [erro, setErro] = useState("");
  const [comPreco, setComPreco] = useState(params.get("modo") !== "separacao");

  useEffect(() => {
    const ids = params.get("ids")?.split(",").filter(Boolean) ?? lerImpressao();
    if (!ids.length) { setFolhas([]); return; }
    (async () => {
      try {
        const lista: PedidoResumo[] = [];
        for (let i = 0; i < ids.length; i += 80) {
          const { data, error } = await supabase.from("pedidos_resumo").select("*").in("id", ids.slice(i, i + 80));
          if (error) throw error;
          lista.push(...((data as PedidoResumo[]) ?? []));
        }
        lista.sort((a, b) => a.entrega_data.localeCompare(b.entrega_data) || a.entrega_turno.localeCompare(b.entrega_turno) || a.numero - b.numero);
        const itens = await itensDosPedidos(lista.map(p => p.id));
        const { data: clis } = await supabase.from("clientes").select("id, documento").in("id", [...new Set(lista.map(p => p.cliente_id))]);
        const docs = new Map((clis ?? []).map(c => [c.id as string, c.documento as string | null]));
        setFolhas(lista.map(p => ({ p, itens: itens.filter(i => i.pedido_id === p.id), documento: docs.get(p.cliente_id) ?? null })));
      } catch (e) { setErro(msgErro(e)); }
    })();
  }, [params]);

  if (erro) return <p className="erro">{erro}</p>;
  if (!folhas) return <Carregando />;

  return (
    <>
      <div className="ptitle no-print">
        <button className="btn ghost sm" onClick={() => nav(-1)}>← Voltar</button>
        <h1>Imprimir {folhas.length === 1 ? "pedido" : `${folhas.length} pedidos`}</h1><span className="sp" />
        <div className="chips">
          <button className="chip" aria-pressed={comPreco} onClick={() => setComPreco(true)}>Pedido com preços</button>
          <button className="chip" aria-pressed={!comPreco} onClick={() => setComPreco(false)}>Lista de separação</button>
        </div>
        <button className="btn" disabled={!folhas.length} onClick={() => window.print()}>Imprimir</button>
      </div>
      <p className="hint no-print" style={{ marginTop: -6 }}>
        {comPreco ? "Folha para entregar junto com o pedido: itens, peso separado, valores e campo de assinatura." : "Folha para quem separa: quantidades pedidas, espaço para anotar o peso real e marcar o que faltou. Sem valores."}
        {" "}Cada pedido sai numa página.
      </p>
      {!folhas.length && <div className="card empty no-print"><h3>Nenhum pedido selecionado</h3><p>Volte para Pedidos e escolha o que imprimir.</p></div>}
      <div className="folhas">
        {folhas.map(({ p, itens, documento }) => {
          const subtotal = itens.reduce((s, i) => (i.em_falta || i.preco_unitario == null ? s : s + Number(i.quantidade_final ?? i.quantidade) * Number(i.preco_unitario)), 0);
          return (
            <article className="folha" key={p.id}>
              <header className="folha-topo">
                <img src={logo} alt="" />
                <div><b className="folha-loja">Sacolão da Chácara</b><span>Famiglia Bettio · hortifrúti com entrega</span></div>
                <div className="folha-num"><span>{comPreco ? "Pedido" : "Separação"}</span><b className="tnum">nº {p.numero}</b></div>
              </header>
              <section className="folha-dados">
                <div><span>Cliente</span><b>{p.cliente_fantasia || p.cliente_nome}</b>{p.cliente_fantasia && <small>{p.cliente_nome}</small>}{documento && <small className="tnum">{doc(documento)}</small>}</div>
                <div><span>Entrega</span><b>{dataCurta(p.entrega_data)} · {p.entrega_turno}</b><small>{p.endereco_entrega}</small></div>
                <div><span>Contato / pagamento</span><b className="tnum">{p.cliente_telefone || "—"}</b><small>{p.pagamento} · {p.aceita_substituicao ? "aceita similar" : "não trocar"}</small></div>
              </section>
              <table className="folha-itens">
                <thead>{comPreco
                  ? <tr><th>Produto</th><th className="r">Pedido</th><th className="r">Separado</th><th className="r">Preço</th><th className="r">Subtotal</th></tr>
                  : <tr><th className="ok">✓</th><th>Produto</th><th className="r">Pedido</th><th className="r">Peso / qtd real</th><th>Obs.</th></tr>}</thead>
                <tbody>{itens.map(i => {
                  const q = Number(i.quantidade_final ?? i.quantidade);
                  return comPreco ? (
                    <tr key={i.id} className={i.em_falta ? "falta" : ""}>
                      <td>{i.nome}{i.em_falta && <em> · em falta</em>}</td>
                      <td className="r tnum">{qtd(i.quantidade)} {i.unidade}</td>
                      <td className="r tnum">{i.em_falta ? "—" : `${qtd(q)} ${i.unidade}`}</td>
                      <td className="r tnum">{i.preco_unitario != null && !i.em_falta ? brl(i.preco_unitario) : "—"}</td>
                      <td className="r tnum">{i.preco_unitario != null && !i.em_falta ? brl(q * Number(i.preco_unitario)) : "—"}</td>
                    </tr>
                  ) : (
                    <tr key={i.id}>
                      <td className="ok"><span className="caixa" /></td>
                      <td>{i.nome}</td>
                      <td className="r tnum"><b>{qtd(i.quantidade)} {i.unidade}</b></td>
                      <td className="r tnum linha-escrever">{i.quantidade_final != null ? `${qtd(i.quantidade_final)} ${i.unidade}` : ""}</td>
                      <td className="linha-escrever" />
                    </tr>);
                })}</tbody>
              </table>
              {comPreco && (
                <section className="folha-totais tnum">
                  <span>Produtos</span><span>{brl(subtotal)}</span>
                  {Number(p.taxa_entrega) > 0 && <><span>Entrega</span><span>{brl(p.taxa_entrega)}</span></>}
                  {Number(p.desconto) > 0 && <><span>Desconto</span><span>−{brl(p.desconto)}</span></>}
                  <b>Total</b><b>{brl(p.total)}</b>
                </section>)}
              {(p.observacoes || p.nota_admin) && (
                <section className="folha-obs">
                  {p.observacoes && <p><b>Observações do cliente:</b> {p.observacoes}</p>}
                  {p.nota_admin && <p><b>Recado da loja:</b> {p.nota_admin}</p>}
                </section>)}
              <footer className="folha-rodape">
                {comPreco
                  ? <><div className="assina">Recebido por</div><div className="assina">Data e hora</div></>
                  : <><div className="assina">Separado por</div><div className="assina">Conferido por</div></>}
                <small className="tnum">{itens.length} itens · feito em {dataHora(p.created_at)} · {STATUS_INFO[p.status].rotulo}</small>
              </footer>
            </article>);
        })}
      </div>
    </>
  );
}
