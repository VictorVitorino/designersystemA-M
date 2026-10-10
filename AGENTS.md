# AGENTS.md — ponto de entrada para ferramentas e agentes

1. **Regras do repositório:** `CLAUDE.md` (valem para qualquer ferramenta, não só para o Claude).
2. **Estado atual e próximas tarefas:** `HANDOFF.md`.
3. **Detalhes técnicos:**
   - editor: `studio/docs/ARCH.md`;
   - plataforma: `platform/README.md`, `platform/docs/API.md`, `platform/docs/SEGURANCA.md`;
   - status do MVP: `platform/docs/STATUS-MVP.md`.

Resumo das regras que mais quebram:
- **`studio/` é intocável pela plataforma.**
- Testes que falham não se pulam.
- Merge só com CI verde **e** aprovação do dono.
- Nenhum recurso pago nem deploy sem autorização.
- Interface e mensagens em pt-BR.
