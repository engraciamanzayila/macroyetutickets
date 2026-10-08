# MACRO YETU TICKETs — Loja pública e promotores

## Já feito nesta etapa
- Entrar com Google.
- Tipo de ingresso editável por grupo (Normal, VIP, VIP em pé, Mesa, Convite, Staff, Outro) antes de gerar; após gerar, o grupo fica bloqueado (nome, tipo, quantidade, editor).
- Leitura de QR/código já existe no menu "Portaria".

## Fase 1 — Promotores
- Novo papel "promotor": regista-se, pede aprovação, o administrador aprova em "Equipa".
- Promotor vê e gere só os seus eventos (mesmo fluxo atual: carregar artes, grupos, gerar, portaria).
- Administrador vê todos os eventos e define a comissão da plataforma por evento.

## Fase 2 — Loja pública
- Página inicial com eventos publicados (pesquisa por cidade, data, categoria).
- Página do evento: capa, descrição, local, mapa, tipos de ingresso com preço (Kz) e stock.
- Carrinho e checkout: nome, telefone, e-mail, método de pagamento, canal de entrega.
- Promotor marca evento como "publicado" e define preço/stock por grupo.

## Fase 3 — Pagamentos (preparados para Angola)
- Métodos: Multicaixa Express, Referência Multicaixa, Unitel Money, Afrimoney, PayPay e outros.
- Cada encomenda fica "pendente" até confirmação; arquitetura com um ponto único para ligar o agregador (ex: ProxyPay / EMIS / PayPay) quando tiver contrato e chaves.
- Até lá: confirmação manual pelo promotor/admin (com comprovativo carregado pelo comprador).

## Fase 4 — Entrega
- Ao confirmar o pagamento, os ingressos são atribuídos e o comprador recebe link para o ingresso digital (QR).
- Envio por e-mail já; WhatsApp/SMS preparados para ligar a um fornecedor depois.
- Página "Os meus ingressos" para o comprador.

## Fase 5 — Identidade visual
- Mockups: logotipo, cartões, pulseiras, credenciais staff, t-shirt, boné, banner, ingresso, redes sociais.

## Pendente do seu lado
- Domínio próprio (para e-mails com remetente MACRO YETU TICKETs).
- Contrato com agregador de pagamentos.
- Entrar por telefone (mais tarde).

## Detalhes técnicos
- Tabelas novas: promoter_profiles, orders, order_items, payments; colunas price/stock/published em ticket_groups/events; events.owner_id.
- RLS: promotor só acede a eventos onde owner_id = auth.uid(); papel "promoter" no enum app_role.
- Rota pública /e/$slug com SSR e metadados; checkout via função de servidor; webhook de pagamento em /api/public/payments/*.
