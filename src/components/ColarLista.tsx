import { useMemo, useState } from "react";
import { casar, escolhaClara, lerItem } from "../lib/lista";
import { qtd } from "../lib/format";
import { UNIDADES, type Produto, type Unidade } from "../lib/types";
import { Modal } from "./ui";

export interface ItemColado { produto_id: number | null; nome: string; quantidade: number; unidade: Unidade }

interface Linha {
  texto: string; nomeLido: string; quantidade: string; unidade: Unidade;
  escolha: string;               // id do produto, "fora" (item fora da lista) ou "ignorar"
  candidatos: Produto[]; clara: boolean; unidadeLida: Unidade | null;
}

const EXEMPLO = "2 kg tomate italiano\n3 alface americana\n1 dz ovos caipira\n2 molhos de rúcula\nbanana prata 5kg";

/** Janela "Colar minha lista": lê o texto, sugere os produtos e devolve os itens confirmados. */
export default function ColarLista({ produtos, onAdicionar, onClose }: {
  produtos: Produto[]; onAdicionar: (itens: ItemColado[]) => void; onClose: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const porId = useMemo(() => new Map(produtos.map(p => [String(p.id), p])), [produtos]);

  function ler() {
    const ls: Linha[] = [];
    for (const bruta of texto.split(/\r?\n/)) {
      const it = lerItem(bruta);
      if (!it) continue;
      const cands = casar(it.nome, produtos).map(c => c.produto);
      const clara = escolhaClara(casar(it.nome, produtos));
      const escolhido = clara ?? cands[0] ?? null;
      ls.push({
        texto: it.texto, nomeLido: it.nome, quantidade: qtd(it.quantidade),
        unidade: it.unidade ?? escolhido?.unidade ?? "un", unidadeLida: it.unidade,
        escolha: escolhido ? String(escolhido.id) : it.temQuantidade ? "fora" : "ignorar",
        candidatos: cands, clara: !!clara,
      });
    }
    setLinhas(ls);
  }
  const muda = (i: number, patch: Partial<Linha>) => setLinhas(ls => ls!.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const escolher = (i: number, escolha: string) => {
    const l = linhas![i]; const p = porId.get(escolha);
    muda(i, { escolha, clara: true, unidade: l.unidadeLida ?? p?.unidade ?? l.unidade });
  };

  const validos = (linhas ?? []).filter(l => l.escolha !== "ignorar" && parseFloat(l.quantidade.replace(",", ".")) > 0);
  const duvidas = (linhas ?? []).filter(l => l.escolha !== "ignorar" && !l.clara && l.escolha !== "fora").length;

  function adicionar() {
    onAdicionar(validos.map(l => {
      const p = porId.get(l.escolha);
      return { produto_id: p ? p.id : null, nome: p ? p.nome : l.nomeLido, quantidade: parseFloat(l.quantidade.replace(",", ".")), unidade: l.unidade };
    }));
  }

  return (
    <Modal titulo="Colar minha lista" onClose={onClose}>
      {!linhas ? <>
        <p className="muted" style={{ margin: 0 }}>Cole a lista do jeito que você escreve no WhatsApp, um item por linha. A gente encontra os produtos e você confere antes de adicionar.</p>
        <textarea className="inp" id="lista-colada" rows={10} value={texto} onChange={e => setTexto(e.target.value)} placeholder={EXEMPLO} autoFocus />
        <div className="acoes" style={{ marginTop: 0 }}>
          <button className="btn" disabled={!texto.trim()} onClick={ler}>Ler lista</button>
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
        </div>
      </> : <>
        <p className="hint" style={{ margin: 0 }}>
          {validos.length} {validos.length === 1 ? "item" : "itens"} para adicionar.
          {duvidas > 0 && <b style={{ color: "var(--tomato-ink)" }}> Confira {duvidas === 1 ? "a linha marcada" : `as ${duvidas} linhas marcadas`}: tem mais de um produto parecido.</b>}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {linhas.map((l, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 10px", opacity: l.escolha === "ignorar" ? .5 : 1,
              background: !l.clara && l.escolha !== "ignorar" && l.escolha !== "fora" ? "var(--tomato-soft)" : "var(--bg)" }}>
              <div className="hint" style={{ marginBottom: 6, overflowWrap: "anywhere" }}>“{l.texto}”</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input className="inp tnum" style={{ width: 72, padding: "6px 8px" }} value={l.quantidade} inputMode="decimal" aria-label="Quantidade"
                  disabled={l.escolha === "ignorar"} onChange={e => muda(i, { quantidade: e.target.value })} />
                <select className="inp" style={{ width: 96, padding: "6px 8px" }} value={l.unidade} aria-label="Unidade" disabled={l.escolha === "ignorar"}
                  onChange={e => muda(i, { unidade: e.target.value as Unidade })}>{UNIDADES.map(u => <option key={u}>{u}</option>)}</select>
                <select className="inp" style={{ flex: "1 1 200px", padding: "6px 8px" }} value={l.escolha} aria-label="Produto" onChange={e => escolher(i, e.target.value)}>
                  {l.candidatos.map(p => <option key={p.id} value={String(p.id)}>{p.nome}</option>)}
                  {l.escolha !== "fora" && l.escolha !== "ignorar" && !l.candidatos.some(p => String(p.id) === l.escolha) &&
                    <option value={l.escolha}>{porId.get(l.escolha)?.nome}</option>}
                  <option value="fora">Item fora da lista: “{l.nomeLido}”</option>
                  <option value="ignorar">Ignorar esta linha</option>
                </select>
              </div>
            </div>))}
          {!linhas.length && <p className="hint">Não encontrei itens nesse texto. Escreva um item por linha, por exemplo “2 kg tomate”.</p>}
        </div>
        <div className="acoes" style={{ marginTop: 0 }}>
          <button className="btn" disabled={!validos.length} onClick={adicionar}>Adicionar {validos.length} {validos.length === 1 ? "item" : "itens"} ao pedido</button>
          <button className="btn ghost" onClick={() => setLinhas(null)}>Voltar ao texto</button>
        </div>
      </>}
    </Modal>
  );
}
