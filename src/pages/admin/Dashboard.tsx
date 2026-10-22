import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, hojeISO, qtd } from "../../lib/format";
import { STATUS_INFO, type Status } from "../../lib/types";
import { Carregando } from "../../components/ui";

interface Dados {
  pedidos: number; cancelados: number; aguardando: number; faturamento: number; ticket_medio: number; clientes: number;
  por_dia: { dia: string; pedidos: number; faturamento: number }[];
  por_status: Partial<Record<Status, number>>;
  por_dia_semana: { dow: number; pedidos: number }[];
  top_produtos: { nome: string; unidade: string; quantidade: number; valor: number; pedidos: number }[];
  top_clientes: { nome: string; pedidos: number; valor: number }[];
  em_falta: { nome: string; vezes: number }[];
}
const PERIODOS: [string, string, () => [string, string]][] = [
  ["7", "7 dias", () => [hojeISO(-6), hojeISO()]],
  ["30", "30 dias", () => [hojeISO(-29), hojeISO()]],
  ["mes", "Este mês", () => [hojeISO().slice(0, 8) + "01", hojeISO()]],
  ["90", "90 dias", () => [hojeISO(-89), hojeISO()]],
];
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const eixo = { fill: "var(--muted)", fontSize: 12 };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" } };

export default function Dashboard() {
  const [per, setPer] = useState("30");
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const [de, ate] = PERIODOS.find(p => p[0] === per)![2]();
    setD(null); setErro("");
    supabase.rpc("dashboard", { p_de: de, p_ate: ate }).then(({ data, error }) => {
      if (error) setErro(msgErro(error)); else setD(data as Dados);
    });
  }, [per]);

  const head = (
    <div className="ptitle"><h1>Análises</h1><span className="sp" />
      <div className="chips">{PERIODOS.map(([k, l]) => <button key={k} className="chip" aria-pressed={per === k} onClick={() => setPer(k)}>{l}</button>)}</div></div>
  );
  if (erro) return <>{head}<p className="erro">{erro}</p></>;
  if (!d) return <>{head}<Carregando /></>;

  const serie = d.por_dia.map(x => ({ ...x, rot: x.dia.slice(8, 10) + "/" + x.dia.slice(5, 7), faturamento: Number(x.faturamento) }));
  const semana = DIAS.map((rot, i) => ({ rot, pedidos: d.por_dia_semana.find(x => x.dow === i)?.pedidos ?? 0 }));
  const maxProd = Math.max(1, ...d.top_produtos.map(p => Number(p.valor)));
  const maxCli = Math.max(1, ...d.top_clientes.map(c => Number(c.valor)));
  const vazio = d.pedidos === 0 && d.cancelados === 0;

  return (
    <>
      {head}
      <div className="kpis">
        <div className="kpi"><small>Faturamento aprovado</small><b className="tnum">{brl(d.faturamento)}</b><small>pedidos aprovados até entregues</small></div>
        <div className="kpi"><small>Pedidos</small><b className="tnum">{d.pedidos}</b><small>{d.cancelados} cancelados no período</small></div>
        <div className="kpi"><small>Ticket médio</small><b className="tnum">{brl(d.ticket_medio)}</b><small>por pedido aprovado</small></div>
        <div className="kpi"><small>Clientes atendidos</small><b className="tnum">{d.clientes}</b><small>{d.aguardando} pedidos esperando aprovação agora</small></div>
      </div>
      {vazio ? <div className="card empty" style={{ marginTop: 16 }}><h3>Sem pedidos neste período</h3><p>Os gráficos aparecem assim que os primeiros pedidos forem aprovados.</p></div> : (
        <div className="charts">
          <div className="card wide"><h3>Faturamento por dia</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={serie} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="rot" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tick={eixo} tickLine={false} axisLine={false} width={64} tickFormatter={v => `R$ ${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} />
                <Tooltip {...tip} cursor={{ fill: "var(--green-soft)" }} formatter={(v: number, n) => [n === "faturamento" ? brl(v) : v, n === "faturamento" ? "Faturamento" : "Pedidos"]} labelFormatter={l => `Dia ${l}`} />
                <Bar dataKey="faturamento" fill="var(--green)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card"><h3>Produtos que mais vendem</h3>
            {d.top_produtos.length ? d.top_produtos.map(p => (
              <div className="bar-row" key={p.nome + p.unidade}>
                <span className="nm" title={p.nome}>{p.nome}</span>
                <span className="bar"><i style={{ width: `${(Number(p.valor) / maxProd) * 100}%` }} /></span>
                <span className="tnum hint" style={{ textAlign: "right" }}>{brl(p.valor)} · {qtd(p.quantidade)} {p.unidade}</span>
              </div>)) : <p className="hint">Sem pedidos aprovados no período.</p>}
          </div>
          <div className="card"><h3>Clientes que mais compram</h3>
            {d.top_clientes.length ? d.top_clientes.map(c => (
              <div className="bar-row" key={c.nome}>
                <span className="nm" title={c.nome}>{c.nome}</span>
                <span className="bar"><i style={{ width: `${(Number(c.valor) / maxCli) * 100}%`, background: "var(--tomato)" }} /></span>
                <span className="tnum hint" style={{ textAlign: "right" }}>{brl(c.valor)} · {c.pedidos} ped.</span>
              </div>)) : <p className="hint">Sem pedidos aprovados no período.</p>}
          </div>
          <div className="card"><h3>Pedidos por dia da semana</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={semana} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="rot" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                <YAxis tick={eixo} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip {...tip} cursor={{ fill: "var(--green-soft)" }} formatter={(v: number) => [v, "Pedidos"]} />
                <Bar dataKey="pedidos" fill="var(--green)" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card"><h3>Situação dos pedidos</h3>
            <table className="t"><tbody>{(Object.keys(STATUS_INFO) as Status[]).map(s => (
              <tr key={s}><td><span className={`pill st-${s}`}>{STATUS_INFO[s].rotulo}</span></td><td className="r tnum"><b>{d.por_status[s] ?? 0}</b></td></tr>))}</tbody></table>
            {d.em_falta.length > 0 && <>
              <h3 style={{ marginTop: 18 }}>Mais vezes em falta</h3>
              <p className="hint" style={{ marginTop: -4 }}>Itens pedidos que a loja não tinha. Bom para planejar a compra no Ceasa.</p>
              <table className="t"><tbody>{d.em_falta.map(f => <tr key={f.nome}><td>{f.nome}</td><td className="r tnum">{f.vezes}×</td></tr>)}</tbody></table>
            </>}
          </div>
        </div>)}
    </>
  );
}
