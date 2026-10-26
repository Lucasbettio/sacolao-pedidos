import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, msgErro } from "../../lib/supabase";
import { dataCurta, num, slug } from "../../lib/format";
import { UNIDADES, type Produto, type Unidade } from "../../lib/types";
import { Carregando, Icone, Modal, toast } from "../../components/ui";
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


type Estado = "salvando" | "salvo" | "erro";
type Mudar = (patch: Partial<Produto>, aviso?: string, desfazivel?: boolean) => Promise<void>;
const reais = (v: number | null) => (v == null ? "sem preço" : `R$ ${precoTxt(v)}`);

/** Menu "⋯" da linha: ações raras (foto e exclusão) ficam fora do caminho do dia a dia. */
function MenuLinha({ nome, itens }: { nome: string; itens: { rotulo: string; fn: () => void; perigo?: boolean }[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    caixa.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setAberto(false); caixa.current?.querySelector<HTMLButtonElement>(".menu-btn")?.focus(); } };
    document.addEventListener("mousedown", fora); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  return (
    <div className="menu-linha" ref={caixa}>
      <button type="button" className="menu-btn" aria-haspopup="menu" aria-expanded={aberto} aria-label={`Mais opções de ${nome}`} onClick={() => setAberto(v => !v)}>
        <Icone nome="mais" />
      </button>
      {aberto && (
        <div className="menu-lista" role="menu" aria-label={`Opções de ${nome}`}>
          {itens.map(i => (
            <button key={i.rotulo} type="button" role="menuitem" className={i.perigo ? "perigo" : undefined} onClick={() => { setAberto(false); i.fn(); }}>{i.rotulo}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Campo de preço: salva ao sair do campo ou apertar Enter; Esc desfaz o que foi digitado.
 * Mudança grande (mais de 50% para cima ou para baixo) pede confirmação antes de ir para o catálogo.
 */
function CampoPreco({ p, onSalvar }: { p: Produto; onSalvar: (v: number | null) => Promise<void> }) {
  const atual = p.preco == null ? null : Number(p.preco);
  const [txt, setTxt] = useState(precoTxt(atual));
  const [pendente, setPendente] = useState<{ v: number } | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const cancelado = useRef(false);
  useEffect(() => { setTxt(precoTxt(atual)); setPendente(null); }, [atual]);

  const salvar = async () => {
    if (cancelado.current) { cancelado.current = false; return; }
    const v = num(txt);
    const novo = txt.trim() === "" ? null : isNaN(v) || v < 0 ? undefined : Math.round(v * 100) / 100;
    if (novo === undefined) { toast(`Preço inválido em ${p.nome}. Use só números, por exemplo 5,99.`); setTxt(precoTxt(atual)); return; }
    if (novo === atual) { setTxt(precoTxt(novo)); setPendente(null); return; }
    if (novo != null && atual != null && atual > 0 && (novo / atual > 1.5 || novo / atual < 2 / 3)) { setPendente({ v: novo }); return; }
    setPendente(null);
    await onSalvar(novo);
  };
  const desfazer = () => { setTxt(precoTxt(atual)); setPendente(null); };

  return (
    <div className="preco-cel">
      <span className="preco-linha">
        <span className="hint">R$</span>
        <input ref={campo} className="inp tnum preco-inp" id={`preco-${p.id}`} inputMode="decimal"
          value={txt} placeholder="—" aria-label={`Preço de ${p.nome}`} aria-invalid={pendente ? true : undefined}
          onChange={e => { setTxt(e.target.value); setPendente(null); }} onBlur={salvar}
          onKeyDown={e => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") { cancelado.current = true; desfazer(); (e.target as HTMLInputElement).blur(); }
          }} />
        <span className="hint">/{p.unidade}</span>
      </span>
      {pendente && (
        <div className="confirma" role="alert">
          <span>De <b className="tnum">{reais(atual)}</b> para <b className="tnum">{reais(pendente.v)}</b>?</span>
          <button type="button" className="btn sm" onClick={() => { const v = pendente.v; setPendente(null); onSalvar(v); }}>Confirmar</button>
          <button type="button" className="btn ghost sm" onClick={() => { setPendente(null); campo.current?.focus(); campo.current?.select(); }}>Corrigir</button>
        </div>
      )}
    </div>
  );
}

function LinhaProduto({ p, estado, mudar, onExcluir }: { p: Produto; estado?: Estado; mudar: Mudar; onExcluir: () => void }) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviarFoto(f?: File) {
    if (!f) return;
    setEnviando(true);
    try {
      const blob = await reduzir(f);
      const caminho = `${p.id}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("produtos").upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      const antigo = caminhoNoStorage(p.imagem_url);
      await mudar({ imagem_url: supabase.storage.from("produtos").getPublicUrl(caminho).data.publicUrl }, `${p.nome}: foto salva`);
      if (antigo) await supabase.storage.from("produtos").remove([antigo]);
    } catch (e) { toast(msgErro(e)); }
    finally { setEnviando(false); }
  }
  async function removerFoto() {
    const antigo = caminhoNoStorage(p.imagem_url);
    await mudar({ imagem_url: null }, `${p.nome}: foto removida`);
    if (antigo) await supabase.storage.from("produtos").remove([antigo]);
  }
  const escolherFoto = () => arquivo.current?.click();

  return (
    <tr className={p.ativo ? undefined : "fora"}>
      <td className="c-nome">
        <div className="prod-cel">
          <button type="button" className={`thumb-btn${p.imagem_url ? " tem" : ""}`} onClick={escolherFoto} disabled={enviando} aria-busy={enviando || undefined}
            aria-label={`${p.imagem_url ? "Trocar" : "Enviar"} foto de ${p.nome}`} title={p.imagem_url ? "Trocar foto" : "Enviar foto"}>
            {p.imagem_url ? <img src={p.imagem_url} alt="" /> : <Icone nome="camera" />}
          </button>
          <input ref={arquivo} type="file" accept="image/*" hidden onChange={e => { enviarFoto(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="nome-bloco">
            <b className="nome-txt">{p.nome}</b>
            <div className="meta-linha">
              <span className="cat-m">{p.categoria}</span>
              {p.preco_em && <span>preço de {dataCurta(p.preco_em)}</span>}
              {enviando && <span className="estado">Enviando foto…</span>}
              {estado === "salvando" && <span className="estado">Salvando…</span>}
              {estado === "salvo" && <span className="estado salvo"><Icone nome="ok" tam={14} />Salvo</span>}
              {estado === "erro" && <span className="estado erro">Não salvou</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="c-preco">
        <CampoPreco p={p} onSalvar={v => mudar({ preco: v }, `${p.nome}: ${reais(p.preco == null ? null : Number(p.preco))} → ${reais(v)}`, true)} />
      </td>
      <td className="c-venda">
        <label className="switch">
          <input type="checkbox" role="switch" checked={p.ativo}
            onChange={e => mudar({ ativo: e.target.checked }, e.target.checked ? `${p.nome} voltou à venda` : `${p.nome} marcado como Fora`, true)} />
          <span className="trilho" aria-hidden="true" />
          <span className="rot"><span className="sr">{p.nome}: </span>{p.ativo ? "À venda" : "Fora"}</span>
        </label>
      </td>
      <td className="c-un">
        <select className="unit" value={p.unidade} aria-label={`Unidade de ${p.nome}`}
          onChange={e => { const u = e.target.value as Unidade; mudar({ unidade: u }, `${p.nome} agora é vendido por ${u}; o preço vale por ${u}`, true); }}>
          {UNIDADES.map(u => <option key={u}>{u}</option>)}
        </select>
      </td>
      <td className="c-porun">
        {p.unidade === "kg" ? (
          <label className="pilula" title="O cliente pode pedir em unidades; o peso é conferido na separação">
            <input type="checkbox" checked={p.aceita_unidade}
              onChange={e => mudar({ aceita_unidade: e.target.checked }, e.target.checked ? `${p.nome}: aceita pedido por unidade` : `${p.nome}: só por kg`, true)} />
            <span className="marca" aria-hidden="true"><Icone nome="ok" tam={12} /></span>
            <span><span className="sr">{p.nome}: </span><span className="txt-longo">Também </span>por un</span>
          </label>
        ) : <span className="hint" aria-label="Não se aplica">—</span>}
      </td>
      <td className="c-cat">{p.categoria}</td>
      <td className="c-menu">
        <MenuLinha nome={p.nome} itens={[
          { rotulo: p.imagem_url ? "Trocar foto" : "Enviar foto", fn: escolherFoto },
          ...(p.imagem_url ? [{ rotulo: "Remover foto", fn: removerFoto }] : []),
          { rotulo: "Excluir produto…", fn: onExcluir, perigo: true },
        ]} />
      </td>
    </tr>
  );
}

export default function Produtos() {
  const [lista, setLista] = useState<Produto[] | null>(null);
  const [busca, setBusca] = useState("");
  const [soSemPreco, setSoSemPreco] = useState(false);
  const [novo, setNovo] = useState({ nome: "", categoria: "Frutas", unidade: "kg" as Unidade, preco: "" });
  const [erroNovo, setErroNovo] = useState("");
  const [excluindo, setExcluindo] = useState<Produto | null>(null);
  const [estados, setEstados] = useState<Record<number, Estado>>({});
  const timers = useRef<Record<number, number>>({});

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("produtos").select("*").order("categoria").order("ordem").order("nome");
    if (error) toast(msgErro(error));
    setLista((data as Produto[]) ?? []);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  const categorias = useMemo(() => [...new Set((lista ?? []).map(p => p.categoria))].sort((a, b) => a.localeCompare(b, "pt-BR")), [lista]);
  const filtrados = useMemo(() => (lista ?? []).filter(p => (!busca || slug(p.nome + " " + p.categoria).includes(slug(busca))) && (!soSemPreco || (p.ativo && p.preco == null))), [lista, busca, soSemPreco]);
  const { ordenados: vis, ord, alternar } = useOrdenacao(filtrados, {
    nome: p => p.nome, categoria: p => `${p.categoria} | ${p.nome}`, unidade: p => p.unidade,
    preco: p => (p.preco == null ? null : Number(p.preco)), ativo: p => (p.ativo ? 0 : 1),
    foto: p => (p.imagem_url ? 0 : 1),
  }, { chave: "nome", dir: "asc" }, "produtos");
  if (!lista) return <Carregando />;

  const semPreco = lista.filter(p => p.ativo && p.preco == null).length;

  function marcar(id: number, e?: Estado) {
    clearTimeout(timers.current[id]);
    setEstados(s => { const n = { ...s }; if (e) n[id] = e; else delete n[id]; return n; });
    if (e === "salvo") timers.current[id] = window.setTimeout(() => marcar(id), 2500);
  }
  /** Salva a mudança na hora (o catálogo do cliente já vê) e, se `desfazivel`, oferece Desfazer no aviso. */
  async function muda(p: Produto, patch: Partial<Produto>, aviso?: string, desfazivel?: boolean) {
    const antes = Object.fromEntries(Object.keys(patch).map(k => [k, p[k as keyof Produto]])) as Partial<Produto>;
    marcar(p.id, "salvando");
    setLista(l => l!.map(x => (x.id === p.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("produtos").update(patch).eq("id", p.id);
    if (error) { marcar(p.id, "erro"); toast(`${p.nome}: não foi possível salvar. ${msgErro(error)}`); carregar(); return; }
    marcar(p.id, "salvo");
    if (aviso) toast(aviso, desfazivel ? { rotulo: "Desfazer", fn: () => { muda({ ...p, ...patch }, antes, `${p.nome}: desfeito`); } } : undefined);
  }
  async function adicionar() {
    const nome = novo.nome.trim();
    const preco = num(novo.preco);
    if (!nome) { setErroNovo("Digite o nome do produto."); document.getElementById("np-nome")?.focus(); return; }
    if (novo.preco.trim() && (isNaN(preco) || preco < 0)) {
      setErroNovo("Preço inválido. Use só números, por exemplo 5,99. Deixe vazio para cadastrar sem preço."); document.getElementById("np-preco")?.focus(); return;
    }
    if (lista!.some(p => slug(p.nome) === slug(nome))) { setErroNovo(`Já existe um produto chamado “${nome}”. Busque por ele na lista.`); return; }
    setErroNovo("");
    const ordem = Math.max(0, ...lista!.filter(p => p.categoria === novo.categoria).map(p => p.ordem)) + 10;
    const { error } = await supabase.from("produtos").insert({
      nome, categoria: novo.categoria.trim() || "Outros", unidade: novo.unidade, ordem,
      preco: isNaN(preco) ? null : Math.round(preco * 100) / 100,
    });
    if (error) { setErroNovo(/duplicate/.test(error.message) ? "Já existe um produto com esse nome." : msgErro(error)); return; }
    setNovo(n => ({ ...n, nome: "", preco: "" })); toast("Produto incluído"); carregar();
  }

  return (
    <>
      <div className="ptitle"><h1>Produtos</h1><span className="hint tnum">{lista.filter(p => p.ativo).length} à venda</span></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <span className="lbl">Novo produto</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input className="inp" style={{ flex: "2 1 200px" }} id="np-nome" placeholder="Nome (ex.: Mexerica ponkan)" value={novo.nome} onChange={e => { setErroNovo(""); setNovo(n => ({ ...n, nome: e.target.value })); }} onKeyDown={e => e.key === "Enter" && adicionar()} />
          <input className="inp" style={{ flex: "1 1 140px" }} id="np-cat" list="cats" placeholder="Categoria" value={novo.categoria} onChange={e => setNovo(n => ({ ...n, categoria: e.target.value }))} />
          <datalist id="cats">{categorias.map(c => <option key={c} value={c} />)}</datalist>
          <select className="inp" style={{ flex: "0 1 110px" }} id="np-un" value={novo.unidade} onChange={e => setNovo(n => ({ ...n, unidade: e.target.value as Unidade }))}>{UNIDADES.map(u => <option key={u}>{u}</option>)}</select>
          <input className="inp tnum" style={{ flex: "0 1 110px" }} id="np-preco" placeholder="Preço R$" inputMode="decimal" value={novo.preco} onChange={e => { setErroNovo(""); setNovo(n => ({ ...n, preco: e.target.value })); }} onKeyDown={e => e.key === "Enter" && adicionar()} />
          <button className="btn" onClick={adicionar}>Incluir</button>
        </div>
        {erroNovo && <p className="erro" role="alert" style={{ margin: "8px 0 0" }}>{erroNovo}</p>}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div className="search" style={{ flex: "1 1 260px", maxWidth: 420 }}>
          <input id="busca-prod" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" />
        </div>
        {semPreco > 0 && <button className="chip" aria-pressed={soSemPreco} onClick={() => setSoSemPreco(v => !v)}>Sem preço · {semPreco}</button>}
      </div>
      <div className="card" style={{ padding: 0 }}><table className="t prods">
        <thead><tr>
          <Th chave="nome" ord={ord} alternar={alternar} style={{ paddingLeft: 16 }}>Produto</Th>
          <Th chave="preco" ord={ord} alternar={alternar}>Preço</Th>
          <Th chave="ativo" ord={ord} alternar={alternar}>À venda</Th>
          <Th chave="unidade" ord={ord} alternar={alternar}>Unidade</Th>
          <th title="Produtos por kg que o cliente também pode pedir em unidades">Por unidade</th>
          <Th chave="categoria" ord={ord} alternar={alternar} classe="c-cat">Categoria</Th>
          <th><span className="sr">Mais opções</span></th>
        </tr></thead>
        <tbody>{vis.map(p => (
          <LinhaProduto key={p.id} p={p} estado={estados[p.id]}
            mudar={(patch, aviso, desfazivel) => muda(p, patch, aviso, desfazivel)} onExcluir={() => setExcluindo(p)} />
        ))}</tbody>
      </table>
      {vis.length === 0 && <p className="empty" style={{ margin: 0 }}>{lista.length ? "Nenhum produto encontrado." : "Nenhum produto cadastrado ainda."}</p>}
      </div>
      {excluindo && <ExcluirProduto p={excluindo} onClose={() => setExcluindo(null)}
        onFora={async () => { await muda(excluindo, { ativo: false }, `${excluindo.nome} marcado como Fora`, true); setExcluindo(null); }}
        onExcluido={() => { setExcluindo(null); carregar(); }} />}
      <p className="hint">O preço aparece no catálogo do cliente e já entra no pedido. Pedidos feitos antes de uma mudança de preço continuam com o valor da época. Produto sem preço aparece como “preço a confirmar”. Itens por quilo pedidos por unidade também ficam a confirmar.</p>
    </>
  );
}

/** Janela de confirmação para excluir produto. Mostra em quantos pedidos ele aparece. */
function ExcluirProduto({ p, onClose, onFora, onExcluido }: { p: Produto; onClose: () => void; onFora: () => void; onExcluido: () => void }) {
  const [usos, setUsos] = useState<number | null>(null);
  const [apagando, setApagando] = useState(false);
  useEffect(() => {
    supabase.from("pedido_itens").select("id", { count: "exact", head: true }).eq("produto_id", p.id)
      .then(({ count }) => setUsos(count ?? 0));
  }, [p.id]);
  async function excluir() {
    setApagando(true);
    const { error } = await supabase.from("produtos").delete().eq("id", p.id);
    if (error) { setApagando(false); toast(msgErro(error)); return; }
    const foto = caminhoNoStorage(p.imagem_url);
    if (foto) await supabase.storage.from("produtos").remove([foto]);
    toast(`“${p.nome}” excluído`); onExcluido();
  }
  return (
    <Modal titulo="Excluir produto" onClose={onClose}>
      <p style={{ margin: 0 }}>Excluir <b>“{p.nome}”</b> do catálogo? Essa ação não pode ser desfeita.</p>
      {usos == null ? <p className="hint" style={{ margin: 0 }}>Verificando pedidos…</p> : usos > 0 ? (
        <p className="endbox" style={{ margin: 0, background: "var(--amber-soft)" }}>
          Ele aparece em <b>{usos} {usos === 1 ? "item de pedido" : "itens de pedidos"}</b>. Esses pedidos continuam com o nome, a quantidade e o preço, só perdem o vínculo com o catálogo.
          {p.ativo && " Se pode voltar a vender, prefira marcar como Fora: ele some do catálogo e continua cadastrado."}
        </p>) : <p className="hint" style={{ margin: 0 }}>Ele não aparece em nenhum pedido.</p>}
      <div className="acoes" style={{ marginTop: 0 }}>
        <button className="btn red" disabled={apagando || usos == null} onClick={excluir}>{apagando ? "Excluindo…" : "Excluir produto"}</button>
        {p.ativo && !!usos && <button className="btn ghost" onClick={onFora}>Marcar como Fora</button>}
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
