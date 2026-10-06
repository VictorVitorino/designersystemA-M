# Evidência do ensaio de restauração (restore drill)

> Gerado automaticamente por `platform/tools/restore-drill.js` em 2026-10-06T20:09:32.348Z (duração total 18.1 s). **Resultado: APROVADO**

Para repetir: `cd platform && TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/canteiro_t_c node tools/restore-drill.js --s3` (precisa de Postgres 15+ local e, para a parte S3, `pip install "moto[server]"`).

## Ambiente do ensaio

| Item | Valor |
| --- | --- |
| Node | v22.22.0 |
| pg_dump | pg_dump (PostgreSQL) 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1) |
| Máquina | Linux 6.18.44-fc-v70 x64, 4 CPUs |
| Armazenamento de arquivos | pasta local (disco) |
| Destino do backup | pasta separada e, na segunda rodada, bucket S3 falso (moto) em outro "bucket" |

## Dados de demonstração (seed)

| Item | Quantidade |
| --- | --- |
| Usuários | 30 |
| Apresentações | 200 |
| Versões no histórico | 706 |
| Arquivos únicos no armazenamento (imagens/PDF/CSV + miniaturas) | 448 (300 arquivos + 148 miniaturas), 9.52 MB |
| Reenvios deduplicados (mesmo SHA-256 = um só objeto) | 120 |
| Referências de arquivo (apresentações e versões) | 2982 |
| Comentários / interações / eventos de auditoria | 500 / 800 / 1400 |

## Linha do tempo medida

| Etapa | Tempo | Resultado |
| --- | ---: | --- |
| Preparar banco de origem (migrações) e popular dados de demonstração | 3.2 s | OK |
| Verificação de implantação ANTES do backup (verify-deploy) | 78 ms | OK |
| Backup do banco (pg_dump → AES-256-GCM → destino) + verificação | 399 ms | OK |
| Espelho dos arquivos (incremental, cifrado) | 1.4 s | OK |
| Segundo espelho (nada novo: deve copiar 0) | 281 ms | OK |
| Backup do banco para S3 (moto) + verificação | 470 ms | OK |
| Espelho dos arquivos para S3 (moto) | 4.2 s | OK |
| Gravar dados depois do backup (serão perdidos de propósito) | 33 ms | OK |
| DESASTRE: apagar o schema app e a pasta de arquivos | 428 ms | OK |
| Restaurar arquivos do espelho cifrado para pasta nova | 1.1 s | OK |
| Restaurar o banco em banco novo (+ migrate --check, contagens, amostras, re-hash de todos os arquivos) | 1.2 s | OK |
| verify-deploy no banco restaurado (RLS, papéis, permissões, gatilhos, migrações) | 46 ms | OK |
| Isolamento depois da restauração (RLS em ação) | 63 ms | OK |
| Restaurar a partir do bucket S3 (moto): arquivos + banco + verificação | 3.6 s | OK |

## Backup

| Item | Valor |
| --- | --- |
| Nome | `canteiro-drill-20261006T200935Z` |
| Banco: dump em claro → cifrado | 430.3 KB → 430.4 KB |
| Tabelas / linhas no manifesto | 14 / 7674 |
| Snapshot consistente (contagens = dump) | sim |
| Backup relido e verificado (SHA-256, autenticação de todos os blocos, índice do pg_restore) | sim |
| Arquivos copiados no 1º espelho | 448 de 448 (9.52 MB) em 1.4 s |
| 2º espelho (incremental) | 0 copiados, 448 já no destino |

Backup em S3 (moto): banco 430.4 KB em 371 ms, 448 arquivos (9.52 MB) em 4.1 s; verificado: sim.

## O desastre simulado

Em 2026-10-06T20:09:43.820Z foram destruídos: schema app, public.schema_migrations, pasta de arquivos. Último backup: `canteiro-drill-20261006T200935Z`.

| Medida | Valor | Como ler |
| --- | --- | --- |
| RPO observado (perda de tempo) | 8.2 s entre o instante do backup (snapshot) e o desastre | No ensaio o desastre foi imediato. **Em produção o RPO é o intervalo entre backups: no máximo 24 h** (backup diário às 05:15 UTC) mais a duração do backup. |
| Dados gravados depois do backup | 25 registros de auditoria | Perdidos de propósito — confirmados como ausentes após a restauração (é isso que o RPO significa). |

## Restauração (RTO medido)

| Medida | Valor |
| --- | --- |
| **RTO observado** (início da restauração → tudo verificado) | **2.5 s** (2500 ms) |
| pg_restore (banco) | 596 ms |
| Arquivos restaurados do espelho cifrado | 448 (9.52 MB) em 1.1 s |
| Verificação dos objetos (re-hash) | 448/448 íntegros, 436 ms |
| Vazão dos arquivos medida (disco local; amostra pequena, só indicativa — em produção manda a rede) | 8.5 MB/s |

Restauração a partir do bucket S3 (moto): OK — 448/448 arquivos íntegros, banco em 1.0 s, arquivos em 2.6 s.

## Verificações depois da restauração

### 1. Contagens por tabela (antes do desastre, pelo manifesto → depois da restauração) e amostra de linhas

| Tabela | Linhas restauradas |
| --- | ---: |
| `app.asset_refs` | 2982 |
| `app.asset_uploads` | 565 |
| `app.assets` | 448 |
| `app.audit_log` | 1400 |
| `app.comments` | 500 |
| `app.interactions` | 800 |
| `app.invites` | 0 |
| `app.presentation_versions` | 706 |
| `app.presentations` | 200 |
| `app.rate_limits` | 0 (dados excluídos do backup de propósito) |
| `app.settings` | 5 |
| `app.user_identities` | 30 |
| `app.users` | 30 |
| `public.schema_migrations` | 3 |

Diferenças contra o manifesto (contagem e hash de uma amostra de linhas por chave primária, em todas as tabelas): **0** OK.

### 2. Totais esperados × restaurados

| Item | Antes do desastre | Depois da restauração |
| --- | ---: | ---: |
| Usuários | 30 | 30 |
| Apresentações | 200 | 200 |
| Arquivos (linhas em app.assets) | 448 | 448 |
| Auditoria | 1425 | 1400 (−25, perdidos de propósito) |

### 3. Arquivos (re-hash SHA-256 de todos os objetos referenciados no banco restaurado)

| Referenciados | Íntegros | Ausentes | Corrompidos | Tamanho errado | Bytes relidos |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 448 | 448 | 0 | 0 | 0 | 9.52 MB |

### 4. verify-deploy no banco restaurado (RLS, papéis e permissões intactos)

| Verificação | Resultado |
| --- | --- |
| RLS ligada em todas as tabelas do schema app | OK — 13 tabelas com RLS e políticas, nenhuma política aberta |
| Nenhuma permissão para anon/authenticated/PUBLIC no schema app | OK — schema, tabelas, colunas, sequências, funções e privilégios padrão sem acesso público |
| Papéis do banco: app_api sem poderes e sem pertença a app_system/app_owner | OK — app_api só assume app_user; nenhum papel da aplicação é superuser/BYPASSRLS |
| Funções SECURITY DEFINER com search_path fixo e dono sem superpoderes | OK — 10 funções verificadas |
| Gatilhos de proteção (auditoria só-acréscimo, último admin, campos imutáveis) | OK — 5 gatilhos ativos |
| Migrações aplicadas e sem divergência de checksum | OK — 3 migrações aplicadas e idênticas aos arquivos |
| Data API do Supabase não expõe o schema app | não se aplica — papel authenticator inexistente (não é um Supabase): nada a verificar no banco |
| Conexão com o banco usa TLS | não se aplica — banco local (sem TLS é aceitável só em desenvolvimento) |
| Arquivos: bucket/pasta privado (sem leitura pública) | OK — pasta local sem acesso para outros (modo 750) |

migrate --check no banco restaurado: OK.

### 5. Isolamento em ação (consultas reais como app_api → app_user, com RLS)

| Teste | Resultado |
| --- | --- |
| Membro ativo enxerga o acervo comum | OK (191 de 191 esperadas) |
| Usuário suspenso enxerga | 0 apresentações |
| Identidade desconhecida enxerga | 0 apresentações |
| Membro vê lixeira de outros | não |
| Membro consegue editar apresentação de outro | não (0 linhas) |
| app_api lendo tabela direto (sem assumir app_user) | negado (código 42501) |

## O que este ensaio NÃO mediu (e como tratar)

- Rede real: as pastas e o bucket falso ficam na mesma máquina. Em produção o tempo de restauração dos arquivos é dominado pela vazão da internet entre o bucket de backup e o armazenamento principal (veja a estimativa em docs/BACKUP-E-RESTAURACAO.md).
- Volume: o ensaio usa dezenas de MB. O procedimento é em fluxo (memória constante), mas 500 GB–1 TB devem ser ensaiados no ambiente de staging com o bucket real (marcado como pendência em docs/BACKUP-E-RESTAURACAO.md).
- Papéis do banco (app_owner, app_user, app_system, app_api, app_ops) pertencem ao cluster e já existiam neste Postgres; a criação do zero é feita por `restore.js` com o mesmo bootstrap do `migrate.js` e deve ser conferida no primeiro ensaio em um projeto Supabase novo.
- Supabase/Vercel/GitHub Actions reais: não acessíveis neste ambiente. Ensaiar em staging antes de depender de produção.
