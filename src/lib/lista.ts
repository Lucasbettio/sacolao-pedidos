// Leitura de listas coladas (WhatsApp, planilha, bloco de notas).
// - lerItem: "2 kg de tomate", "tomate 2kg", "3 alface", "1 dz ovos", "meio kg alho"
// - lerPreco: "Abacate;KG;5,89", "Abacate - R$ 5,89/kg", "Carvão Rambo 3kg 16,90"
// - casar: encontra os produtos mais parecidos com um nome digitado.
import type { Unidade } from "./types";

export interface ProdutoBase { id: number; nome: string; unidade: Unidade }

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normalizar = (s: string) =>
  semAcento(s).toLowerCase().replace(/[^a-z0-9.,/ ]+/g, " ").replace(/\s+/g, " ").trim();

const PALAVRAS_VAZIAS = new Set([
  "de", "do", "da", "dos", "das", "e", "com", "o", "a", "os", "as", "p", "pra", "para",
  "kg", "kgs", "kilo", "kilos", "quilo", "quilos", "un", "und", "unid", "unidade", "unidades", "uni",
  "molho", "molhos", "maco", "macos", "duzia", "duzias", "dz", "bandeja", "bandejas", "bdj", "band",
  "cx", "caixa", "caixas", "pe", "pes", "pct", "pacote", "pacotes", "g", "gr", "grama", "gramas", "padrao",
]);
function singular(t: string) {
  if (t.length <= 3) return t;
  if (t.endsWith("oes") || t.endsWith("aes")) return t.slice(0, -3) + "ao";
  if (t.endsWith("ns")) return t.slice(0, -2) + "m";
  if (t.endsWith("es") && /(r|z)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s")) return t.slice(0, -1);
  return t;
}
export function palavras(s: string) {
  return normalizar(s).replace(/[.,/]/g, " ").split(" ")
    .filter(t => t && !PALAVRAS_VAZIAS.has(t)).map(singular);
}

const UNIDADE_RE = "kg|kgs|kilos?|quilos?|g|gr|gramas?|un|und|unid|unidades?|molhos?|ma[cç]os?|dz|d[uú]zias?|bandejas?|bdj|band|cx|caixas?|p[eé]s?|pct|pacotes?";
function unidadeDe(u?: string): { unidade: Unidade | null; fator: number } {
  if (!u) return { unidade: null, fator: 1 };
  const x = normalizar(u);
  if (/^(kg|kgs|kilos?|quilos?)$/.test(x)) return { unidade: "kg", fator: 1 };
  if (/^(g|gr|gramas?)$/.test(x)) return { unidade: "kg", fator: 0.001 };
  if (/^(molhos?|macos?)$/.test(x)) return { unidade: "molho", fator: 1 };
  if (/^(dz|duzias?)$/.test(x)) return { unidade: "dúzia", fator: 1 };
  if (/^(bandejas?|bdj|band)$/.test(x)) return { unidade: "bandeja", fator: 1 };
  return { unidade: "un", fator: 1 };
}
const numero = (s: string) => {
  if (s.includes("/")) { const [a, b] = s.split("/").map(Number); return b ? a / b : NaN; }
  return parseFloat(s.replace(",", "."));
};

/** Limpa marcadores de lista e formatação do WhatsApp. */
function limpar(linha: string) {
  return linha.replace(/[*_~`]/g, " ")
    .replace(/^\s*(?:[-–—•·▪►✓✔☐□]+|\d+\s*[)\]]|\d+\.\s+(?=\D))\s*/, "")
    .replace(/\bmei[oa]\s+(?=kg|quilo|kilo|d[uú]zia|dz)/i, "0,5 ")
    .replace(/\s+/g, " ").trim();
}

export interface ItemLido { texto: string; nome: string; quantidade: number; unidade: Unidade | null; temQuantidade: boolean }

/** Lê uma linha de pedido. Retorna null para linhas vazias ou de cabeçalho. */
export function lerItem(linhaBruta: string): ItemLido | null {
  const texto = linhaBruta.trim();
  const l = limpar(texto);
  if (!l || !/[a-zA-ZÀ-ú]/.test(l)) return null;
  const num = "(\\d+(?:[.,]\\d+)?|\\d+/\\d+)";
  // "2 kg de tomate", "2kg tomate", "3 alface", "500g de gengibre"
  let m = l.match(new RegExp(`^${num}\\s*(${UNIDADE_RE})?\\.?\\s+(?:de\\s+|do\\s+|da\\s+)?(.+)$`, "i"));
  if (m) {
    const { unidade, fator } = unidadeDe(m[2]);
    return { texto, nome: m[3].trim(), quantidade: numero(m[1]) * fator, unidade, temQuantidade: true };
  }
  // "tomate 2kg", "tomate - 2 kg", "alface x3", "ovos: 2 dz"
  m = l.match(new RegExp(`^(.+?)\\s*[-–:=x×]?\\s*${num}\\s*(${UNIDADE_RE})?\\.?$`, "i"));
  if (m && /[a-zA-ZÀ-ú]/.test(m[1])) {
    const { unidade, fator } = unidadeDe(m[3]);
    return { texto, nome: m[1].replace(/[-–:=x×]\s*$/, "").trim(), quantidade: numero(m[2]) * fator, unidade, temQuantidade: true };
  }
  // "1 molho de rúcula" já caiu no primeiro caso; "rúcula" sem quantidade vira 1
  return { texto, nome: l, quantidade: 1, unidade: null, temQuantidade: false };
}

export interface PrecoLido { texto: string; nome: string; preco: number }

/** Lê uma linha de tabela de preços: o último número com centavos (ou inteiro) é o preço. */
export function lerPreco(linhaBruta: string): PrecoLido | null {
  const texto = linhaBruta.trim();
  const l = limpar(texto).replace(/\t/g, " ; ");
  if (!l || !/[a-zA-ZÀ-ú]/.test(l)) return null;
  const m = l.match(/^(.*?)[\s;|:=-]*(?:r\$\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:\/\s*[a-zA-ZÀ-ú]+)?\s*$/i);
  if (!m || !/[a-zA-ZÀ-ú]/.test(m[1])) return null;
  const nome = m[1].replace(/\s*[;|]\s*(kg|un|dz|ma[cç]o|molho|bandeja)?\s*[;|]?\s*$/i, "").replace(/[\s;|:=-]+$/, "").replace(/\s*r\$\s*$/i, "").trim();
  const preco = parseFloat(m[2].replace(",", "."));
  if (!nome || isNaN(preco)) return null;
  return { texto, nome, preco: Math.round(preco * 100) / 100 };
}

export interface Candidato<P> { produto: P; nota: number }

/** Produtos mais parecidos com o nome, do melhor para o pior (nota de 0 a 1). */
export function casar<P extends ProdutoBase>(nome: string, produtos: P[], max = 6): Candidato<P>[] {
  const alvo = normalizar(nome);
  const q = palavras(nome);
  if (!q.length) return [];
  const bate = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  return produtos.map(produto => {
    const n = normalizar(produto.nome);
    if (n === alvo) return { produto, nota: 1 };
    const p = palavras(produto.nome);
    if (!p.length) return { produto, nota: 0 };
    const comunsQ = q.filter(t => p.some(x => bate(t, x))).length;
    const comunsP = p.filter(t => q.some(x => bate(t, x))).length;
    let nota = (comunsQ / q.length) * 0.65 + (comunsP / p.length) * 0.35;
    if (comunsQ && bate(q[0], p[0])) nota += 0.05;   // mesma primeira palavra
    return { produto, nota: Math.min(nota, 0.99) };
  }).filter(c => c.nota >= 0.45).sort((a, b) => b.nota - a.nota || a.produto.nome.length - b.produto.nome.length).slice(0, max);
}

/** Melhor produto quando a escolha é clara; senão null (o usuário escolhe). */
export function escolhaClara<P>(cands: Candidato<P>[]): P | null {
  if (!cands.length) return null;
  if (cands[0].nota >= 0.99) return cands[0].produto;
  if (cands[0].nota >= 0.7 && (cands.length === 1 || cands[0].nota - cands[1].nota >= 0.12)) return cands[0].produto;
  return null;
}
