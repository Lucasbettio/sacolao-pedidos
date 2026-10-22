export type Status = "recebido" | "aprovado" | "preparando" | "em_entrega" | "entregue" | "cancelado";
export type Unidade = "kg" | "un" | "maço" | "dúzia" | "bandeja";
export const UNIDADES: Unidade[] = ["kg", "un", "maço", "dúzia", "bandeja"];

export const STATUS_INFO: Record<Status, { rotulo: string; cliente: string }> = {
  recebido:   { rotulo: "Recebido",    cliente: "Recebemos seu pedido. Vamos conferir e aprovar." },
  aprovado:   { rotulo: "Aprovado",    cliente: "Pedido aprovado, com os preços do dia." },
  preparando: { rotulo: "Preparando",  cliente: "Estamos separando seus produtos." },
  em_entrega: { rotulo: "Em entrega",  cliente: "Saiu para entrega." },
  entregue:   { rotulo: "Entregue",    cliente: "Pedido entregue." },
  cancelado:  { rotulo: "Cancelado",   cliente: "Pedido cancelado." },
};
/** Ordem do fluxo principal (cancelado fica fora). */
export const FLUXO: Status[] = ["recebido", "aprovado", "preparando", "em_entrega", "entregue"];

export interface Cliente {
  id: string; user_id: string | null; usuario: string; nome: string; nome_fantasia: string | null;
  documento: string | null; telefone: string | null; email_contato: string | null;
  endereco: string | null; bairro: string | null; complemento: string | null; cidade: string | null;
  cep: string | null; observacoes: string | null; ativo: boolean; created_at: string;
}
export interface Produto {
  id: number; nome: string; categoria: string; unidade: Unidade; aceita_unidade: boolean;
  ativo: boolean; ordem: number; ultimo_preco: number | null; preco_em: string | null;
}
export interface PedidoResumo {
  id: string; numero: number; cliente_id: string; status: Status; entrega_data: string;
  entrega_turno: string; endereco_entrega: string; pagamento: string; aceita_substituicao: boolean;
  observacoes: string | null; taxa_entrega: number; desconto: number; nota_admin: string | null;
  created_at: string; updated_at: string; aprovado_em: string | null; entregue_em: string | null;
  cliente_nome: string; cliente_fantasia: string | null; cliente_telefone: string | null;
  itens: number; itens_sem_preco: number; subtotal: number; total: number;
}
export interface Item {
  id: number; pedido_id: string; produto_id: number | null; nome: string; quantidade: number;
  unidade: Unidade; quantidade_final: number | null; preco_unitario: number | null; em_falta: boolean;
}
export interface Evento { id: number; pedido_id: string; status: Status; created_at: string }
