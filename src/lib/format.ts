export const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const qtd = (v: number | null | undefined) =>
  (Math.round((Number(v) || 0) * 1000) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Aceita "1,5", "1.5", "R$ 3,99". Retorna NaN se vazio/ inválido. */
export function num(s: unknown): number {
  if (typeof s === "number") return s;
  const t = String(s ?? "").trim().replace(/\s|R\$/g, "");
  if (!t) return NaN;
  return parseFloat(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}

const tz = "America/Sao_Paulo";
export const dataCurta = (iso: string) => {
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  return d.toLocaleDateString("pt-BR", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" });
};
export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** yyyy-mm-dd no fuso de Porto Alegre */
export function hojeISO(addDias = 0) {
  const d = new Date(Date.now() + addDias * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

export const doc = (d?: string | null) => {
  const s = (d ?? "").replace(/\D/g, "");
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return d ?? "";
};

export function waLink(telefone: string | null | undefined, texto = "") {
  const d = String(telefone ?? "").replace(/\D/g, "");
  const n = d && d.length <= 11 ? "55" + d : d;
  return `https://wa.me/${n}${texto ? "?text=" + encodeURIComponent(texto) : ""}`;
}

/** Oferta valendo hoje (até a data, inclusive, no horário de Porto Alegre). */
export function emOferta(p: { preco_oferta: number | null; oferta_ate: string | null }) {
  return p.preco_oferta != null && (!p.oferta_ate || p.oferta_ate >= hojeISO());
}
/** Preço que vale hoje: oferta ou preço normal. */
export function precoVigente(p: { preco: number | null; preco_oferta: number | null; oferta_ate: string | null }) {
  return emOferta(p) ? Number(p.preco_oferta) : p.preco != null ? Number(p.preco) : null;
}

export const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
