import { useEffect, useState, type ReactNode } from "react";
import { FLUXO, STATUS_INFO, type Status } from "../lib/types";

/* Aviso rápido no rodapé. Com `acao`, mostra um botão (ex.: Desfazer) e fica mais tempo na tela. */
export interface AcaoToast { rotulo: string; fn: () => void }
interface Aviso { texto: string; acao?: AcaoToast }
let push: ((a: Aviso) => void) | null = null;
export function toast(texto: string, acao?: AcaoToast) { push?.({ texto, acao }); }
export function Toaster() {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    push = (a) => { setAviso(a); clearTimeout(timer); timer = window.setTimeout(() => setAviso(null), a.acao ? 7000 : 2600); };
    return () => { push = null; clearTimeout(timer); };
  }, []);
  if (!aviso) return null;
  return (
    <div className="toast" role="status">
      <span>{aviso.texto}</span>
      {aviso.acao && <button type="button" className="toast-acao" onClick={() => { aviso.acao!.fn(); setAviso(null); }}>{aviso.acao.rotulo}</button>}
    </div>
  );
}

/** Ícones desenhados (traço 2px, 20×20). */
const ICONES = {
  camera: <><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h2.2l1.3-2h4l1.3 2h2.2A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" /><circle cx="10" cy="11" r="3" /></>,
  mais: <><circle cx="4.5" cy="10" r="1.2" fill="currentColor" stroke="none" /><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none" /><circle cx="15.5" cy="10" r="1.2" fill="currentColor" stroke="none" /></>,
  ok: <path d="M4.5 10.5 8 14l7.5-8" />,
};
export function Icone({ nome, tam = 18 }: { nome: keyof typeof ICONES; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICONES[nome]}
    </svg>
  );
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
