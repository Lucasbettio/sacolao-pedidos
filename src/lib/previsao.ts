// Previsões simples e explicáveis, baseadas só no histórico de pedidos (por data de entrega).

export interface Mes { mes: string; faturamento: number; pedidos: number; clientes: number }
export interface MesAtual { realizado: number; agendado: number; dia: number; dias_mes: number }
export interface ClienteMensal {
  cliente_id: string; nome: string; total: number; pedidos: number;
  meses: Record<string, number>; ultimo: string; primeiro: string;
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000);

/** Mês atual: entregue até hoje + já agendado, ou o ritmo diário projetado no mês (o que for maior). */
export function projecaoMesAtual(m: MesAtual) {
  const ritmo = m.dia > 0 ? Number(m.realizado) / m.dia : 0;
  const noRitmo = ritmo * m.dias_mes;
  const garantido = Number(m.realizado) + Number(m.agendado);
  return { ritmo, garantido, projecao: Math.max(garantido, noRitmo), confiavel: m.dia >= 7 };
}

/** Próximo mês: média dos últimos 3 meses completos; com 4+ meses, ajusta pela tendência (regressão linear). */
export function previsaoProximoMes(meses: Mes[]) {
  const completos = meses.slice(0, -1).map(m => Number(m.faturamento));
  let i = 0; while (i < completos.length && completos[i] === 0) i++;      // ignora meses antes do início
  // O 1º mês do histórico quase sempre é parcial (começou no meio do mês): descarta quando há 3+ meses
  const hist = completos.slice(i).length >= 3 ? completos.slice(i + 1) : completos.slice(i);
  if (!hist.length) return null;
  const ult3 = hist.slice(-3);
  const base = media(ult3);
  let previsao = base, tendencia: number | null = null;
  const serie = hist.slice(-6);
  if (serie.length >= 4) {
    const n = serie.length, xs = serie.map((_, k) => k), mx = media(xs), my = media(serie);
    const incl = xs.reduce((s, x, k) => s + (x - mx) * (serie[k] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const proximo = my + incl * (n - mx);
    tendencia = my ? incl / my : null;                                    // variação média por mês
    previsao = 0.6 * base + 0.4 * proximo;
  }
  const ultimo = hist[hist.length - 1], anteriores = hist.slice(-4, -1);
  return {
    previsao: Math.max(0, previsao), min: Math.min(...ult3), max: Math.max(...ult3),
    mesesHistorico: hist.length, tendencia,
    variacaoUltimo: anteriores.length && media(anteriores) ? (ultimo - media(anteriores)) / media(anteriores) : null,
  };
}

export interface ResumoCliente extends ClienteMensal {
  media3: number; previsao: number; tendencia: number | null;
  diasSemPedir: number; intervaloMedio: number | null; sumiu: boolean;
}

/** Por cliente: média dos últimos 3 meses completos (desde o 1º pedido), tendência e alerta de quem parou de pedir. */
export function resumoClientes(clientes: ClienteMensal[], meses: string[], hoje: string): ResumoCliente[] {
  const completos = meses.slice(0, -1);
  return clientes.map(c => {
    const desde = c.primeiro.slice(0, 7);
    const validos = completos.filter(m => m >= desde);
    const valores = validos.map(m => Number(c.meses[m] ?? 0));
    const ult3 = valores.slice(-3);
    const media3 = media(ult3);
    const ant = valores.slice(-4, -1);
    const ultimoMes = valores[valores.length - 1];
    const tendencia = valores.length >= 2 && media(ant) > 0 ? (ultimoMes - media(ant)) / media(ant) : null;
    const diasSemPedir = diasEntre(c.ultimo, hoje);
    const intervaloMedio = c.pedidos >= 2 ? diasEntre(c.primeiro, c.ultimo) / (c.pedidos - 1) : null;
    const sumiu = intervaloMedio != null && diasSemPedir > Math.max(14, intervaloMedio * 2);
    return { ...c, media3, previsao: media3, tendencia, diasSemPedir, intervaloMedio, sumiu };
  });
}

export const nomeMes = (mes: string, curto = true) => {
  const [a, m] = mes.split("-").map(Number);
  const s = new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", { month: curto ? "short" : "long", timeZone: "UTC" }).replace(".", "");
  return curto ? `${s}/${String(a).slice(2)}` : `${s} de ${a}`;
};
