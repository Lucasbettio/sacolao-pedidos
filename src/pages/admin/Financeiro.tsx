import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, dataCurta, hojeISO, num, slug } from "../../lib/format";
import { STATUS_INFO, type Status } from "../../lib/types";
import { Carregando, Modal, toast } from "../../components/ui";

interface LinhaCliente {
  cliente_id: string; nome: string; faturado: number; pedidos: number; pago: number; saldo: number;
  em_andamento: number; sem_nota: number; valor_sem_nota: number; ultimo_pagamento: string | null; ultima_entrega: string | null;
}
interface Resumo { clientes: LinhaCliente[]; periodo: { faturado: number; recebido: number; notas: number } }
interface PedidoExtrato { id: string; numero: number; data: string; status: Status; total: number; nota_id: number | null; nota_numero: string | null }
interface Pagamento { id: number; valor: number; pago_em: string; forma: string | null; observacao: string | null }
interface Nota { id: number; numero: string; emitida_em: string; valor: number; observacao: string | null }
interface Extrato { pedidos: PedidoExtrato[]; pagamentos: Pagamento[]; notas: Nota[] }

const mesISO = (deslocamento = 0) => {
  const [a, m] = hojeISO().split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + deslocamento, 1));
  const ini = d.toISOString().slice(0, 10);
  const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return [ini, fim > hojeISO() ? hojeISO() : fim] as const;
};
const PERIODOS: [string, string, () => readonly [string, string]][] = [
  ["mes", "Este mês", () => mesISO(0)],
  ["anterior", "Mês passado", () => mesISO(-1)],
  ["30", "Últimos 30 dias", () => [hojeISO(-29), hojeISO()] as const],
  ["ano", "Este ano", () => [hojeISO().slice(0, 4) + "-01-01", hojeISO()] as const],
];
const FORMAS = ["Pix", "Boleto", "Transferência", "Dinheiro", "Cartão", "Outro"];

export default function Financeiro() {
  const [per, setPer] = useState("mes");
  const [dados, setDados] = useState<Resumo | null>(null);
  const [busca, setBusca] = useState("");
  const [soAberto, setSoAberto] = useState(true);
  const [aberto, setAberto] = useState<LinhaCliente | null>(null);

  const carregar = useCallback(async () => {
    const [de, ate] = PERIODOS.find(p => p[0] === per)![2]();
    const { data, error } = await supabase.rpc("financeiro_resumo", { p_de: de, p_ate: ate });
    if (error) toast(msgErro(error)); else setDados(data as Resumo);
  }, [per]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const b = slug(busca.trim());
    return (dados?.clientes ?? []).filter(c => (!b || slug(c.nome).includes(b)) && (!soAberto || Math.abs(c.saldo) >= 0.01 || c.sem_nota > 0 || c.em_andamento > 0));
  }, [dados, busca, soAberto]);
  if (!dados) return <Carregando />;

  const emAberto = dados.clientes.reduce((s, c) => s + Math.max(0, Number(c.saldo)), 0);
  const credito = dados.clientes.reduce((s, c) => s + Math.max(0, -Number(c.saldo)), 0);
  const semNota = dados.clientes.reduce((s, c) => s + Number(c.sem_nota), 0);
  const valorSemNota = dados.clientes.reduce((s, c) => s + Number(c.valor_sem_nota), 0);

  return (
    <>
      <div className="ptitle"><h1>Financeiro</h1><span className="sp" />
        <div className="chips">{PERIODOS.map(([k, l]) => <button key={k} className="chip" aria-pressed={per === k} onClick={() => setPer(k)}>{l}</button>)}</div></div>
      <div className="kpis">
        <div className="kpi"><small>Total em aberto</small><b className="tnum" style={{ color: emAberto > 0 ? "var(--tomato-ink)" : undefined }}>{brl(emAberto)}</b><small>entregue e ainda não pago{credito > 0 ? ` · ${brl(credito)} de crédito` : ""}</small></div>
        <div className="kpi"><small>Faturado no período</small><b className="tnum">{brl(dados.periodo.faturado)}</b><small>pedidos entregues</small></div>
        <div className="kpi"><small>Recebido no período</small><b className="tnum">{brl(dados.periodo.recebido)}</b><small>pagamentos lançados</small></div>
        <div className="kpi"><small>Pedidos sem nota</small><b className="tnum">{semNota}</b><small>{brl(valorSemNota)} · notas no período {brl(dados.periodo.notas)}</small></div>
      </div>
      <p className="hint">Funciona como conta corrente: cada pedido <b>entregue</b> entra como valor a receber e cada pagamento lançado abate do saldo, mesmo que não corresponda a um pedido específico (ex.: pagou R$ 10.000 de uma vez). Pedidos ainda em preparo ou em entrega aparecem em “Em andamento” e não entram no saldo.</p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "14px 0 10px" }}>
        <div className="search" style={{ flex: "1 1 240px", maxWidth: 360 }}><input id="busca-fin" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" /></div>
        <label className="check"><input type="checkbox" checked={soAberto} onChange={e => setSoAberto(e.target.checked)} /> Só com pendência</label>
      </div>
      {!lista.length ? <div className="card empty"><h3>{dados.clientes.length ? "Nenhuma pendência" : "Ainda não há movimento"}</h3><p>{dados.clientes.length ? "Todos os clientes estão em dia e com nota. Desmarque “Só com pendência” para ver todos." : "Os clientes aparecem aqui quando tiverem pedidos entregues ou pagamentos lançados."}</p></div> : (
        <div className="card" style={{ padding: 0 }}><div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 820 }}>
          <thead><tr><th style={{ paddingLeft: 16 }}>Cliente</th><th className="r">Faturado</th><th className="r">Pago</th><th className="r">Em aberto</th><th className="r">Em andamento</th><th className="r">Sem nota</th><th>Último pagamento</th><th /></tr></thead>
          <tbody>{lista.map(c => (
            <tr key={c.cliente_id}>
              <td style={{ paddingLeft: 16 }}><b>{c.nome}</b><div className="hint tnum">{c.pedidos} entregues{c.ultima_entrega ? ` · último ${dataCurta(c.ultima_entrega)}` : ""}</div></td>
              <td className="r tnum">{brl(c.faturado)}</td>
              <td className="r tnum">{brl(c.pago)}</td>
              <td className="r tnum"><b style={{ color: c.saldo > 0.009 ? "var(--tomato-ink)" : c.saldo < -0.009 ? "var(--green-ink)" : "var(--muted)" }}>{c.saldo < -0.009 ? `crédito ${brl(-c.saldo)}` : brl(c.saldo)}</b></td>
              <td className="r tnum muted">{c.em_andamento > 0 ? brl(c.em_andamento) : "—"}</td>
              <td className="r tnum">{c.sem_nota > 0 ? <span className="pill st-aprovado">{c.sem_nota}</span> : <span className="muted">—</span>}</td>
              <td className="tnum">{c.ultimo_pagamento ? dataCurta(c.ultimo_pagamento) : <span className="muted">nunca</span>}</td>
              <td style={{ textAlign: "right", paddingRight: 12 }}><button className="btn ghost sm" onClick={() => setAberto(c)}>Abrir conta</button></td>
            </tr>))}</tbody>
        </table></div></div>)}
      {aberto && <ContaCliente cliente={aberto} onClose={() => setAberto(null)} onMudou={carregar} />}
    </>
  );
}

function ContaCliente({ cliente, onClose, onMudou }: { cliente: LinhaCliente; onClose: () => void; onMudou: () => void }) {
  const [ext, setExt] = useState<Extrato | null>(null);
  const [aba, setAba] = useState<"extrato" | "pagamento" | "nota">("extrato");
  const [pag, setPag] = useState({ valor: "", data: hojeISO(), forma: "Pix", obs: "" });
  const [nota, setNota] = useState({ numero: "", data: hojeISO(), valor: "", obs: "" });
  const [selec, setSelec] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [apagar, setApagar] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("extrato_cliente", { p_cliente: cliente.cliente_id });
    if (error) toast(msgErro(error)); else setExt(data as Extrato);
  }, [cliente.cliente_id]);
  useEffect(() => { carregar(); }, [carregar]);

  const semNota = useMemo(() => (ext?.pedidos ?? []).filter(p => p.status === "entregue" && !p.nota_id), [ext]);
  const somaSelec = semNota.filter(p => selec.includes(p.id)).reduce((s, p) => s + Number(p.total), 0);
  useEffect(() => { setNota(n => ({ ...n, valor: somaSelec ? somaSelec.toFixed(2).replace(".", ",") : "" })); }, [somaSelec]);

  // Extrato em ordem de data com saldo acumulado (pedidos entregues somam, pagamentos abatem)
  const movimentos = useMemo(() => {
    if (!ext) return [];
    const ms = [
      ...ext.pedidos.filter(p => p.status === "entregue").map(p => ({ tipo: "pedido" as const, data: p.data, valor: Number(p.total), p })),
      ...ext.pagamentos.map(g => ({ tipo: "pagamento" as const, data: g.pago_em, valor: -Number(g.valor), g })),
    ].sort((a, b) => a.data.localeCompare(b.data) || (a.tipo === "pedido" ? -1 : 1));
    let saldo = 0;
    return ms.map(m => ({ ...m, saldo: (saldo = Math.round((saldo + m.valor) * 100) / 100) })).reverse();
  }, [ext]);
  const saldoAtual = movimentos[0]?.saldo ?? 0;
  const emAndamento = (ext?.pedidos ?? []).filter(p => p.status !== "entregue");

  async function lancarPagamento() {
    const v = num(pag.valor);
    if (isNaN(v) || v <= 0) { toast("Informe o valor pago"); return; }
    setSalvando(true);
    const { error } = await supabase.from("pagamentos").insert({ cliente_id: cliente.cliente_id, valor: Math.round(v * 100) / 100, pago_em: pag.data, forma: pag.forma, observacao: pag.obs.trim() || null });
    setSalvando(false);
    if (error) { toast(msgErro(error)); return; }
    toast(`Pagamento de ${brl(v)} lançado`); setPag({ valor: "", data: hojeISO(), forma: "Pix", obs: "" }); setAba("extrato"); carregar(); onMudou();
  }
  async function registrarNota() {
    const v = num(nota.valor);
    if (!nota.numero.trim()) { toast("Informe o número da nota"); return; }
    if (isNaN(v) || v < 0) { toast("Informe o valor da nota"); return; }
    setSalvando(true);
    const { error } = await supabase.rpc("registrar_nota", { p_cliente: cliente.cliente_id, p_numero: nota.numero, p_emitida_em: nota.data, p_valor: Math.round(v * 100) / 100, p_pedidos: selec, p_obs: nota.obs || null });
    setSalvando(false);
    if (error) { toast(msgErro(error)); return; }
    toast(`Nota ${nota.numero} registrada`); setNota({ numero: "", data: hojeISO(), valor: "", obs: "" }); setSelec([]); setAba("extrato"); carregar(); onMudou();
  }
  async function excluir(chave: string) {
    const [tipo, id] = chave.split(":");
    const { error } = await supabase.from(tipo === "pag" ? "pagamentos" : "notas_fiscais").delete().eq("id", Number(id));
    setApagar(null);
    if (error) { toast(msgErro(error)); return; }
    toast(tipo === "pag" ? "Pagamento excluído" : "Nota excluída; os pedidos voltaram para “sem nota”"); carregar(); onMudou();
  }
  const BotaoExcluir = ({ chave }: { chave: string }) => apagar === chave
    ? <span style={{ whiteSpace: "nowrap" }}><button className="btn red sm" onClick={() => excluir(chave)}>Excluir</button> <button className="btn ghost sm" onClick={() => setApagar(null)}>Não</button></span>
    : <button className="x" onClick={() => setApagar(chave)} aria-label="Excluir">✕</button>;

  return (
    <Modal titulo={cliente.nome} onClose={onClose}>
      {!ext ? <Carregando /> : <>
        <div className="kpis" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
          <div className="kpi"><small>Em aberto</small><b className="tnum" style={{ fontSize: 22, color: saldoAtual > 0.009 ? "var(--tomato-ink)" : "var(--green-ink)" }}>{saldoAtual < -0.009 ? `crédito ${brl(-saldoAtual)}` : brl(saldoAtual)}</b></div>
          <div className="kpi"><small>Sem nota</small><b className="tnum" style={{ fontSize: 22 }}>{semNota.length}</b></div>
          <div className="kpi"><small>Em andamento</small><b className="tnum" style={{ fontSize: 22 }}>{brl(emAndamento.reduce((s, p) => s + Number(p.total), 0))}</b></div>
        </div>
        <div className="chips">
          <button className="chip" aria-pressed={aba === "extrato"} onClick={() => setAba("extrato")}>Extrato</button>
          <button className="chip" aria-pressed={aba === "pagamento"} onClick={() => setAba("pagamento")}>Lançar pagamento</button>
          <button className="chip" aria-pressed={aba === "nota"} onClick={() => setAba("nota")}>Registrar nota</button>
        </div>

        {aba === "pagamento" && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="grid3">
            <label className="field"><span>Valor pago</span><input className="inp tnum" id="pag-valor" inputMode="decimal" placeholder="R$" value={pag.valor} onChange={e => setPag(x => ({ ...x, valor: e.target.value }))} autoFocus /></label>
            <label className="field"><span>Data</span><input className="inp" type="date" id="pag-data" value={pag.data} max={hojeISO()} onChange={e => setPag(x => ({ ...x, data: e.target.value }))} /></label>
            <label className="field"><span>Forma</span><select className="inp" id="pag-forma" value={pag.forma} onChange={e => setPag(x => ({ ...x, forma: e.target.value }))}>{FORMAS.map(f => <option key={f}>{f}</option>)}</select></label>
          </div>
          <label className="field"><span>Observação</span><input className="inp" id="pag-obs" value={pag.obs} onChange={e => setPag(x => ({ ...x, obs: e.target.value }))} placeholder="Ex.: referente à 1ª quinzena de outubro" /></label>
          <p className="hint" style={{ margin: 0 }}>O valor abate do saldo em aberto do cliente. Não precisa corresponder a um pedido.</p>
          <div><button className="btn" disabled={salvando} onClick={lancarPagamento}>{salvando ? "Salvando…" : "Lançar pagamento"}</button></div>
        </div>}

        {aba === "nota" && <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="lbl">Pedidos entregues sem nota</span>
          {!semNota.length ? <p className="hint" style={{ margin: 0 }}>Todos os pedidos entregues deste cliente já têm nota.</p> : (
            <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
              <label className="check" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", margin: 0 }}>
                <input type="checkbox" checked={selec.length === semNota.length} onChange={e => setSelec(e.target.checked ? semNota.map(p => p.id) : [])} /> <b>Selecionar todos</b></label>
              {semNota.map(p => (
                <label key={p.id} className="check tnum" style={{ padding: "6px 12px", margin: 0 }}>
                  <input type="checkbox" checked={selec.includes(p.id)} onChange={e => setSelec(s => (e.target.checked ? [...s, p.id] : s.filter(x => x !== p.id)))} />
                  nº {p.numero} · {dataCurta(p.data)} · {brl(p.total)}</label>))}
            </div>)}
          <div className="grid3">
            <label className="field"><span>Número da nota</span><input className="inp" id="nf-numero" value={nota.numero} onChange={e => setNota(x => ({ ...x, numero: e.target.value }))} placeholder="Ex.: 1234" /></label>
            <label className="field"><span>Emitida em</span><input className="inp" type="date" id="nf-data" value={nota.data} onChange={e => setNota(x => ({ ...x, data: e.target.value }))} /></label>
            <label className="field"><span>Valor</span><input className="inp tnum" id="nf-valor" inputMode="decimal" value={nota.valor} onChange={e => setNota(x => ({ ...x, valor: e.target.value }))} placeholder="R$" /></label>
          </div>
          <p className="hint" style={{ margin: 0 }}>O valor vem da soma dos pedidos marcados; ajuste se a nota tiver outro valor. Dá para registrar nota sem marcar pedidos.</p>
          <div><button className="btn" disabled={salvando} onClick={registrarNota}>{salvando ? "Salvando…" : `Registrar nota${selec.length ? ` (${selec.length} pedidos)` : ""}`}</button></div>
        </div>}

        {aba === "extrato" && <>
          {emAndamento.length > 0 && <p className="hint" style={{ margin: 0 }}>Em andamento (ainda não entra no saldo): {emAndamento.map(p => `nº ${p.numero} (${STATUS_INFO[p.status].rotulo.toLowerCase()})`).join(", ")}.</p>}
          {!movimentos.length ? <p className="hint">Nenhum pedido entregue ou pagamento ainda.</p> : (
            <div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 520 }}>
              <thead><tr><th>Data</th><th>Lançamento</th><th className="r">Valor</th><th className="r">Saldo</th><th /></tr></thead>
              <tbody>{movimentos.map(m => m.tipo === "pedido" ? (
                <tr key={"p" + m.p.id}>
                  <td className="tnum">{dataCurta(m.data)}</td>
                  <td>Pedido nº {m.p.numero} {m.p.nota_numero ? <span className="pill st-em_entrega">NF {m.p.nota_numero}</span> : <span className="pill st-aprovado">sem nota</span>}</td>
                  <td className="r tnum">{brl(m.valor)}</td><td className="r tnum">{brl(m.saldo)}</td><td />
                </tr>) : (
                <tr key={"g" + m.g.id}>
                  <td className="tnum">{dataCurta(m.data)}</td>
                  <td><b style={{ color: "var(--green-ink)" }}>Pagamento</b>{m.g.forma ? ` · ${m.g.forma}` : ""}{m.g.observacao ? <div className="hint">{m.g.observacao}</div> : null}</td>
                  <td className="r tnum" style={{ color: "var(--green-ink)" }}>−{brl(-m.valor)}</td><td className="r tnum">{brl(m.saldo)}</td>
                  <td style={{ textAlign: "right" }}><BotaoExcluir chave={`pag:${m.g.id}`} /></td>
                </tr>))}</tbody>
            </table></div>)}
          {ext.notas.length > 0 && <>
            <span className="lbl" style={{ marginTop: 6 }}>Notas emitidas</span>
            <div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 420 }}>
              <tbody>{ext.notas.map(n => (
                <tr key={n.id}><td><b>NF {n.numero}</b>{n.observacao ? <div className="hint">{n.observacao}</div> : null}</td><td className="tnum">{dataCurta(n.emitida_em)}</td>
                  <td className="r tnum">{brl(n.valor)}</td><td className="hint tnum">{ext.pedidos.filter(p => p.nota_id === n.id).length} pedidos</td>
                  <td style={{ textAlign: "right" }}><BotaoExcluir chave={`nf:${n.id}`} /></td></tr>))}</tbody>
            </table></div>
          </>}
        </>}
      </>}
    </Modal>
  );
}

