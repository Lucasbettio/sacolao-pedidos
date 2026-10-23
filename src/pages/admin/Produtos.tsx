import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { dataCurta, num, slug } from "../../lib/format";
import { UNIDADES, type Produto, type Unidade } from "../../lib/types";
import { Carregando, toast } from "../../components/ui";
import { Th, useOrdenacao } from "../../components/Ordenacao";

const precoTxt = (v: number | null) => (v != null ? Number(v).toFixed(2).replace(".", ",") : "");

/** Reduz a foto para no máximo 600px (JPEG) antes de enviar. */
async function reduzir(arquivo: File): Promise<Blob> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.min(1, 600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((ok, falha) => c.toBlob(b => (b ? ok(b) : falha(new Error("Não foi possível ler a imagem"))), "image/jpeg", 0.82));
}
const caminhoNoStorage = (url: string | null) => (url && url.includes("/produtos/") ? url.split("/produtos/").pop()!.split("?")[0] : null);

function FotoProduto({ p, onMudar }: { p: Produto; onMudar: (url: string | null) => Promise<void> }) {
  const [enviando, setEnviando] = useState(false);
  async function enviar(arquivo?: File) {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const blob = await reduzir(arquivo);
      const caminho = `${p.id}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("produtos").upload(caminho, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      const antigo = caminhoNoStorage(p.imagem_url);
      await onMudar(supabase.storage.from("produtos").getPublicUrl(caminho).data.publicUrl);
      if (antigo) await supabase.storage.from("produtos").remove([antigo]);
    } catch (e) { toast(msgErro(e)); }
    finally { setEnviando(false); }
  }
  async function remover() {
    const antigo = caminhoNoStorage(p.imagem_url);
    await onMudar(null);
    if (antigo) await supabase.storage.from("produtos").remove([antigo]);
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {p.imagem_url ? <img className="thumb" src={p.imagem_url} alt="" /> : <span className="thumb vazia">sem foto</span>}
      <label className="btn ghost sm" style={{ cursor: "pointer" }}>
        {enviando ? "Enviando…" : p.imagem_url ? "Trocar" : "Enviar"}
        <input type="file" accept="image/*" hidden disabled={enviando} onChange={e => { enviar(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {p.imagem_url && !enviando && <button className="x" onClick={remover} aria-label={`Remover foto de ${p.nome}`}>✕</button>}
    </span>
  );
}

/** Campo de preço que salva ao sair do campo ou apertar Enter. */
function CampoPreco({ p, onSalvar }: { p: Produto; onSalvar: (v: number | null) => Promise<void> }) {
  const [txt, setTxt] = useState(precoTxt(p.preco));
  useEffect(() => setTxt(precoTxt(p.preco)), [p.preco]);
  const salvar = async () => {
    const v = num(txt);
    const novo = txt.trim() === "" ? null : isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100;
    if (novo === undefined) { toast("Preço inválido"); setTxt(precoTxt(p.preco)); return; }
    if (novo === (p.preco == null ? null : Number(p.preco))) { setTxt(precoTxt(novo)); return; }
    await onSalvar(novo);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span className="hint">R$</span>
      <input className="inp tnum" style={{ width: 88, textAlign: "right", padding: "6px 8px" }} id={`preco-${p.id}`} inputMode="decimal"
        value={txt} placeholder="—" aria-label={`Preço de ${p.nome}`}
        onChange={e => setTxt(e.target.value)} onBlur={salvar} onKeyDown={e => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <span className="hint">/{p.unidade}</span>
    </span>
  );
}

export default function Produtos() {
  const [lista, setLista] = useState<Produto[] | null>(null);
  const [busca, setBusca] = useState("");
  const [soSemPreco, setSoSemPreco] = useState(false);
  const [novo, setNovo] = useState({ nome: "", categoria: "Frutas", unidade: "kg" as Unidade, preco: "" });

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("produtos").select("*").order("categoria").order("ordem").order("nome");
    if (error) toast(msgErro(error));
    setLista((data as Produto[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const categorias = useMemo(() => [...new Set((lista ?? []).map(p => p.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")), [lista]);
  const filtrados = useMemo(() => (lista ?? []).filter(p => (!busca || slug(p.nome + " " + p.categoria).includes(slug(busca))) && (!soSemPreco || (p.ativo && p.preco == null))), [lista, busca, soSemPreco]);
  const { ordenados: vis, ord, alternar } = useOrdenacao(filtrados, {
    nome: p => p.nome, categoria: p => `${p.categoria} | ${p.nome}`, unidade: p => p.unidade,
    preco: p => (p.preco == null ? null : Number(p.preco)), ativo: p => (p.ativo ? 0 : 1),
    foto: p => (p.imagem_url ? 0 : 1),
  }, { chave: "nome", dir: "asc" }, "produtos");
  if (!lista) return <Carregando />;

  const semPreco = lista.filter(p => p.ativo && p.preco == null).length;

  async function muda(p: Produto, patch: Partial<Produto>, aviso?: string) {
    setLista(l => l!.map(x => (x.id === p.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("produtos").update(patch).eq("id", p.id);
    if (error) { toast(msgErro(error)); carregar(); } else if (aviso) toast(aviso);
  }
  async function adicionar() {
    if (!novo.nome.trim()) return;
    const ordem = Math.max(0, ...lista!.filter(p => p.categoria === novo.categoria).map(p => p.ordem)) + 10;
    const preco = num(novo.preco);
    const { error } = await supabase.from("produtos").insert({
      nome: novo.nome.trim(), categoria: novo.categoria.trim() || "Outros", unidade: novo.unidade, ordem,
      preco: isNaN(preco) ? null : Math.round(preco * 100) / 100,
    });
    if (error) { toast(/duplicate/.test(error.message) ? "Já existe um produto com esse nome." : msgErro(error)); return; }
    setNovo(n => ({ ...n, nome: "", preco: "" })); toast("Produto incluído"); carregar();
  }

  return (
    <>
      <div className="ptitle"><h1>Produtos</h1><span className="hint tnum">{lista.filter(p => p.ativo).length} à venda</span></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <span className="lbl">Novo produto</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input className="inp" style={{ flex: "2 1 200px" }} id="np-nome" placeholder="Nome (ex.: Mexerica ponkan)" value={novo.nome} onChange={e => setNovo(n => ({ ...n, nome: e.target.value }))} onKeyDown={e => e.key === "Enter" && adicionar()} />
          <input className="inp" style={{ flex: "1 1 140px" }} id="np-cat" list="cats" placeholder="Categoria" value={novo.categoria} onChange={e => setNovo(n => ({ ...n, categoria: e.target.value }))} />
          <datalist id="cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          <select className="inp" style={{ flex: "0 1 110px" }} id="np-un" value={novo.unidade} onChange={e => setNovo(n => ({ ...n, unidade: e.target.value as Unidade }))}>{UNIDADES.map(u => <option key={u}>{u}</option>)}</select>
          <input className="inp tnum" style={{ flex: "0 1 110px" }} id="np-preco" placeholder="Preço R$" inputMode="decimal" value={novo.preco} onChange={e => setNovo(n => ({ ...n, preco: e.target.value }))} onKeyDown={e => e.key === "Enter" && adicionar()} />
          <button className="btn" onClick={adicionar}>Incluir</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div className="search" style={{ flex: "1 1 260px", maxWidth: 420 }}>
          <input id="busca-prod" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" />
        </div>
        {semPreco > 0 && <button className="chip" aria-pressed={soSemPreco} onClick={() => setSoSemPreco(v => !v)}>Sem preço · {semPreco}</button>}
      </div>
      <div className="card" style={{ padding: 0 }}><div className="tablewrap" style={{ margin: 0 }}><table className="t" style={{ minWidth: 960 }}>
        <thead><tr>
          <Th chave="foto" ord={ord} alternar={alternar} style={{ paddingLeft: 16 }}>Foto</Th>
          <Th chave="nome" ord={ord} alternar={alternar}>Produto</Th>
          <Th chave="categoria" ord={ord} alternar={alternar}>Categoria</Th>
          <Th chave="unidade" ord={ord} alternar={alternar}>Unidade</Th>
          <Th chave="preco" ord={ord} alternar={alternar}>Preço</Th>
          <th>Também por unidade</th>
          <Th chave="ativo" ord={ord} alternar={alternar}>À venda</Th></tr></thead>
        <tbody>{vis.map(p => (
          <tr key={p.id} style={p.ativo ? undefined : { opacity: .55 }}>
            <td style={{ paddingLeft: 16 }}><FotoProduto p={p} onMudar={url => muda(p, { imagem_url: url }, url ? "Foto salva" : "Foto removida")} /></td>
            <td><b>{p.nome}</b>{p.preco_em && <div className="hint">preço de {dataCurta(p.preco_em)}</div>}</td>
            <td>{p.categoria}</td>
            <td><select className="unit" value={p.unidade} onChange={e => muda(p, { unidade: e.target.value as Unidade })} aria-label="Unidade">{UNIDADES.map(u => <option key={u}>{u}</option>)}</select></td>
            <td><CampoPreco p={p} onSalvar={v => muda(p, { preco: v }, v == null ? `${p.nome}: sem preço` : `${p.nome}: preço salvo`)} /></td>
            <td>{p.unidade === "kg" ? <input type="checkbox" checked={p.aceita_unidade} onChange={e => muda(p, { aceita_unidade: e.target.checked })} aria-label="Aceita pedido por unidade" /> : <span className="hint">—</span>}</td>
            <td><label className="check"><input type="checkbox" checked={p.ativo} onChange={e => muda(p, { ativo: e.target.checked })} /> {p.ativo ? "Sim" : "Fora"}</label></td>
          </tr>))}</tbody>
      </table></div></div>
      <p className="hint">O preço aparece no catálogo do cliente e já entra no pedido. Pedidos feitos antes de uma mudança de preço continuam com o valor da época. Produto sem preço aparece como “preço a confirmar”. Itens por quilo pedidos por unidade também ficam a confirmar.</p>
    </>
  );
}
