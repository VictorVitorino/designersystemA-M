# Desempenho do banco MVP (Supabase Free) — 09/10/2026

## Evidências de origem

O **Supabase Performance Advisor** do projeto exclusivo `canteiro-mvp` sinalizou **10 FKs sem índice de suporte** em 09/10/2026. A listagem foi confrontada com `pg_constraint` e `pg_indexes` **do banco real**. As 10 FKs têm a coluna simples descrita na migração `0009_fk_lookup_indexes.sql`.

**Alteração proposta:** adicionar 10 índices convencionais, com `IF NOT EXISTS`, sobre as colunas FK. Não muda a lógica do editor, não altera tabelas, RLS, usuários ou dados. Os índices reduzem a chance de varreduras custosas quando houver várias apresentações e usuários, mas geram uma pequena sobrecarga de armazenamento e escrita. Para um piloto com poucos usuários, o ganho é preventivo, não uma performance já medida.

**Antes de aplicar no Supabase real:**

1. Aprovar CI, migrações em PostgreSQL 17 e E2E desta branch.
2. Integrar à `main` e aplicar `0009` com o mecanismo versionado do projeto (`tools/migrate.js` / workflow protegido).
3. Conferir `public.schema_migrations` (versão e checksum), `pg_indexes` e rodar novamente o Performance Advisor.
4. Se persistirem avisos de `unused_index` em banco ainda sem dados, **não excluir índices apenas por estarem sem uso no piloto inicial**.

Avisos de `public.schema_migrations` com RLS ativa mas sem políticas são **esperados**: o controle de migração não deve ser acessível via Data API. Não adicionar políticas para "resolver" esse INFO.

**Situação de produção:** não comprova hospedagem do site, sessão Auth nem salvamento online. Continua necessária homologação real com Render e Supabase.
