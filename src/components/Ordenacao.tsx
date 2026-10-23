import { useMemo, useRef, useState, type ReactNode } from "react";

export type Direcao = "asc" | "desc";
export interface Ordem { chave: string; dir: Direcao }
type Valor = string | number | null | undefined;

const comparador = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
/** Compara textos em português (sem diferenciar acento/maiúscula) e números; vazios sempre no fim. */
export function comparar(a: Valor, b: Valor, dir: Direcao = "asc") {
  const va = a === "" ? null : a, vb = b === "" ? null : b;
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const r = typeof va === "number" && typeof vb === "number" ? va - vb : comparador.compare(String(va), String(vb));
  return dir === "asc" ? r : -r;
}
/** Ordena por nome em ordem alfabética (pt-BR). */
export const porNome = <T extends { nome: string }>(a: T, b: T) => comparador.compare(a.nome, b.nome);

const ler = (k: string, padrao: Ordem): Ordem => {
  try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v?.chave ? v : padrao; } catch { return padrao; }
};

/**
 * Ordenação de tabela clicando no título da coluna.
 * `colunas` diz como ler o valor de cada coluna; `memoria` guarda a escolha neste navegador.
 */
export function useOrdenacao<T>(itens: T[], colunas: Record<string, (x: T) => Valor>, inicial: Ordem, memoria?: string) {
  const [ord, setOrd] = useState<Ordem>(() => (memoria ? ler(`sacolao_ord_${memoria}`, inicial) : inicial));
  const ref = useRef(colunas); ref.current = colunas;
  const ordenados = useMemo(() => {
    const f = ref.current[ord.chave] ?? ref.current[inicial.chave];
    return [...itens].sort((a, b) => comparar(f(a), f(b), ord.dir));
  }, [itens, ord, inicial.chave]);
  const alternar = (chave: string, dirPadrao: Direcao = "asc") => setOrd(o => {
    const n: Ordem = o.chave === chave ? { chave, dir: o.dir === "asc" ? "desc" : "asc" } : { chave, dir: dirPadrao };
    if (memoria) try { localStorage.setItem(`sacolao_ord_${memoria}`, JSON.stringify(n)); } catch { /* sem armazenamento */ }
    return n;
  });
  return { ordenados, ord, alternar };
}

/** Título de coluna clicável. `padrao` = direção do 1º clique (números costumam começar do maior). */
export function Th({ chave, ord, alternar, children, direita, padrao = "asc", style }: {
  chave: string; ord: Ordem; alternar: (c: string, d?: Direcao) => void; children: ReactNode;
  direita?: boolean; padrao?: Direcao; style?: React.CSSProperties;
}) {
  const ativo = ord.chave === chave;
  return (
    <th className={direita ? "r" : undefined} style={style} aria-sort={ativo ? (ord.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`th-ord ${ativo ? "on" : ""}`} onClick={() => alternar(chave, padrao)} title="Ordenar">
        {children}<span className="seta" aria-hidden="true">{ativo ? (ord.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}
