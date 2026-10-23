import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase, msgErro } from "../../lib/supabase";
import { brl, dataCurta } from "../../lib/format";
import { nomeMes, previsaoProximoMes, projecaoMesAtual, resumoClientes, type ClienteMensal, type Mes, type MesAtual } from "../../lib/previsao";
import { Carregando } from "../../components/ui";
import Dashboard from "./Dashboard";
import { Th, useOrdenacao } from "../../components/Ordenacao";

interface Mensal { hoje: string; meses: Mes[]; mes_atual: MesAtual; clientes: ClienteMensal[] }
const eixo = { fill: "var(--muted)", fontSize: 12 };
const tip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--ink)" } };
const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
const corPct = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? "var(--muted)" : v > 0 ? "var(--green-ink)" : "var(--tomato-ink)");
const reais = (v: number) => `R$ ${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

export default function Analises() {
  const [aba, setAba] = useState<"geral" | "mensal" | "clientes">("mensal");
  const [dados, setDados] = useState<Mensal | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    supabase.rpc("analise_mensal", { p_meses: 12 }).then(({ data, error }) => {
      if (error) setErro(msgErro(error)); else setDados(data as Mensal);
    });
  }, []);

  return (
    <>
      <div className="ptitle"><h1>Análises</h1><span className="sp" />
        <div className="chips">
          <button className="chip" aria-pressed={aba === "mensal"} onClick={() => setAba("mensal")}>Mês a mês e previsão</button>
          <button className="chip" aria-pressed={aba === "clientes"} onClick={() => setAba("clientes")}>Clientes</button>
          <button className="chip" aria-pressed={aba === "geral"} onClick={() => setAba("geral")}>Produtos e período</button>
        </div>
      </div>
      {aba === "geral" ? <Dashboard /> : erro ? <p className="erro">{erro}</p> : !dados ? <Carregando /> :
        aba === "mensal" ? <Mensal d={dados} /> : <Clientes d={dados} />}
    </>
  );
}

function Mensal({ d }: { d: Mensal }) {
  const atual = projecaoMesAtual(d.mes_atual);
  const prox = previsaoProximoMes(d.meses);
  const mesAtual = d.meses[d.meses.length - 1]?.mes;
  const completos = d.meses.slice(0, -1).filter(m => Number(m.faturamento) > 0);
  const mediaMensal = completos.length ? completos.reduce((s, m) => s + Number(m.faturamento), 0) / completos.length : 0;
  const serie = d.meses.map(m => m.mes === mesAtual
    ? { rot: nomeMes(m.mes), realizado: Number(d.mes_atual.realizado), agendado: Number(d.mes_atual.agendado), projecao: Math.max(0, atual.projecao - atual.garantido) }
    : { rot: nomeMes(m.mes), realizado: Number(m.faturamento), agendado: 0, projecao: 0 });
  const vazio = d.meses.every(m => Number(m.faturamento) === 0) && !atual.garantido;

  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>{nomeMes(mesAtual, false)} até agora</small><b className="tnum">{brl(d.mes_atual.realizado)}</b>
          <small>entregue até hoje · {brl(d.mes_atual.agendado)} já agendado</small></div>
        <div className="kpi"><small>Projeção do mês</small><b className="tnum">{brl(atual.projecao)}</b>
          <small>{atual.confiavel ? `no ritmo de ${brl(atual.ritmo)} por dia` : "estimativa fraca: poucos dias no mês"}</small></div>
        <div className="kpi"><small>Previsão do próximo mês</small><b className="tnum">{prox ? brl(prox.previsao) : "—"}</b>
          <small>{prox ? `faixa ${reais(prox.min)} a ${reais(prox.max)}` : "precisa de 1 mês completo de histórico"}</small></div>
        <div className="kpi"><small>Média mensal</small><b className="tnum">{completos.length ? brl(mediaMensal) : "—"}</b>
          <small>{completos.length ? `${completos.length} ${completos.length === 1 ? "mês completo" : "meses completos"}` : "sem mês completo ainda"}</small></div>
      </div>

      {vazio ? <div className="card empty" style={{ marginTop: 16 }}><h3>Ainda sem histórico</h3><p>Os meses aparecem conforme os pedidos forem entregues. A previsão fica melhor a partir de 3 meses de uso.</p></div> : <>
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}><h3 style={{ fontSize: 16 }}>Faturamento por mês</h3><span className="sp" />
            <span className="hint"><Legenda cor="var(--green)" /> entregue <Legenda cor="var(--green-soft)" borda /> agendado <Legenda cor="var(--amber-soft)" borda="var(--amber)" /> projeção</span></div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={serie} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="rot" tick={eixo} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
              <YAxis tick={eixo} tickLine={false} axisLine={false} width={70} tickFormatter={reais} />
              <Tooltip {...tip} cursor={{ fill: "var(--green-soft)" }} formatter={(v: number, n: string) => [brl(v), n === "realizado" ? "Entregue" : n === "agendado" ? "Agendado" : "Projeção"]} />
              <Bar dataKey="realizado" stackId="a" fill="var(--green)" maxBarSize={44} />
              <Bar dataKey="agendado" stackId="a" fill="var(--green-soft)" stroke="var(--green)" strokeWidth={1} maxBarSize={44} />
              <Bar dataKey="projecao" stackId="a" fill="var(--amber-soft)" stroke="var(--amber)" strokeDasharray="4 3" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{ marginTop: 16, padding: 0 }}><div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 520 }}>
          <thead><tr><th style={{ paddingLeft: 16 }}>Mês</th><th className="r">Faturamento</th><th className="r">Pedidos</th><th className="r">Clientes</th><th className="r">Ticket médio</th><th className="r">vs mês anterior</th></tr></thead>
          <tbody>{[...d.meses].reverse().filter(m => Number(m.faturamento) > 0 || m.mes === mesAtual).map(m => {
            const ix = d.meses.findIndex(x => x.mes === m.mes); const ant = ix > 0 ? Number(d.meses[ix - 1].faturamento) : 0;
            const v = ant ? (Number(m.faturamento) - ant) / ant : null;
            return <tr key={m.mes}>
              <td style={{ paddingLeft: 16 }}><b>{nomeMes(m.mes, false)}</b>{m.mes === mesAtual && <span className="hint"> · parcial</span>}</td>
              <td className="r tnum">{brl(m.faturamento)}</td><td className="r tnum">{m.pedidos}</td><td className="r tnum">{m.clientes}</td>
              <td className="r tnum">{m.pedidos ? brl(Number(m.faturamento) / m.pedidos) : "—"}</td>
              <td className="r tnum" style={{ color: m.mes === mesAtual ? "var(--muted)" : corPct(v) }}>{m.mes === mesAtual ? "—" : pct(v)}</td>
            </tr>;
          })}</tbody>
        </table></div></div>
        <p className="hint">
          Como as contas são feitas: o faturamento considera a <b>data de entrega</b> dos pedidos não cancelados.
          A <b>projeção do mês</b> é o maior valor entre o que já foi entregue mais o que está agendado e o ritmo diário até hoje multiplicado pelos dias do mês.
          A <b>previsão do próximo mês</b> é a média dos últimos 3 meses completos{prox?.tendencia != null ? ", ajustada pela tendência dos últimos meses" : ""}. O primeiro mês de uso é ignorado por estar incompleto. Quanto mais meses de histórico, mais confiável.
        </p>
      </>}
    </>
  );
}

function Legenda({ cor, borda }: { cor: string; borda?: boolean | string }) {
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: cor, border: borda ? `1px solid ${typeof borda === "string" ? borda : "var(--green)"}` : undefined, margin: "0 4px 0 10px", verticalAlign: "middle" }} />;
}

function Clientes({ d }: { d: Mensal }) {
  const ultimos = d.meses.slice(-6).map(m => m.mes);
  const lista = useMemo(() => resumoClientes(d.clientes.filter(c => Number(c.total) > 0), d.meses.map(m => m.mes), d.hoje), [d]);
  const colunas: Record<string, (c: (typeof lista)[number]) => string | number | null> = {
    nome: c => c.nome, total: c => Number(c.total), media3: c => c.media3, tendencia: c => c.tendencia,
    previsao: c => c.previsao, dias: c => c.diasSemPedir,
  };
  ultimos.forEach(m => { colunas["m:" + m] = c => Number(c.meses[m] ?? 0); });
  const { ordenados: ordenada, ord, alternar } = useOrdenacao(lista, colunas, { chave: "total", dir: "desc" }, "analise_clientes");
  const sumidos = lista.filter(c => c.sumiu);
  const previsaoTotal = lista.reduce((s, c) => s + c.previsao, 0);

  if (!lista.length) return <div className="card empty"><h3>Ainda sem histórico de clientes</h3><p>Os clientes aparecem aqui conforme os pedidos forem entregues.</p></div>;
  return (
    <>
      <div className="kpis">
        <div className="kpi"><small>Clientes com pedido no período</small><b className="tnum">{lista.length}</b><small>últimos 12 meses</small></div>
        <div className="kpi"><small>Previsão somando os clientes</small><b className="tnum">{brl(previsaoTotal)}</b><small>média mensal recente de cada um</small></div>
        <div className="kpi"><small>Pararam de pedir</small><b className="tnum" style={{ color: sumidos.length ? "var(--tomato-ink)" : undefined }}>{sumidos.length}</b><small>sem pedido há mais que o dobro do intervalo de costume</small></div>
        <div className="kpi"><small>Maior cliente</small><b className="tnum" style={{ fontSize: 18 }}>{[...lista].sort((a, b) => Number(b.total) - Number(a.total))[0]?.nome ?? "—"}</b><small>{brl([...lista].sort((a, b) => Number(b.total) - Number(a.total))[0]?.total ?? 0)} no período</small></div>
      </div>
      {sumidos.length > 0 && <div className="endbox" style={{ marginTop: 14, background: "var(--tomato-soft)" }}>
        <b>Vale ligar:</b> {sumidos.map(c => `${c.nome} (sem pedir há ${c.diasSemPedir} dias; costuma pedir a cada ${Math.round(c.intervaloMedio!)})`).join(" · ")}
      </div>}
      <p className="hint" style={{ margin: "14px 0 8px" }}>Toque no título de uma coluna para ordenar. {ord.chave === "total" ? "Ordem atual: quem mais gastou no período." : ""}</p>
      <div className="card" style={{ padding: 0 }}><div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 980 }}>
        <thead><tr><Th chave="nome" ord={ord} alternar={alternar} style={{ paddingLeft: 16 }}>Cliente</Th>
          {ultimos.map((m, i) => <Th key={m} chave={"m:" + m} ord={ord} alternar={alternar} direita padrao="desc">{nomeMes(m)}{i === ultimos.length - 1 ? "*" : ""}</Th>)}
          <Th chave="media3" ord={ord} alternar={alternar} direita padrao="desc">Média 3 meses</Th>
          <Th chave="tendencia" ord={ord} alternar={alternar} direita padrao="desc">Tendência</Th>
          <Th chave="previsao" ord={ord} alternar={alternar} direita padrao="desc">Previsão próx. mês</Th>
          <Th chave="dias" ord={ord} alternar={alternar} padrao="desc">Último pedido</Th></tr></thead>
        <tbody>{ordenada.map(c => (
          <tr key={c.cliente_id} style={c.sumiu ? { background: "var(--tomato-soft)" } : undefined}>
            <td style={{ paddingLeft: 16 }}><b>{c.nome}</b><div className="hint tnum">{c.pedidos} pedidos{c.intervaloMedio != null ? ` · a cada ${Math.round(c.intervaloMedio)} dias` : ""}</div></td>
            {ultimos.map(m => <td key={m} className="r tnum">{c.meses[m] ? brl(c.meses[m]) : <span className="muted">—</span>}</td>)}
            <td className="r tnum">{brl(c.media3)}</td>
            <td className="r tnum" style={{ color: corPct(c.tendencia) }}>{pct(c.tendencia)}</td>
            <td className="r tnum"><b>{brl(c.previsao)}</b></td>
            <td className="tnum">{dataCurta(c.ultimo)}<div className="hint" style={{ color: c.sumiu ? "var(--tomato-ink)" : undefined }}>{c.diasSemPedir === 0 ? "hoje" : `há ${c.diasSemPedir} dias`}</div></td>
          </tr>))}</tbody>
      </table></div></div>
      <p className="hint">* mês atual, parcial. A previsão de cada cliente é a média dos últimos 3 meses completos desde o primeiro pedido dele. A tendência compara o último mês completo com a média dos anteriores.</p>
    </>
  );
}
