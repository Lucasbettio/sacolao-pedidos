import { useEffect, useState, type ReactNode } from "react";
import { FLUXO, STATUS_INFO, type Status } from "../lib/types";

/* Aviso rápido no rodapé */
let push: ((t: string) => void) | null = null;
export function toast(t: string) { push?.(t); }
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    push = (t) => { setMsg(t); clearTimeout(timer); timer = window.setTimeout(() => setMsg(null), 2600); };
    return () => { push = null; };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function StatusPill({ s }: { s: Status }) {
  return <span className={`pill st-${s}`}>{STATUS_INFO[s].rotulo}</span>;
}

/** Barra de progresso do pedido: novo → em preparo → em entrega → entregue */
export function Trilha({ s }: { s: Status }) {
  if (s === "cancelado") return null;
  const ix = FLUXO.indexOf(s);
  return (
    <div>
      <div className="trilha" aria-hidden="true">{FLUXO.map((f, i) => <span key={f} className={i <= ix ? "on" : ""} />)}</div>
      <div className="trilha-rot">{FLUXO.map(f => <span key={f}>{STATUS_INFO[f].rotulo}</span>)}</div>
    </div>
  );
}

export function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="card"><div style={{ display: "flex", alignItems: "center" }}><h2 style={{ fontSize: 22 }}>{titulo}</h2><span className="sp" /><button className="x" onClick={onClose} aria-label="Fechar">✕</button></div>{children}</div>
    </div>
  );
}

export async function copiar(texto: string) {
  try { await navigator.clipboard.writeText(texto); toast("Copiado"); }
  catch { toast("Não foi possível copiar automaticamente"); }
}

export function Carregando() { return <p className="hint" style={{ padding: 24 }}>Carregando…</p>; }
