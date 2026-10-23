# Sacolão da Chácara · Sistema de pedidos

Clientes cadastrados entram com usuário e senha, montam o pedido e enviam. A loja recebe na hora no painel, confere, lança os preços do dia e avança a situação até a entrega.

- **Cliente:** catálogo por categoria (kg, unidade, maço, dúzia, bandeja), item fora da lista, endereço do cadastro já preenchido, dia e turno de entrega, acompanhamento do pedido, repetir pedido anterior, cancelar enquanto não foi aprovado.
- **Admin (pai e dindo):** pedidos chegando em tempo real, edição de itens (peso separado, preço, em falta), taxa e desconto, recado ao cliente. Fluxo **Novo → Em preparo → Em entrega → Entregue** (ou Cancelado), com histórico.
- **Preços:** cadastrados na tela Produtos; aparecem no catálogo e já entram no pedido (total estimado; o peso separado ajusta o valor final).
- **Lista da Ceasa:** soma os itens de todos os pedidos por data de entrega, agrupados por categoria, com marcação do que já foi comprado, cópia para WhatsApp e impressão.
- **Visão do cliente:** prévia do catálogo como o cliente vê, sem enviar pedido.
- **Colar lista:** o cliente cola a lista do WhatsApp ("2 kg tomate", "3 alface", "1 dz ovos") e o sistema encontra os produtos; quando há mais de um parecido, ele escolhe.
- **Preços de hoje:** colar a tabela de preços inteira (WhatsApp, planilha) e conferir antes de salvar, ou editar rápido por categoria.
- **Ofertas do dia:** preço promocional com data de validade, em destaque no topo do catálogo e já aplicado no pedido.
- **Conferência no preparo:** ✓ (separado) e ✗ (em falta) em cada item, com contador e "marcar o resto como separado".
- **Histórico de preços:** toda mudança de preço fica registrada (base para variação e comparação com a Ceasa).
- **Fotos:** envio de foto por produto na tela Produtos (reduzida para 600px antes de subir).
- **Impressão:** pedido com preços (para entregar, com assinatura) ou lista de separação (sem valores, para anotar peso); um pedido ou todos do filtro, um por página. **Exportar planilha** gera CSV para Excel.
- **Análises:** faturamento por dia, ticket médio, produtos e clientes que mais compram, pedidos por dia da semana e itens que mais faltaram.
- **Cadastro:** clientes e produtos. Só quem o admin cadastra tem acesso; dá para bloquear e trocar senha.

Stack: React + Vite no front, Supabase (Postgres, login e permissões por linha) no back. Os dois têm plano gratuito suficiente para uma fruteira.

---

## Instalação (uns 30 minutos, uma vez)

### 1. Supabase
1. Crie uma conta em supabase.com e um projeto novo. Região **South America (São Paulo)**.
2. **SQL Editor** → cole e rode, nesta ordem: `supabase/migrations/0001_init.sql`, `0002_produtos_iniciais.sql`, `0003_precos_fluxo_ceasa.sql`, `0004_catalogo_loja.sql`, `0005_fotos_produtos.sql` e `0006_ofertas_historico.sql`.
3. **Authentication → Sign In / Providers**:
   - desligue **Allow new users to sign up** (ninguém se cadastra sozinho);
   - em **Email**, desligue **Confirm email**.
4. **Edge Functions**: instale a CLI (`npm i -g supabase`), depois:
   ```bash
   supabase login
   supabase link --project-ref SEU_PROJECT_REF
   supabase functions deploy admin-clientes
   ```
   Se for usar outro domínio interno de login, configure o segredo `LOGIN_DOMAIN` com o mesmo valor de `VITE_LOGIN_DOMAIN`.

### 2. Criar os logins dos donos
1. **Authentication → Users → Add user**: e-mail e senha do seu pai (marque *Auto Confirm*). Repita para o dindo.
2. No SQL Editor, para cada um:
   ```sql
   insert into public.admins (user_id, nome)
   select id, 'Pai' from auth.users where email = 'email.do.pai@exemplo.com';
   ```
   Admins entram com o **e-mail**; clientes entram com o **usuário**.

### 3. Rodar o site
```bash
cp .env.example .env      # preencha URL e chave anon (Project Settings → API)
npm install
npm run dev               # http://localhost:5173
```

### 4a. Publicar no GitHub Pages (grátis, sem conta nova)
1. Crie um repositório **público** vazio no GitHub (ex.: `sacolao-pedidos`) e envie o código:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/sacolao-pedidos.git
   git push -u origin main
   ```
2. No repositório: **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → aba Variables → New repository variable**:
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (os mesmos do `.env`). Opcional: `VITE_WHATSAPP_LOJA`.
4. **Actions → Publicar site → Run workflow**. Em ~1 minuto o site fica em
   `https://SEU_USUARIO.github.io/sacolao-pedidos/`. Todo `git push` na `main` publica de novo.

No celular, abra esse endereço e use **Adicionar à tela inicial** (Safari: botão Compartilhar; Chrome: menu ⋮). O site abre como app, com o ícone do Sacolão.

### 4b. Publicar (Vercel)
1. Suba a pasta num repositório do GitHub (o `.env` fica fora, já está no `.gitignore`).
2. Em vercel.com → **Add New Project** → importe o repositório.
3. Em **Environment Variables**, coloque as mesmas variáveis do `.env`.
4. Deploy. Depois dá para ligar um domínio próprio (ex.: `pedidos.sacolaodachacara.com.br`).

---

## Cadastrar clientes

**Um por um:** painel → **Clientes → Cadastrar cliente**. O sistema sugere o usuário e gera uma senha provisória, e aparece um botão para copiar a mensagem pronta para mandar ao cliente.

**Em lote, a partir do sistema atual da loja:** exporte os clientes para CSV com as colunas de `scripts/clientes-exemplo.csv` (as que não existirem podem ficar vazias) e rode:
```bash
SUPABASE_URL=https://SEU-PROJETO.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=chave-service-role \
node scripts/importar-clientes.mjs clientes.csv
```
Sai um arquivo `credenciais-AAAA-MM-DD.csv` com usuário e senha de cada um. A chave **service_role** dá acesso total: use só no seu computador, nunca no site nem no GitHub.

---

## Como as permissões funcionam
Tudo é garantido no banco (Row Level Security), não só na tela:
- cliente vê só o próprio cadastro e os próprios pedidos; cria pedido apenas pela função `criar_pedido` e cancela só enquanto está "Recebido";
- cliente não altera preço, item nem situação;
- admin vê e altera tudo; o dashboard só responde para admin;
- sem login, nada é acessível.

## Estrutura
```
supabase/migrations/   banco, permissões, funções e catálogo inicial
supabase/functions/    admin-clientes: cria login, troca senha, bloqueia
scripts/               importação de clientes em lote
src/pages/cliente/     fazer pedido, meus pedidos
src/pages/admin/       pedidos, análises, clientes, produtos
```

## Próximos passos possíveis
- Integração com o sistema de estoque/caixa atual (exportar pedidos aprovados ou ler o cadastro direto).
- Aviso no WhatsApp quando chega pedido novo ou muda a situação (API do WhatsApp Business).
- Lista de separação impressa por dia de entrega.
