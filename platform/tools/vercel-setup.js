#!/usr/bin/env node
/* tools/vercel-setup.js — cria/atualiza o projeto do Canteiro na Vercel e grava as variáveis da API por ambiente, a partir das chaves do GitHub.
   Usado pelo workflow "Configurar Vercel" (configurar-vercel.yml) e, no modo `ids`, pelos deploys (descobrem o time e o projeto sozinhos).
   NÃO EXECUTADO contra a Vercel real ao ser escrito: testado contra um servidor falso que imita a API REST da Vercel (tests/ops/vercel-setup.test.js).

   Uso:
     node tools/vercel-setup.js ids [--github-env ARQ]                       time (VERCEL_ORG_ID) e projeto (VERCEL_PROJECT_ID): não são segredos
     node tools/vercel-setup.js configurar --ambiente staging|production [--simular] [--rotacionar-csrf] [--resumo ARQ] [--json ARQ]
   Variáveis: VERCEL_TOKEN; opcionais VERCEL_TEAM (slug/nome do time, se o token enxergar mais de um), VERCEL_PROJECT (padrão "canteiro"),
     VERCEL_ORG_ID/VERCEL_PROJECT_ID (se já souber), VERCEL_AUTOMATION_BYPASS_SECRET (cadastrado como "Protection Bypass for Automation").
     Para `configurar`, as chaves mínimas do ambiente (docs/CHAVES.md).
   O que `configurar` faz (idempotente):
     1. projeto: cria se não existir; Root Directory "platform", arquivos fora da raiz no build, Node 22.x, framework nenhum, região gru1,
        deploy automático pelo Git DESLIGADO ("Ignored Build Step" = exit 0; quem publica é o GitHub Actions), proteção da Vercel só nos
        endereços *.vercel.app (os domínios próprios ficam abertos; o Canteiro tem login próprio)
     2. ambiente personalizado "staging" (plano Pro)
     3. variáveis da API do ambiente escolhido, montadas a partir das chaves (segredos marcados como Sensitive). NUNCA grava DATABASE_ADMIN_URL,
        DATABASE_OPS_URL, BACKUP_*, senhas de papéis nem tokens; se alguém as tiver posto lá à mão, REMOVE (a API recusa iniciar com elas).
        CSRF_SECRET: usa o segredo do GitHub se existir; senão gera um aleatório só na primeira vez (rode com --rotacionar-csrf para trocar)
     4. domínio do ambiente (de PRODUCTION_URL/STAGING_URL) e os registros de DNS que a TI precisa criar */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ToolError, buildRedactor, parseArgs, runCli, isMain } from './lib/common.js';
import { variaveisDaApi, relatorioProblemas, AMBIENTES, normalizaAmbiente } from './lib/chaves.js';
import { clienteHttp, cabecalhosSupabase } from './lib/http-api.js';
import { FORBIDDEN_API_ENV } from './lib/api-env.js';

export const PROJETO_PADRAO = 'canteiro';
export const AJUSTES_PROJETO = Object.freeze({ framework: null, rootDirectory: 'platform', sourceFilesOutsideRootDirectory: true, nodeVersion: '22.x', serverlessFunctionRegion: 'gru1', commandForIgnoringBuildStep: 'exit 0' });
const PROTECAO = Object.freeze({ deploymentType: 'all_except_custom_domains' });

export function clienteVercel({ token, fetchImpl = fetch, redact = (s) => s, base }) {
  return clienteHttp({ base: base || 'https://api.vercel.com', headers: { Authorization: `Bearer ${token}` }, fetchImpl, redact, nome: 'Vercel' });
}

/** Time: VERCEL_ORG_ID > VERCEL_TEAM (slug, id ou nome) > o único time que o token enxerga. */
export async function resolverTime(api, { orgId = '', team = '' } = {}) {
  if (orgId) return { id: orgId, slug: null, origem: 'variável VERCEL_ORG_ID' };
  const { json } = await api.get('/v2/teams', { query: { limit: 100 } });
  const times = Array.isArray(json?.teams) ? json.teams : [];
  if (team) {
    const t = times.find((x) => [x.id, x.slug, x.name].some((v) => v && String(v).toLowerCase() === team.toLowerCase()));
    if (!t) throw new ToolError(`o token da Vercel não enxerga o time "${team}". Times visíveis: ${times.map((x) => x.slug).join(', ') || '(nenhum)'}`, { code: 'no_team', exit: 2 });
    return { id: t.id, slug: t.slug, nome: t.name, origem: 'variável VERCEL_TEAM' };
  }
  if (times.length === 1) return { id: times[0].id, slug: times[0].slug, nome: times[0].name, origem: 'único time do token' };
  if (!times.length) throw new ToolError('o token da Vercel não enxerga nenhum time: crie o token em Account Settings → Tokens com o escopo do time "Canteiro A&M" (plano Pro)', { code: 'no_team', exit: 2 });
  throw new ToolError(`o token enxerga ${times.length} times (${times.map((x) => x.slug).join(', ')}): cadastre a variável do repositório VERCEL_TEAM com o slug do time do Canteiro`, { code: 'many_teams', exit: 2 });
}

export async function lerProjeto(api, teamId, idOuNome) {
  const r = await api.get(`/v9/projects/${encodeURIComponent(idOuNome)}`, { query: { teamId }, aceitar: [404] });
  return r.status === 404 ? null : r.json;
}

/** Descobre os IDs que a CLI da Vercel precisa (não são segredos). */
export async function descobrirIds({ env = process.env, api }) {
  const time = await resolverTime(api, { orgId: (env.VERCEL_ORG_ID || '').trim(), team: (env.VERCEL_TEAM || '').trim() });
  const alvo = (env.VERCEL_PROJECT_ID || '').trim() || (env.VERCEL_PROJECT || '').trim() || PROJETO_PADRAO;
  const p = await lerProjeto(api, time.id, alvo);
  if (!p?.id) throw new ToolError(`projeto "${alvo}" não encontrado na Vercel (time ${time.slug || time.id}): rode antes o workflow "Configurar Vercel"`, { code: 'no_project', exit: 2 });
  return { orgId: time.id, projectId: p.id, projeto: p.name, time };
}

const temAlvo = (e, alvo) => (alvo.customEnvironmentId ? (e.customEnvironmentIds || []).includes(alvo.customEnvironmentId) : (e.target || []).includes(alvo.target));
const soAlvo = (e, alvo) => {
  const alvos = [...(e.target || []).map((t) => `t:${t}`), ...(e.customEnvironmentIds || []).map((c) => `c:${c}`)];
  return alvos.length === 1 && alvos[0] === (alvo.customEnvironmentId ? `c:${alvo.customEnvironmentId}` : `t:${alvo.target}`);
};
const semAlvo = (e, alvo) => ({ target: (e.target || []).filter((t) => alvo.customEnvironmentId || t !== alvo.target), customEnvironmentIds: (e.customEnvironmentIds || []).filter((c) => c !== alvo.customEnvironmentId) });
const corpoAlvo = (alvo) => (alvo.customEnvironmentId ? { target: [], customEnvironmentIds: [alvo.customEnvironmentId] } : { target: [alvo.target] });
export const proibida = (k) => FORBIDDEN_API_ENV.some((re) => re.test(k)) || k === 'GOTRUE_FAKE';

/**
 * Configura tudo. Devolve {ok, resultados, variaveis, removidas, dns, ids}.
 * @param {{env:object, ambiente:string, simular?:boolean, rotacionarCsrf?:boolean, fetchImpl?:Function, descobrirPoolerImpl?:Function, log?:Function}} o
 */
export async function configurarVercel({ env = process.env, ambiente, simular = false, rotacionarCsrf = false, fetchImpl = fetch, descobrirPoolerImpl = null, conferirSupabase = true, log = () => {} } = {}) {
  const amb = normalizaAmbiente(ambiente || env.AMBIENTE); const A = AMBIENTES[amb];
  if (!env.VERCEL_TOKEN) throw new ToolError(relatorioProblemas({ ambiente: amb, faltando: [{ nome: 'VERCEL_TOKEN', tipo: 'segredo', de: 'Vercel → Account Settings → Tokens', onde: `GitHub → Settings → Environments → ${A.github} → Environment secrets` }], erros: [] }), { code: 'missing_keys', exit: 2 });
  // pooler: o DATABASE_URL da API usa o mesmo servidor, porta 6543
  const pre = variaveisDaApi(env, { ambiente: amb });
  if (pre.faltando.length || pre.erros.length) throw new ToolError(relatorioProblemas({ ambiente: amb, faltando: pre.faltando, erros: pre.erros }), { code: 'missing_keys', exit: 2 });
  if (pre.poolerPendente) {
    if (!env.SUPABASE_DB_PASSWORD) throw new ToolError('para montar o DATABASE_URL da API preciso achar o servidor do banco: cadastre o segredo SUPABASE_DB_PASSWORD neste ambiente (ou a variável SUPABASE_POOLER_HOST)', { code: 'missing_keys', exit: 2 });
    const descobrir = descobrirPoolerImpl || (async (o) => (await import('./lib/pooler.js')).descobrirPooler(o));
    const { host } = await descobrir({ ref: pre.ref, password: env.SUPABASE_DB_PASSWORD, regiao: env.SUPABASE_REGION || undefined, log }); env = { ...env, CANTEIRO_POOLER_HOST: host };
  }
  const redact = buildRedactor(env); const api = clienteVercel({ token: env.VERCEL_TOKEN, fetchImpl, redact, base: env.VERCEL_API_URL });
  const resultados = []; const add = (item, status, detalhe = '') => { resultados.push({ item, status, detalhe: redact(detalhe) }); log(`${status.toUpperCase().padEnd(8)} ${item}${detalhe ? ' — ' + redact(detalhe) : ''}`); };
  const out = { ambiente: amb, simular, resultados, variaveis: [], removidas: [], dns: [], ids: null };

  // 1. projeto
  const time = await resolverTime(api, { orgId: (env.VERCEL_ORG_ID || '').trim(), team: (env.VERCEL_TEAM || '').trim() });
  const nome = (env.VERCEL_PROJECT || '').trim() || PROJETO_PADRAO;
  let proj = await lerProjeto(api, time.id, (env.VERCEL_PROJECT_ID || '').trim() || nome);
  if (!proj) {
    if (simular) { add('Projeto na Vercel', 'mudaria', `criaria o projeto "${nome}" no time ${time.slug || time.id}`); out.ok = true; out.resumo = resumoMarkdown(out); return out; }
    const { json } = await api.post('/v11/projects', { name: nome, ...AJUSTES_PROJETO }, { query: { teamId: time.id } });
    if (!json?.id) throw new ToolError('a Vercel não devolveu o id do projeto criado', { code: 'bad_response' });
    proj = json; add('Projeto na Vercel', 'alterado', `criado "${proj.name}" (${proj.id}) no time ${time.slug || time.id} — sem ligação com o Git: quem publica é o GitHub Actions`);
  } else add('Projeto na Vercel', 'ok', `"${proj.name}" (${proj.id}) no time ${time.slug || time.id}`);
  out.ids = { orgId: time.id, projectId: proj.id };
  const q = { teamId: time.id }; const P = `/v9/projects/${encodeURIComponent(proj.id)}`; const E = `/v10/projects/${encodeURIComponent(proj.id)}/env`;   // env: mesmas rotas da CLI da Vercel 62.5.0

  const dif = Object.entries(AJUSTES_PROJETO).filter(([k, v]) => (proj[k] ?? null) !== v).map(([k]) => k);
  if (!dif.length) add('Ajustes do projeto (raiz, Node 22, região, Git)', 'ok', 'já estavam certos');
  else if (simular) add('Ajustes do projeto (raiz, Node 22, região, Git)', 'mudaria', dif.join(', '));
  else {
    const { json } = await api.patch(P, Object.fromEntries(dif.map((k) => [k, AJUSTES_PROJETO[k]])), { query: q });
    const ainda = dif.filter((k) => json && (json[k] ?? null) !== AJUSTES_PROJETO[k]);
    add('Ajustes do projeto (raiz, Node 22, região, Git)', ainda.length ? 'aviso' : 'alterado', ainda.length ? `a Vercel não confirmou: ${ainda.join(', ')} — confira em Project Settings` : `ajustado: ${dif.join(', ')}`);
  }
  if (proj.link?.type) add('Ligação com o Git', 'aviso', `o projeto está ligado ao ${proj.link.type} (${proj.link.repo || ''}); o "Ignored Build Step = exit 0" cancela os deploys automáticos. Se preferir, desconecte em Settings → Git.`);
  if (JSON.stringify(proj.ssoProtection || null) !== JSON.stringify(PROTECAO)) {
    if (simular) add('Proteção da Vercel (só endereços *.vercel.app)', 'mudaria', JSON.stringify(PROTECAO));
    else { try { await api.patch(P, { ssoProtection: PROTECAO }, { query: q }); add('Proteção da Vercel (só endereços *.vercel.app)', 'alterado', 'os domínios próprios (produção e staging) ficam acessíveis; os endereços gerados pedem login da Vercel'); } catch (e) { add('Proteção da Vercel (só endereços *.vercel.app)', 'aviso', `${e.message} — ajuste em Settings → Deployment Protection → Vercel Authentication: "Standard Protection"`); } }
  } else add('Proteção da Vercel (só endereços *.vercel.app)', 'ok', 'já estava');
  // segredo opcional para as verificações passarem pela proteção da Vercel (PUB-03): o valor vem do GitHub e é cadastrado aqui
  const bypass = String(env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  if (bypass) {
    const item = 'Protection Bypass for Automation (VERCEL_AUTOMATION_BYPASS_SECRET)';
    if (proj.protectionBypass && Object.prototype.hasOwnProperty.call(proj.protectionBypass, bypass)) add(item, 'ok', 'o segredo do GitHub já está cadastrado na Vercel');
    else if (simular) add(item, 'mudaria', 'cadastraria o segredo do GitHub na Vercel');
    else { try { await api.patch(`/v1/projects/${encodeURIComponent(proj.id)}/protection-bypass`, { generate: { secret: bypass } }, { query: q }); add(item, 'alterado', 'cadastrado: verify-deploy, smoke e monitor passam pela proteção da Vercel'); } catch (e) { add(item, 'aviso', `${e.message} — cadastre o MESMO valor em Settings → Deployment Protection → Protection Bypass for Automation`); } }
  }

  // 2. ambiente personalizado staging
  let alvo = { target: 'production', nome: 'Production' };
  if (amb === 'staging') {
    const { json } = await api.get(`${P}/custom-environments`, { query: q });
    const lista = Array.isArray(json) ? json : json?.environments || json?.customEnvironments || [];
    let ce = lista.find((x) => x.slug === 'staging');
    if (!ce) {
      if (simular) { add('Ambiente personalizado "staging"', 'mudaria', 'seria criado'); ce = { id: 'env_simulado' }; }
      else { const r = await api.post(`${P}/custom-environments`, { slug: 'staging', description: 'Ensaio (staging) do Canteiro — publicado pelo GitHub Actions' }, { query: q }); ce = r.json; if (!ce?.id) throw new ToolError('a Vercel não devolveu o id do ambiente staging criado', { code: 'bad_response' }); add('Ambiente personalizado "staging"', 'alterado', `criado (${ce.id})`); }
    } else add('Ambiente personalizado "staging"', 'ok', `já existia (${ce.id})`);
    alvo = { customEnvironmentId: ce.id, nome: 'staging' };
  }

  // 3. variáveis da API
  const existentes = (await api.get(E, { query: q })).json?.envs || [];
  const doAlvo = existentes.filter((e) => temAlvo(e, alvo));
  let csrf = '';
  if (!env.CSRF_SECRET) {
    const tem = doAlvo.some((e) => e.key === 'CSRF_SECRET');
    if (!tem || rotacionarCsrf) csrf = crypto.randomBytes(48).toString('base64');
  }
  const v = variaveisDaApi(env, { ambiente: amb, csrfSecret: csrf });
  if (v.faltando.length || v.erros.length) throw new ToolError(relatorioProblemas({ ambiente: amb, faltando: v.faltando, erros: v.erros }), { code: 'missing_keys', exit: 2 });
  if (!v.vars.some((x) => x.key === 'DATABASE_URL')) throw new ToolError('não consegui montar o DATABASE_URL da API (servidor do banco desconhecido): nada foi gravado', { code: 'missing_keys', exit: 2 });
  for (const x of v.vars) if (proibida(x.key)) throw new ToolError(`erro interno: ${x.key} nunca pode ir para a Vercel`, { code: 'forbidden' });   // defesa extra
  if (conferirSupabase) await conferirChavesSupabase({ vars: v.vars, fetchImpl, redact, add });

  for (const e of doAlvo.filter((e) => proibida(e.key))) {
    if (simular) { add(`Remover ${e.key}`, 'mudaria', 'proibida na Vercel'); continue; }
    if (soAlvo(e, alvo)) await api.del(`${E}/${encodeURIComponent(e.id)}`, { query: q }); else await api.patch(`${E}/${encodeURIComponent(e.id)}`, semAlvo(e, alvo), { query: q });
    out.removidas.push(e.key); add(`Remover ${e.key}`, 'alterado', 'variável proibida na API (credencial de ferramenta) — removida deste ambiente');
  }
  for (const x of v.vars) {
    const tipo = x.sensivel ? 'sensitive' : 'encrypted'; const atuais = doAlvo.filter((e) => e.key === x.key);
    out.variaveis.push({ key: x.key, sensivel: x.sensivel, gerado: x.key === 'CSRF_SECRET' && !!csrf });
    if (simular) continue;
    let feito = false;
    for (const e of atuais) {
      if (soAlvo(e, alvo) && !feito && e.type === tipo) { await api.patch(`${E}/${encodeURIComponent(e.id)}`, { value: x.value, type: tipo, ...corpoAlvo(alvo) }, { query: q }); feito = true; }
      else if (soAlvo(e, alvo)) await api.del(`${E}/${encodeURIComponent(e.id)}`, { query: q });
      else await api.patch(`${E}/${encodeURIComponent(e.id)}`, semAlvo(e, alvo), { query: q });   // estava compartilhada com outro ambiente: separa
    }
    if (!feito) await api.post(E, { key: x.key, value: x.value, type: tipo, ...corpoAlvo(alvo) }, { query: q });
  }
  // CSRF já existente na Vercel e não informado no GitHub: mantém (não aparece em v.vars)
  if (!env.CSRF_SECRET && !csrf) out.variaveis.push({ key: 'CSRF_SECRET', sensivel: true, mantido: true });
  if (!simular) {
    const depois = ((await api.get(E, { query: q })).json?.envs || []).filter((e) => temAlvo(e, alvo));
    const nomes = new Set(depois.map((e) => e.key)); const faltam = out.variaveis.map((x) => x.key).filter((k) => !nomes.has(k)); const ruins = depois.filter((e) => proibida(e.key)).map((e) => e.key);
    if (faltam.length || ruins.length) add(`Variáveis da API (${alvo.nome})`, 'erro', `${faltam.length ? 'não apareceram na releitura: ' + faltam.join(', ') : ''}${ruins.length ? ' · proibidas ainda presentes: ' + ruins.join(', ') : ''}`);
    else add(`Variáveis da API (${alvo.nome})`, 'alterado', `${out.variaveis.length} gravadas/conferidas (${out.variaveis.filter((x) => x.sensivel).length} como Sensitive); nenhuma credencial de ferramenta${csrf ? '; CSRF_SECRET gerado agora' : ''}`);
  } else add(`Variáveis da API (${alvo.nome})`, 'mudaria', `${out.variaveis.length} variáveis: ${out.variaveis.map((x) => x.key).join(', ')}`);

  // 4. domínio e DNS
  const site = env[A.urlVar]; let host = ''; try { host = new URL(site).hostname; } catch { /* sem URL */ }
  if (!host) add('Domínio', 'aviso', `defina a variável do repositório ${A.urlVar} (https://…) para o domínio ser cadastrado`);
  else {
    let d = (await api.get(`${P}/domains/${encodeURIComponent(host)}`, { query: q, aceitar: [404] }));
    if (d.status === 404) {
      if (simular) add(`Domínio ${host}`, 'mudaria', 'seria cadastrado no projeto');
      else { await api.post(`/v10/projects/${encodeURIComponent(proj.id)}/domains`, { name: host, ...(alvo.customEnvironmentId ? { customEnvironmentId: alvo.customEnvironmentId } : {}) }, { query: q }); d = await api.get(`${P}/domains/${encodeURIComponent(host)}`, { query: q, aceitar: [404] }); add(`Domínio ${host}`, 'alterado', `cadastrado no ambiente ${alvo.nome}`); }
    } else {
      const certo = alvo.customEnvironmentId ? d.json?.customEnvironmentId === alvo.customEnvironmentId : !d.json?.customEnvironmentId && !d.json?.gitBranch;
      if (!certo && !simular) { await api.patch(`${P}/domains/${encodeURIComponent(host)}`, alvo.customEnvironmentId ? { customEnvironmentId: alvo.customEnvironmentId } : { gitBranch: null, customEnvironmentId: null }, { query: q }); add(`Domínio ${host}`, 'alterado', `reatribuído ao ambiente ${alvo.nome}`); }
      else add(`Domínio ${host}`, certo ? 'ok' : 'mudaria', certo ? `já estava no ambiente ${alvo.nome}` : `seria reatribuído ao ambiente ${alvo.nome}`);
    }
    const dj = d.status === 200 ? d.json || {} : {};
    for (const ver of Array.isArray(dj.verification) ? dj.verification : []) out.dns.push({ tipo: ver.type || 'TXT', nome: ver.domain, valor: ver.value, motivo: 'provar à Vercel que o domínio é seu' });
    const cfg = await api.get(`/v6/domains/${encodeURIComponent(host)}/config`, { query: q, aceitar: [400, 404] }).catch(() => ({ status: 0, json: null }));
    const c = cfg.status === 200 ? cfg.json || {} : {};
    const ordena = (lista) => (Array.isArray(lista) ? [...lista].sort((a, b) => (a.rank || 0) - (b.rank || 0)) : []);
    const cname = ordena(c.recommendedCNAME)[0]?.value || 'cname.vercel-dns.com';
    out.dns.push({ tipo: 'CNAME', nome: host, valor: String(cname).replace(/\.$/, ''), motivo: `aponta ${host} para a Vercel (o certificado HTTPS sai sozinho)` });
    const pronto = c.misconfigured === false && dj.verified !== false;
    add(`DNS de ${host}`, pronto ? 'ok' : 'aviso', pronto ? 'configurado e verificado' : 'a TI precisa criar o(s) registro(s) da tabela abaixo; a Vercel confere sozinha em alguns minutos');
    // o endereço responde sem o login da Vercel? (se pedir, as verificações e o monitor precisam do bypass)
    if (pronto && !simular) {
      try {
        const r = await fetchImpl(`https://${host}/api/health`, { redirect: 'manual', headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {}, signal: AbortSignal.timeout(15000) });
        if (r.status === 401 || r.status === 403) add(`Acesso a ${host} sem login da Vercel`, 'aviso', `respondeu HTTP ${r.status}: o domínio está atrás da proteção da Vercel. Gere 32 letras e números no cofre, cole como segredo do repositório VERCEL_AUTOMATION_BYPASS_SECRET e rode este workflow de novo`);
        else add(`Acesso a ${host} sem login da Vercel`, 'ok', `HTTP ${r.status}${r.status === 404 ? ' (ainda sem deploy neste ambiente: normal antes da primeira publicação)' : ''}`);
      } catch (e) { add(`Acesso a ${host} sem login da Vercel`, 'aviso', `não consegui consultar (${String(e.message).slice(0, 80)})`); }
    }
  }
  out.ok = !resultados.some((x) => x.status === 'erro');
  out.resumo = resumoMarkdown(out);
  return out;
}

/** Antes de gravar, confere que a publishable e a secret key respondem no projeto certo (evita colar a chave de staging na produção). */
async function conferirChavesSupabase({ vars, fetchImpl, redact, add }) {
  const get = (k) => vars.find((x) => x.key === k)?.value; const url = get('SUPABASE_URL'); if (!url) return;
  const tenta = async (nome, chave, caminho) => {
    const r = await clienteHttp({ base: url, headers: cabecalhosSupabase(chave), fetchImpl, redact, nome: 'Supabase' }).get(caminho, { aceitar: [401, 403] });
    if (r.status === 401 || r.status === 403) throw new ToolError(`o Supabase (${new URL(url).hostname}) recusou ${nome} (HTTP ${r.status}): a chave não é deste projeto. Nada foi gravado na Vercel.`, { code: 'bad_key', exit: 2 });
  };
  await tenta('SUPABASE_ANON_KEY', get('SUPABASE_ANON_KEY'), '/auth/v1/settings');
  await tenta('SUPABASE_SERVICE_ROLE_KEY', get('SUPABASE_SERVICE_ROLE_KEY'), '/auth/v1/admin/users?page=1&per_page=1');
  add('Chaves do Supabase conferidas antes de gravar', 'ok', 'publishable e secret key aceitas pelo projeto');
}

export function resumoMarkdown(o) {
  const L = [`## Configurar Vercel — ${o.ambiente}${o.simular ? ' — SIMULAÇÃO (nada foi alterado)' : ''}`, '', '| Item | Resultado | Detalhe |', '|---|---|---|'];
  for (const x of o.resultados) L.push(`| ${x.item} | ${x.status === 'erro' ? '**ERRO**' : x.status === 'aviso' ? 'AVISO' : x.status} | ${String(x.detalhe).replace(/\|/g, '\\|')} |`);
  if (o.variaveis.length) { L.push('', `### Variáveis da API (${o.ambiente}) — só os nomes`, '', o.variaveis.map((x) => `\`${x.key}\`${x.sensivel ? ' (Sensitive)' : ''}${x.gerado ? ' (gerado agora)' : ''}${x.mantido ? ' (mantido)' : ''}`).join(' · ')); }
  if (o.removidas.length) L.push('', `Removidas por serem proibidas na API: ${o.removidas.map((k) => `\`${k}\``).join(', ')}`);
  if (o.dns.length) { L.push('', '### Registros de DNS para a TI criar (site)', '', '| Tipo | Nome | Valor | Para quê |', '|---|---|---|---|'); for (const d of o.dns) L.push(`| ${d.tipo} | \`${d.nome}\` | \`${d.valor}\` | ${d.motivo} |`); }
  if (o.ids) L.push('', `IDs (não são segredos; os deploys descobrem sozinhos): time \`${o.ids.orgId}\`, projeto \`${o.ids.projectId}\`.`);
  L.push('', o.ok ? '**Resultado: Vercel configurada.** As variáveis só valem a partir do próximo deploy (push na main para staging; nova versão para produção).' : '**Resultado: há itens com ERRO** — corrija e rode de novo (é seguro repetir).', '');
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv, { bool: ['simular', 'rotacionar-csrf', 'help'] }); const sub = args._[0] || 'help';
  if (sub === 'help' || args.help) { process.stdout.write(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*/, '') + '\n'); return 0; }
  if (!env.VERCEL_TOKEN) throw new ToolError('falta o segredo VERCEL_TOKEN (Vercel → Account Settings → Tokens; cole no ambiente do GitHub)', { code: 'missing_keys', exit: 2 });
  const redact = buildRedactor(env); const log = (m) => process.stderr.write(redact(m) + '\n');
  if (sub === 'ids') {
    const ids = await descobrirIds({ env, api: clienteVercel({ token: env.VERCEL_TOKEN, redact, base: env.VERCEL_API_URL }) });
    log(`Vercel: time ${ids.time.slug || ids.orgId} (${ids.time.origem}), projeto ${ids.projeto} (${ids.projectId})`);
    if (args['github-env']) fs.appendFileSync(args['github-env'], `VERCEL_ORG_ID=${ids.orgId}\nVERCEL_PROJECT_ID=${ids.projectId}\n`);
    else process.stdout.write(`VERCEL_ORG_ID=${ids.orgId}\nVERCEL_PROJECT_ID=${ids.projectId}\n`);
    return 0;
  }
  if (sub === 'configurar') {
    const ambiente = args.ambiente || env.AMBIENTE; if (!ambiente) throw new ToolError('informe --ambiente staging|production', { code: 'usage', exit: 2 });
    const o = await configurarVercel({ env, ambiente, simular: !!args.simular, rotacionarCsrf: !!args['rotacionar-csrf'], log });
    if (args.resumo) fs.appendFileSync(args.resumo, o.resumo + '\n');
    if (args.json) fs.writeFileSync(args.json, JSON.stringify({ ok: o.ok, ambiente: o.ambiente, resultados: o.resultados, variaveis: o.variaveis, removidas: o.removidas, dns: o.dns, ids: o.ids }, null, 2) + '\n');
    return o.ok ? 0 : 1;
  }
  throw new ToolError(`comando desconhecido: ${sub}. Use ids | configurar`, { code: 'usage', exit: 2 });
}
if (isMain(import.meta.url)) runCli(() => main());
