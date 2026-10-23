import { supabase } from "./supabase";
import { STATUS_INFO, type Item, type PedidoResumo } from "./types";

/** Busca os itens de vários pedidos (em blocos, para não estourar a URL). */
export async function itensDosPedidos(ids: string[]): Promise<Item[]> {
  const todos: Item[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await supabase.from("pedido_itens").select("*").in("pedido_id", ids.slice(i, i + 80)).order("id");
    if (error) throw error;
    todos.push(...((data as Item[]) ?? []));
  }
  return todos;
}

const n2 = (v: number | null | undefined, casas = 2) => (v == null ? "" : Number(v).toFixed(casas).replace(".", ","));
const cel = (v: unknown) => {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Planilha (CSV para Excel em português): uma linha por item de pedido. */
export async function exportarPedidosCSV(pedidos: PedidoResumo[], nomeArquivo: string) {
  const itens = await itensDosPedidos(pedidos.map(p => p.id));
  const porPedido = new Map<string, Item[]>();
  itens.forEach(i => porPedido.set(i.pedido_id, [...(porPedido.get(i.pedido_id) ?? []), i]));
  const linhas: unknown[][] = [[
    "Pedido", "Feito em", "Entrega", "Turno", "Situação", "Cliente", "Telefone", "Endereço",
    "Produto", "Qtd pedida", "Unidade", "Qtd separada", "Em falta", "Preço unit.", "Subtotal item",
    "Taxa entrega", "Desconto", "Total pedido",
  ]];
  for (const p of pedidos) {
    for (const i of porPedido.get(p.id) ?? []) {
      const q = i.quantidade_final ?? i.quantidade;
      linhas.push([
        p.numero, new Date(p.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        p.entrega_data.split("-").reverse().join("/"), p.entrega_turno, STATUS_INFO[p.status].rotulo,
        p.cliente_fantasia || p.cliente_nome, p.cliente_telefone ?? "", p.endereco_entrega,
        i.nome, n2(i.quantidade, 3), i.unidade, i.quantidade_final != null ? n2(i.quantidade_final, 3) : "",
        i.em_falta ? "sim" : "", n2(i.preco_unitario),
        i.em_falta || i.preco_unitario == null ? "" : n2(Number(q) * Number(i.preco_unitario)),
        n2(p.taxa_entrega), n2(p.desconto), n2(p.total),
      ]);
    }
  }
  const csv = "﻿" + linhas.map(l => l.map(cel).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nomeArquivo; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Guarda a seleção de pedidos para a página de impressão. */
export function prepararImpressao(ids: string[]) {
  try { sessionStorage.setItem("sacolao_imprimir", JSON.stringify(ids)); } catch { /* sem armazenamento */ }
}
export function lerImpressao(): string[] {
  try { return JSON.parse(sessionStorage.getItem("sacolao_imprimir") || "[]"); } catch { return []; }
}
