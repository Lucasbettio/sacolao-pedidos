import { useEffect, useMemo, useState } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { dataCurta, hojeISO, qtd } from "../../lib/format";
import { Carregando, copiar } from "../../components/ui";

interface Linha {
  categoria: string; nome: string; unidade: string; quantidade: number; pedidos: number;
  detalhe: { numero: number; cliente: string; quantidade: number; entrega: string; turno: string }[];
}
const PERIODOS: [string, string, () => [string, string]][] = [
  ["amanha", "Amanhã", () => [hojeISO(1), hojeISO(1)]],
  ["hoje", "Hoje", () => [hojeISO(), hojeISO()]],
  ["hoje-amanha", "Hoje e amanhã", () => [hojeISO(), hojeISO(1)]],
  ["semana", "Próximos 7 dias", () => [hojeISO(), hojeISO(6)]],
];
const lerMarcados = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };

export default function Ceasa() {
  const [per, setPer] = useState("amanha");
  const [de, setDe] = useState(hojeISO(1));
  const [ate, setAte] = useState(hojeISO(1));
  const [incluiNovos, setIncluiNovos] = useState(true);
  const [incluiPreparo, setIncluiPreparo] = useState(true);
  const [dados, setDados] = useState<{ pedidos: number; itens: Linha[] } | null>(null);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  // "Comprado" fica salvo neste aparelho, por período (para ir riscando na Ceasa)
  const chaveMarc = `sacolao_ceasa_${de}_${ate}`;
  const [marcados, setMarcados] = useState<string[]>(() => lerMarcados(chaveMarc));
  useEffect(() => setMarcados(lerMarcados(chaveMarc)), [chaveMarc]);
  const marca = (k: string) => setMarcados(m => {
    const n = m.includes(k) ? m.filter(x => x !== k) : [...m, k];
    try { localStorage.setItem(chaveMarc, JSON.stringify(n)); } catch { /* sem armazenamento */ }
    return n;
  });

  const status = useMemo(() => [incluiNovos && "recebido", incluiPreparo && "preparando"].filter(Boolean) as string[], [incluiNovos, incluiPreparo]);
  useEffect(() => {
    setDados(null); setErro("");
    if (!status.length) { setDados({ pedidos: 0, itens: [] }); return; }
    supabase.rpc("lista_compras", { p_de: de, p_ate: ate, p_status: status })
      .then(({ data, error }) => { if (error) setErro(msgErro(error)); else setDados(data); });
  }, [de, ate, status]);

  const escolhe = (k: string) => { const [a, b] = PERIODOS.find(p => p[0] === k)![2](); setPer(k); setDe(a); setAte(b); };
  const chave = (l: Linha) => `${l.nome}|${l.unidade}`;
  const grupos = useMemo(() => {
    const g = new Map<string, Linha[]>();
    (dados?.itens ?? []).forEach(l => g.set(l.categoria, [...(g.get(l.categoria) ?? []), l]));
    return [...g.entries()];
  }, [dados]);
  const periodoTxt = de === ate ? dataCurta(de) : `${dataCurta(de)} a ${dataCurta(ate)}`;

  const texto = () => {
    const L = [`*Lista da Ceasa · entregas ${periodoTxt}*`, `${dados?.pedidos ?? 0} pedidos`, ""];
    grupos.forEach(([cat, ls]) => {
      L.push(`*${cat}*`);
      ls.forEach(l => L.push(`- ${qtd(l.quantidade)} ${l.unidade} ${l.nome}`));
      L.push("");
    });
    return L.join("\n").trim();
  };

  return (
    <>
      <div className="ptitle no-print"><h1>Lista da Ceasa</h1><span className="sp" />
        <button className="btn ghost sm" disabled={!dados?.itens.length} onClick={() => copiar(texto())}>Copiar lista</button>
        <button className="btn ghost sm" disabled={!dados?.itens.length} onClick={() => window.print()}>Imprimir</button>
      </div>

      <div className="card no-print" style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {PERIODOS.map(([k, l]) => <button key={k} className="chip" aria-pressed={per === k} onClick={() => escolhe(k)}>{l}</button>)}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label className="field" style={{ flex: "0 1 170px" }}><span>Entrega de</span>
            <input className="inp" type="date" id="ceasa-de" value={de} onChange={e => { setPer(""); setDe(e.target.value); if (e.target.value > ate) setAte(e.target.value); }} /></label>
          <label className="field" style={{ flex: "0 1 170px" }}><span>até</span>
            <input className="inp" type="date" id="ceasa-ate" value={ate} min={de} onChange={e => { setPer(""); setAte(e.target.value); }} /></label>
          <label className="check"><input type="checkbox" checked={incluiNovos} onChange={e => setIncluiNovos(e.target.checked)} /> Pedidos novos</label>
          <label className="check"><input type="checkbox" checked={incluiPreparo} onChange={e => setIncluiPreparo(e.target.checked)} /> Em preparo</label>
        </div>
      </div>

      <h2 className="print-only" style={{ marginBottom: 8 }}>Lista da Ceasa · entregas {periodoTxt}</h2>
      {erro ? <p className="erro">{erro}</p> : !dados ? <Carregando /> : !dados.itens.length ? (
        <div className="card empty"><h3>Nada para comprar neste período</h3><p>Nenhum pedido com entrega {periodoTxt}. Troque o período ou inclua outras situações.</p></div>
      ) : (
        <>
          <p className="hint tnum" style={{ marginTop: 0 }}>
            {dados.pedidos} {dados.pedidos === 1 ? "pedido" : "pedidos"} · {dados.itens.length} itens · {marcados.filter(m => dados.itens.some(l => chave(l) === m)).length} comprados.
            Itens marcados como em falta nos pedidos não entram na soma.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {grupos.map(([cat, ls]) => (
              <section className="card ceasa" key={cat} style={{ padding: "6px 0" }}>
                <h3 style={{ padding: "8px 16px 4px", fontSize: 14, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--green-ink)" }}>{cat}</h3>
                {ls.map(l => {
                  const k = chave(l); const ok = marcados.includes(k);
                  return (
                    <div key={k} style={{ borderTop: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", opacity: ok ? .5 : 1 }}>
                        <input type="checkbox" checked={ok} onChange={() => marca(k)} aria-label={`Comprado: ${l.nome}`} style={{ width: 20, height: 20, flex: "none" }} />
                        <span className="tnum" style={{ minWidth: 92, fontWeight: 700, fontSize: 17, color: "var(--green-ink)" }}>{qtd(l.quantidade)} {l.unidade}</span>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, textDecoration: ok ? "line-through" : "none" }}>{l.nome}</span>
                        <button className="btn ghost sm no-print" onClick={() => setAberto(a => (a === k ? null : k))} aria-expanded={aberto === k}>
                          {l.pedidos} {l.pedidos === 1 ? "pedido" : "pedidos"}</button>
                      </div>
                      {aberto === k && (
                        <ul style={{ margin: 0, padding: "0 16px 10px 64px", listStyle: "none", fontSize: 13.5 }} className="muted">
                          {l.detalhe.map(d => <li key={d.numero} className="tnum">{qtd(d.quantidade)} {l.unidade} · {d.cliente} · nº {d.numero} · {dataCurta(d.entrega)} {d.turno}</li>)}
                        </ul>)}
                    </div>);
                })}
              </section>))}
          </div>
        </>
      )}
    </>
  );
}
