/* ===== Ícones animados (Icon Motion): FX.icon e FX.iconmorph =====
   54 ícones originais 24×24 (só traço) em 8 temas, 7 transformações, 17 movimentos e 8 gatilhos (os de Lordicon: entrar, passar o
   mouse, sem parar, enquanto o mouse estiver em cima, clicar, vai e volta, sequência e transformação). Sem Lottie e sem CDN:
   vai junto em todo arquivo exportado (assemble.py concatena rt-*.js ao runtime). Nada global além de AMRT.
   Estrutura de cada ícone: k = chave, n = nome, g = tema, kw = palavras de busca, m = movimento padrão (":a" = só no detalhe),
   o = variáveis CSS desse movimento, b = traços de base, a = traços de detalhe (acento laranja). */
(function (R) {
  'use strict';
  var U = R.util;
  var AMICONS = [
    /* ---- Estratégia & Crescimento ---- */
    { k: 'target', n: 'Alvo', g: 'estrategia', kw: 'alvo meta objetivo foco target mira', m: 'nudge:a', o: '--ax:5px;--ay:-5px',
      b: '<circle cx="11" cy="13" r="8.5"/><circle cx="11" cy="13" r="5"/><circle cx="11" cy="13" r="1.5"/>',
      a: '<path d="M11 13L20 4"/><path d="M17 3.5V7h3.5"/>' },
    { k: 'rocket', n: 'Foguete', g: 'estrategia', kw: 'foguete lançamento crescimento startup decolar aceleração', m: 'bounce',
      b: '<path d="M12 2.5c2.6 2 4 5 4 8.5v4.5H8V11c0-3.5 1.4-6.5 4-8.5z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M8 12.5l-2.5 2.2V18L8 16.5"/><path d="M16 12.5l2.5 2.2V18L16 16.5"/>',
      a: '<path d="M10.2 17.8c0 1.5.7 2.6 1.8 3.7 1.1-1.1 1.8-2.2 1.8-3.7"/>' },
    { k: 'chartup', n: 'Gráfico em alta', g: 'estrategia', kw: 'gráfico barras alta crescimento resultado receita', m: 'grow:a',
      b: '<path d="M3.5 3.5v17h17"/>',
      a: '<path d="M8 16.5v-3.5"/><path d="M12 16.5v-6.5"/><path d="M16 16.5V7"/>' },
    { k: 'trend', n: 'Tendência de alta', g: 'estrategia', kw: 'tendência alta seta crescimento evolução performance', m: 'redraw',
      b: '<path d="M3 17l6-6 4 4 8-8"/>', a: '<path d="M15 7h6v6"/>' },
    { k: 'flag', n: 'Bandeira / marco', g: 'estrategia', kw: 'bandeira marco meta conquista chegada milestone', m: 'wave:a', o: '--o:5px 8px',
      b: '<path d="M5 21.5V3"/>', a: '<path d="M5 4h12l-2.8 4.2L17 12.5H5"/>' },
    { k: 'compass', n: 'Bússola / direção', g: 'estrategia', kw: 'bússola direção norte estratégia rumo orientação', m: 'swing:a',
      b: '<circle cx="12" cy="12" r="9"/>', a: '<path d="M15.5 8.5l-2 5-5 2 2-5z"/>' },
    { k: 'trophy', n: 'Troféu', g: 'estrategia', kw: 'troféu vitória prêmio sucesso liderança', m: 'bounce',
      b: '<path d="M7 3.5h10v5.5a5 5 0 0 1-10 0z"/><path d="M7 5.5H4v1.2A3.3 3.3 0 0 0 7.3 10"/><path d="M17 5.5h3v1.2a3.3 3.3 0 0 1-3.3 3.3"/><path d="M12 14v3.5"/><path d="M8.5 20.5h7l-.8-3H9.3z"/>',
      a: '<path d="M12 6.2l.7 1.3 1.4.2-1 1 .2 1.4-1.3-.7-1.3.7.2-1.4-1-1 1.4-.2z"/>' },
    /* ---- Inovação & Tecnologia ---- */
    { k: 'idea', n: 'Ideia / inovação', g: 'tecnologia', kw: 'ideia lâmpada inovação insight criatividade', m: 'blink:a', o: '--o:12px 9.6px',
      b: '<path d="M9 16.5c0-1.4-.6-2.3-1.5-3.2a5.5 5.5 0 1 1 9 0c-.9.9-1.5 1.8-1.5 3.2z"/><path d="M9.5 19.2h5"/><path d="M10.5 21.5h3"/>',
      a: '<path d="M12 1v1.6"/><path d="M4.6 3.6l1.1 1.1"/><path d="M19.4 3.6l-1.1 1.1"/><path d="M1.8 9.6h1.6"/><path d="M20.6 9.6h1.6"/>' },
    { k: 'chip', n: 'IA / chip', g: 'tecnologia', kw: 'ia inteligência artificial chip processador dados ai', m: 'pulse:a', o: '--o:12px 12px',
      b: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>',
      a: '<rect x="9.5" y="9.5" width="5" height="5" rx="1"/>' },
    { k: 'sparkles', n: 'IA generativa', g: 'tecnologia', kw: 'ia generativa genai brilho mágica automação inteligente', m: 'blink:a',
      b: '<path d="M10 3l1.7 4.6L16.3 9.3l-4.6 1.7L10 15.6l-1.7-4.6L3.7 9.3l4.6-1.7z"/>',
      a: '<path d="M18 13.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/><path d="M5.5 17v3.5M3.75 18.75h3.5"/>' },
    { k: 'cloud', n: 'Nuvem / cloud', g: 'tecnologia', kw: 'nuvem cloud migração infraestrutura upload', m: 'nudge:a', o: '--ay:3px',
      b: '<path d="M6.5 19a4 4 0 0 1-.4-8 6 6 0 0 1 11.6.6 4 4 0 0 1-.2 7.4z"/>',
      a: '<path d="M12 17v-5.5"/><path d="M9.5 14l2.5-2.5 2.5 2.5"/>' },
    { k: 'database', n: 'Banco de dados', g: 'tecnologia', kw: 'banco de dados base data lake armazenamento informação', m: 'nudge:a', o: '--ay:-3px',
      b: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/>',
      a: '<path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>' },
    { k: 'code', n: 'Código / sistemas', g: 'tecnologia', kw: 'código software sistema desenvolvimento dev api', m: 'blink:a',
      b: '<path d="M8 7l-5 5 5 5"/><path d="M16 7l5 5-5 5"/>', a: '<path d="M13.5 4.5l-3 15"/>' },
    { k: 'network', n: 'Rede / integração', g: 'tecnologia', kw: 'rede integração conexões ecossistema nós plataforma', m: 'flow:a',
      b: '<circle cx="12" cy="12" r="2.3"/><circle cx="4.5" cy="5" r="1.8"/><circle cx="19.5" cy="5" r="1.8"/><circle cx="4.5" cy="19" r="1.8"/><circle cx="19.5" cy="19" r="1.8"/>',
      a: '<path d="M10.3 10.4L5.8 6.2M13.7 10.4l4.5-4.2M10.3 13.6l-4.5 4.2M13.7 13.6l4.5 4.2"/>' },
    { k: 'monitor', n: 'Painel / dashboard', g: 'tecnologia', kw: 'painel dashboard monitor tela indicadores bi relatório', m: 'redraw:a',
      b: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
      a: '<path d="M6 13l3-3 2.5 2 3.5-4 3 2.5"/>' },
    /* ---- Operações & Processos ---- */
    { k: 'gear', n: 'Engrenagem', g: 'operacoes', kw: 'engrenagem operação processo configuração eficiência máquina', m: 'spin', o: '--sp:90deg',
      b: '<path d="M10.21 4.82L10.47 2.32L13.53 2.32L13.79 4.82A7.4 7.4 0 0 1 15.81 5.66L17.76 4.07L19.93 6.24L18.34 8.19A7.4 7.4 0 0 1 19.18 10.21L21.68 10.47L21.68 13.53L19.18 13.79A7.4 7.4 0 0 1 18.34 15.81L19.93 17.76L17.76 19.93L15.81 18.34A7.4 7.4 0 0 1 13.79 19.18L13.53 21.68L10.47 21.68L10.21 19.18A7.4 7.4 0 0 1 8.19 18.34L6.24 19.93L4.07 17.76L5.66 15.81A7.4 7.4 0 0 1 4.82 13.79L2.32 13.53L2.32 10.47L4.82 10.21A7.4 7.4 0 0 1 5.66 8.19L4.07 6.24L6.24 4.07L8.19 5.66A7.4 7.4 0 0 1 10.21 4.82Z"/>',
      a: '<circle cx="12" cy="12" r="3"/>' },
    { k: 'factory', n: 'Fábrica / indústria', g: 'operacoes', kw: 'fábrica indústria produção manufatura planta operação', m: 'blink:a',
      b: '<path d="M3 21V12l5 3v-3l5 3v-3l5 3V4.5h3V21z"/><path d="M2 21h20"/>',
      a: '<path d="M6.5 18h1.5M11 18h1.5M15.5 18H17"/>' },
    { k: 'truck', n: 'Logística', g: 'operacoes', kw: 'logística caminhão entrega transporte supply chain frete', m: 'nudge', o: '--ax:-4px;--ay:0px',
      b: '<path d="M2.5 6h11v10.5h-11z"/><path d="M13.5 9.5h4l3 3.5v3.5h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>' },
    { k: 'package', n: 'Pacote / estoque', g: 'operacoes', kw: 'pacote caixa estoque produto entrega inventário', m: 'bounce',
      b: '<path d="M12 2.5l8.5 4.5v10L12 21.5 3.5 17V7z"/><path d="M3.5 7L12 11.5 20.5 7"/><path d="M12 11.5v10"/>',
      a: '<path d="M7.8 4.8l8.4 4.5"/>' },
    { k: 'cycle', n: 'Ciclo / melhoria contínua', g: 'operacoes', kw: 'ciclo melhoria contínua pdca recorrência atualizar iteração', m: 'spin',
      b: '<path d="M19.2 8.5A8 8 0 0 0 4.8 8.5"/><path d="M4.8 4.5v4h4"/><path d="M4.8 15.5a8 8 0 0 0 14.4 0"/><path d="M19.2 19.5v-4h-4"/>' },
    { k: 'flow', n: 'Fluxo de trabalho', g: 'operacoes', kw: 'fluxo workflow processo automação etapas sequência', m: 'flow:a',
      b: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/>',
      a: '<path d="M9 6h5a4 4 0 0 1 4 4v5"/><path d="M15.5 12.5L18 15l2.5-2.5"/>' },
    { k: 'puzzle', n: 'Encaixe / integração', g: 'operacoes', kw: 'quebra-cabeça encaixe integração solução peça sinergia', m: 'wiggle',
      b: '<path d="M5 8.5h3.5a2 2 0 1 1 4 0H16V12a2 2 0 1 1 0 4v3.5h-3.5a2 2 0 1 0-4 0H5V16a2 2 0 1 0 0-4z"/>' },
    { k: 'layers', n: 'Camadas / arquitetura', g: 'operacoes', kw: 'camadas arquitetura stack níveis plataforma estrutura', m: 'nudge:a', o: '--ay:-3px',
      b: '<path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5l9 4.5 9-4.5"/>', a: '<path d="M12 3l9 4.5-9 4.5-9-4.5z"/>' },
    /* ---- Finanças & Valor ---- */
    { k: 'coin', n: 'Moeda / receita', g: 'financas', kw: 'moeda dinheiro receita valor custo financeiro', m: 'flip',
      b: '<circle cx="12" cy="12" r="9"/>',
      a: '<path d="M14.6 9.3c-.4-.9-1.4-1.5-2.6-1.5-1.5 0-2.6.8-2.6 1.9 0 2.7 5.4 1.4 5.4 4.3 0 1.1-1.2 2-2.8 2-1.3 0-2.4-.6-2.8-1.6"/><path d="M12 6.2v1.6M12 16v1.8"/>' },
    { k: 'cash', n: 'Dinheiro / caixa', g: 'financas', kw: 'dinheiro nota caixa pagamento economia fluxo de caixa', m: 'float',
      b: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 12h.01M18 12h.01"/>', a: '<circle cx="12" cy="12" r="2.6"/>' },
    { k: 'pie', n: 'Participação', g: 'financas', kw: 'pizza participação share mercado fatia distribuição', m: 'nudge:a', o: '--ax:-2.5px;--ay:2.5px',
      b: '<path d="M11 4.5A8.5 8.5 0 1 0 19.5 13H11z"/>', a: '<path d="M13.5 2.5a8 8 0 0 1 8 8h-8z"/>' },
    { k: 'calc', n: 'Calculadora / business case', g: 'financas', kw: 'calculadora business case orçamento cálculo roi', m: 'blink:a',
      b: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>',
      a: '<rect x="8" y="5.5" width="8" height="3.5" rx=".8"/>' },
    { k: 'percent', n: 'Percentual / margem', g: 'financas', kw: 'percentual margem taxa desconto juros percentagem', m: 'wiggle',
      b: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>' },
    { k: 'bank', n: 'Banco / instituição', g: 'financas', kw: 'banco instituição financeira governo tesouraria capital', m: 'nudge:a', o: '--ay:-2.5px',
      b: '<path d="M5.5 11.5v6M10 11.5v6M14 11.5v6M18.5 11.5v6"/><path d="M3 20.5h18"/>', a: '<path d="M3 9L12 4l9 5z"/>' },
    /* ---- Pessoas & Cultura ---- */
    { k: 'users', n: 'Equipe', g: 'pessoas', kw: 'equipe time pessoas colaboradores grupo squad', m: 'nudge:a', o: '--ax:-2.5px;--ay:0px',
      b: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/>',
      a: '<path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 14.3c2.4.6 4 2.8 4 5.7"/>' },
    { k: 'user', n: 'Pessoa / cliente', g: 'pessoas', kw: 'pessoa cliente usuário colaborador perfil persona', m: 'bounce',
      b: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/>' },
    { k: 'handshake', n: 'Parceria / acordo', g: 'pessoas', kw: 'aperto de mão parceria acordo negociação aliança contrato', m: 'wiggle',
      b: '<path d="M20.5 4.5l1.5 9.5h-2.2"/><path d="M3.5 4.5L2 14h2.2"/><path d="M3.6 5.5h5.2"/><path d="M20.4 5.6l-2.3.5a2 2 0 0 1-1.4-.2l-.7-.4a5.5 5.5 0 0 0-6.6.9L6.8 8.9a1.15 1.15 0 0 0 1.6 1.6l1.3-1.2a2.8 2.8 0 0 1 4 0l4.6 4.6"/>',
      a: '<path d="M4.2 14l6.3 5.8a1.15 1.15 0 0 0 1.6-1.6"/><path d="M10.5 16.6l1.9 1.9a1.15 1.15 0 0 0 1.6-1.6"/><path d="M12.9 14.6l1.9 1.9a1.15 1.15 0 0 0 1.6-1.6"/><path d="M15.2 12.6l1.6 1.6a1.15 1.15 0 0 0 1.6-1.6"/>' },
    { k: 'org', n: 'Organograma', g: 'pessoas', kw: 'organograma hierarquia estrutura organizacional governança áreas', m: 'redraw:a',
      b: '<rect x="9" y="2.5" width="6" height="5" rx="1.2"/><rect x="2.5" y="16.5" width="5.5" height="5" rx="1.2"/><rect x="9.25" y="16.5" width="5.5" height="5" rx="1.2"/><rect x="16" y="16.5" width="5.5" height="5" rx="1.2"/>',
      a: '<path d="M12 7.5v9"/><path d="M5.25 16.5V12h13.5v4.5"/>' },
    { k: 'megaphone', n: 'Comunicação', g: 'pessoas', kw: 'megafone comunicação anúncio campanha marketing divulgação', m: 'blink:a',
      b: '<path d="M3.5 9.5v5h3l8 4.5v-14l-8 4.5z"/><path d="M7 14.5l1.2 5.5h2.4l-1-5"/>',
      a: '<path d="M17.8 9.6a3.4 3.4 0 0 1 0 4.8"/><path d="M20.2 7.2a6.8 6.8 0 0 1 0 9.6"/>' },
    { k: 'chat', n: 'Diálogo / feedback', g: 'pessoas', kw: 'conversa diálogo feedback comentário entrevista comunicação', m: 'blink:a',
      b: '<path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9.5A1.5 1.5 0 0 1 20 17h-9.5l-5 4v-4H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z"/>',
      a: '<path d="M8 10.8h.01M12 10.8h.01M16 10.8h.01"/>' },
    { k: 'heart', n: 'Engajamento / cultura', g: 'pessoas', kw: 'coração engajamento cultura cuidado clima valores', m: 'beat',
      b: '<path d="M12 20.5C7 17 3 13.6 3 9.3 3 6.6 5.1 4.5 7.7 4.5c1.8 0 3.4 1 4.3 2.5.9-1.5 2.5-2.5 4.3-2.5 2.6 0 4.7 2.1 4.7 4.8 0 4.3-4 7.7-9 11.2z"/>' },
    { k: 'grad', n: 'Capacitação', g: 'pessoas', kw: 'capacitação treinamento educação formatura aprendizagem academia', m: 'swing:a', o: '--o:20.5px 9.5px',
      b: '<path d="M12 4.5L2 9.5l10 5 10-5z"/><path d="M6 11.5V16c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8v-4.5"/>', a: '<path d="M20.5 9.5V15"/><path d="M20.5 15l-.9 2h1.8z"/>' },
    /* ---- Risco & Governança ---- */
    { k: 'shield', n: 'Segurança / risco', g: 'risco', kw: 'escudo segurança risco proteção cyber compliance', m: 'redraw:a',
      b: '<path d="M12 21.5s7.5-3.5 7.5-9.5V5.5L12 2.5 4.5 5.5V12c0 6 7.5 9.5 7.5 9.5z"/>', a: '<path d="M8.8 12l2.2 2.2 4.2-4.4"/>' },
    { k: 'lock', n: 'Proteção de dados', g: 'risco', kw: 'cadeado segurança proteção dados privacidade lgpd acesso', m: 'nudge:a', o: '--ay:-2.5px',
      b: '<rect x="4.5" y="10.5" width="15" height="11" rx="2"/><path d="M12 15v2.5"/>', a: '<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>' },
    { k: 'alert', n: 'Ponto de atenção', g: 'risco', kw: 'alerta atenção aviso risco problema cuidado', m: 'wiggle', o: '--o:12px 20px',
      b: '<path d="M10.3 3.9L2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', a: '<path d="M12 9v4.5M12 17h.01"/>' },
    { k: 'scale', n: 'Compliance / equilíbrio', g: 'risco', kw: 'balança compliance justiça equilíbrio jurídico regulação', m: 'swing:a', o: '--o:12px 6.5px',
      b: '<path d="M12 4v17"/><path d="M8 21h8"/><circle cx="12" cy="4" r="1"/>',
      a: '<path d="M4.5 6.5h15"/><path d="M4.5 6.5L2 12.5a2.8 2.8 0 0 0 5 0z"/><path d="M19.5 6.5L17 12.5a2.8 2.8 0 0 0 5 0z"/>' },
    { k: 'doc', n: 'Documento / relatório', g: 'risco', kw: 'documento relatório contrato política arquivo report', m: 'redraw:a',
      b: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/>', a: '<path d="M8.5 9h2.5M8.5 12.5h7M8.5 16h7"/>' },
    { k: 'checklist', n: 'Plano de ação', g: 'risco', kw: 'checklist plano de ação tarefas lista controle auditoria', m: 'redraw:a',
      b: '<rect x="4.5" y="4" width="15" height="17.5" rx="2"/><rect x="8.5" y="2.5" width="7" height="3.5" rx="1"/><path d="M14 11.2h2.5M14 16.2h2.5"/>',
      a: '<path d="M7.8 11l1.3 1.3 2.4-2.4"/><path d="M7.8 16l1.3 1.3 2.4-2.4"/>' },
    { k: 'search', n: 'Diagnóstico / análise', g: 'risco', kw: 'lupa busca diagnóstico análise investigação auditoria due diligence', m: 'orbit',
      b: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3l5.2 5.2"/>', a: '<path d="M7.6 9.2a3.2 3.2 0 0 1 2.6-2.4"/>' },
    /* ---- Tempo & Execução ---- */
    { k: 'clock', n: 'Prazo / tempo', g: 'tempo', kw: 'relógio prazo tempo horário agilidade duração', m: 'tick:a',
      b: '<circle cx="12" cy="12" r="9"/><path d="M12 12l3 2"/>', a: '<path d="M12 12V6.5"/>' },
    { k: 'calendar', n: 'Cronograma / agenda', g: 'tempo', kw: 'calendário cronograma agenda data prazo planejamento', m: 'blink:a',
      b: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v4M16 3v4"/>', a: '<path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/>' },
    { k: 'hourglass', n: 'Urgência', g: 'tempo', kw: 'ampulheta urgência tempo espera prazo contagem', m: 'spin', o: '--sp:180deg',
      b: '<path d="M6.5 2.5h11M6.5 21.5h11"/><path d="M7.5 2.5v3.2c0 2 1.6 3.4 4.5 6.3 2.9-2.9 4.5-4.3 4.5-6.3V2.5"/><path d="M7.5 21.5v-3.2c0-2 1.6-3.4 4.5-6.3 2.9 2.9 4.5 4.3 4.5 6.3v3.2"/>',
      a: '<path d="M10 19.3h4"/>' },
    { k: 'check', n: 'Concluído', g: 'tempo', kw: 'concluído check aprovado ok entregue feito sucesso', m: 'redraw:a',
      b: '<circle cx="12" cy="12" r="9"/>', a: '<path d="M8 12.3l2.7 2.7 5.3-5.5"/>' },
    { k: 'bell', n: 'Alerta / lembrete', g: 'tempo', kw: 'sino alerta lembrete notificação aviso', m: 'swing', o: '--o:12px 3px',
      b: '<path d="M12 3v1.5"/><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/>', a: '<path d="M10 21a2.2 2.2 0 0 0 4 0"/>' },
    /* ---- Mercado & ESG ---- */
    { k: 'globe', n: 'Global / mercado', g: 'mercado', kw: 'globo global mundo mercado internacional expansão', m: 'flip:a',
      b: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>', a: '<path d="M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>' },
    { k: 'building', n: 'Empresa / corporativo', g: 'mercado', kw: 'prédio empresa corporativo escritório sede organização', m: 'blink:a',
      b: '<rect x="4.5" y="3" width="10" height="18.5" rx="1"/><path d="M14.5 9h4a1 1 0 0 1 1 1v11.5"/><path d="M2.5 21.5h19"/><path d="M8.5 21.5v-3h2v3"/>',
      a: '<path d="M8 7h.01M11 7h.01M8 10.5h.01M11 10.5h.01M8 14h.01M11 14h.01"/>' },
    { k: 'leaf', n: 'Sustentabilidade / ESG', g: 'mercado', kw: 'folha sustentabilidade esg meio ambiente verde carbono', m: 'swing', o: '--o:4px 20px',
      b: '<path d="M5.5 18.5C5 10 10 4.5 20 4c.5 9.5-5 15-14.5 14.5z"/><path d="M3.5 20.5l2-2"/>', a: '<path d="M5.5 18.5c3.2-4.6 6.4-7.6 10.5-10"/>' },
    { k: 'pin', n: 'Localização / unidade', g: 'mercado', kw: 'localização pin mapa unidade filial região território', m: 'bounce',
      b: '<path d="M12 21.5s-7-6-7-11.5a7 7 0 0 1 14 0c0 5.5-7 11.5-7 11.5z"/>', a: '<circle cx="12" cy="10" r="2.5"/>' },
    { k: 'bolt', n: 'Energia / agilidade', g: 'mercado', kw: 'raio energia agilidade velocidade rápido quick win', m: 'pulse',
      b: '<path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12z"/>' }
  ];
  /* glifos extras só para pares de morph (estado A → estado B) */
  var AMICON_GLYPHS = {
    trenddown: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    lockopen: '<rect x="4.5" y="10.5" width="15" height="11" rx="2"/><path d="M12 15v2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.7-1.5"/>',
    play: '<path d="M7.5 4.5v15l11.5-7.5z"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.3-2.6 3.9"/><path d="M12 17.2h.01"/>'
  };
  /* pares de morph: [id, nome, estado A, estado B]; A/B = chave de AMICONS (base+detalhe) ou de AMICON_GLYPHS */
  var AMICON_MORPHS = [['alert-check', 'Problema → solução', 'alert', 'check'], ['trend-flip', 'Queda → alta', 'trenddown', 'trend'], ['lock-close', 'Aberto → protegido', 'lockopen', 'lock'], ['play-pause', 'Iniciar ↔ pausar', 'play', 'pause'], ['plus-check', 'Adicionar → confirmado', 'plus', 'check'], ['x-check', 'Reprovado → aprovado', 'x', 'check'], ['question-idea', 'Dúvida → ideia', 'question', 'idea']];
  var AMICON_GROUPS = [['estrategia', 'Estratégia & crescimento'], ['tecnologia', 'Inovação & tecnologia'], ['operacoes', 'Operações & processos'], ['financas', 'Finanças & valor'], ['pessoas', 'Pessoas & cultura'], ['risco', 'Risco & governança'], ['tempo', 'Tempo & execução'], ['mercado', 'Mercado & ESG']];
  /* movimento: [rótulo, alvo padrão ('w' ícone todo | 'a' detalhe | 'r' anel), duração ms, intervalo ms entre peças] */
  var IC_MO = {
    redraw: ['Redesenhar', 'w', 2600, 90], pulse: ['Pulsar', 'w', 1800, 0], beat: ['Batimento', 'w', 1500, 0], spin: ['Girar', 'w', 2600, 0],
    bounce: ['Saltar', 'w', 1600, 0], float: ['Flutuar', 'w', 3200, 0], wiggle: ['Balançar', 'w', 2000, 0], swing: ['Pêndulo', 'w', 2400, 0],
    nudge: ['Encaixar o detalhe', 'a', 2600, 0], tick: ['Ponteiro', 'a', 4000, 0], grow: ['Crescer barras', 'a', 2800, 140], blink: ['Piscar o detalhe', 'a', 2200, 120],
    wave: ['Tremular', 'a', 1600, 0], flow: ['Fluxo no traço', 'a', 1400, 0], flip: ['Virar', 'w', 3000, 0], orbit: ['Órbita', 'w', 3000, 0], ping: ['Onda de sinal', 'r', 1800, 0]
  };
  var IC_TIP = { auto: 'Usa o movimento desenhado para este ícone.', redraw: 'O traço se apaga e se desenha de novo.', pulse: 'Cresce e volta, como uma respiração.', beat: 'Duas batidas rápidas, como um coração.', spin: 'Gira e descansa (engrenagens, ciclos, ampulheta).', bounce: 'Dá um pequeno salto com amortecimento.', float: 'Sobe e desce devagar.', wiggle: 'Balança de um lado para o outro.', swing: 'Oscila preso pelo topo, como um sino.', nudge: 'O detalhe laranja entra e se encaixa no lugar.', tick: 'O ponteiro dá a volta no relógio.', grow: 'As barras crescem da base, uma a uma.', blink: 'O detalhe pisca em sequência.', wave: 'O detalhe tremula, como uma bandeira.', flow: 'Um tracejado corre pelo detalhe, como um fluxo.', flip: 'Vira no próprio eixo, como uma moeda.', orbit: 'Desliza num pequeno círculo, como quem procura.', ping: 'Uma onda se espalha a partir do ícone.' };
  var TRIGS = [['in-hover', 'Ao entrar e ao passar o mouse'], ['in-loop', 'Ao entrar e depois sem parar'], ['in', 'Só ao entrar'], ['loop', 'Sem parar'], ['loop-hover', 'Enquanto o mouse estiver em cima'], ['hover', 'Só ao passar o mouse'], ['click', 'Ao clicar'], ['boomerang', 'Vai e volta ao passar o mouse']];
  var TRK = TRIGS.map(function (t) { return t[0]; });
  var BY = {}; AMICONS.forEach(function (ic) { BY[ic.k] = ic; });
  function icFind(k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(BY, k) ? BY[k] : null; }
  function icParts(m) { return String(m || '').match(/<(path|circle|rect|line|ellipse|polyline)\b[^>]*\/>/g) || []; }
  /* cada traço: classe ic-s, pathLength=1 e --k (ordem do desenho; o detalhe vem por último); quem se move: ic-mv + --j (ordem do movimento) */
  function icSVG(base, acc, tg) {
    var k = 0, j = 0, out = '';
    function put(p, isA) { var mv = tg === 'w' || (tg === 'a' && isA); out += p.replace(/^<(\w+)/, '<$1 class="ic-s' + (isA ? ' ic-ax' : '') + (mv ? ' ic-mv' : '') + '" pathLength="1" style="--k:' + (k++) + (mv ? ';--j:' + (j++) : '') + '"'); }
    icParts(base).forEach(function (p) { put(p, false); });
    icParts(acc).forEach(function (p) { put(p, true); });
    if (tg === 'r') out = '<circle class="ic-ring ic-mv" cx="12" cy="12" r="10.5" style="--j:0"/>' + out;
    return { svg: out, n: k };
  }
  var COLS = /^#[0-9a-f]{3,8}$/i, WHITE = /^#f{3}(f{3})?$/i;
  function col(v, d) { return COLS.test(String(v || '')) ? v : d; }
  /* invólucro comum: placa (fundo), cor do traço (--ic), do detalhe (--ia), espessura (--sw) e legenda editável.
     --is = cor dos traços quando a placa pede outra (branco sobre placa gelo vira navy; placa navy força branco), sem mudar a legenda */
  function wrap(d, w, h, inner, attrs, vars) {
    var lab = String(d.label == null ? '' : d.label).trim(), lw = Math.max.apply(null, lab.split(/\s+/).map(function (x) { return x.length; }).concat([1]));
    var fs = Math.max(8, Math.min(h * .13, w * .14, w / (lw * .58))); /* a palavra mais longa da legenda cabe na largura do ícone */
    var bg = ['none', 'soft', 'circle', 'ring', 'navy'].indexOf(d.bg) >= 0 ? d.bg : 'none', sw = Math.max(1, Math.min(3, +d.stroke || 1.85));
    var c = col(d.color, '#002A46'), a = col(d.accent, '#F78C16'), ice = bg === 'soft' || bg === 'circle';
    if (ice && WHITE.test(a)) a = '#F78C16';
    return '<div class="fx fxic' + (lab ? ' has-l' : '') + '" data-pl="' + bg + '"' + attrs + ' style="' + (vars || '') + '--ic:' + c + ';--ia:' + a + ';--sw:' + sw + (ice && WHITE.test(c) ? ';--is:#002A46' : '') + '"><div class="ic-pl"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg></div>' + (lab ? '<span class="ic-l" style="font-size:' + U.CQ(fs) + '">' + U.E('label', lab) + '</span>' : '') + '</div>';
  }
  /* SVG estático (sem movimento) para o seletor do editor e os menus: base + detalhe com a classe ic-ax */
  function iconSVG(k, cls) {
    var ic = icFind(k); if (!ic) return '';
    var acc = icParts(ic.a).map(function (p) { return p.replace(/^<(\w+)/, '<$1 class="ic-ax"'); }).join('');
    return '<svg class="' + (cls || 'icx') + '" viewBox="0 0 24 24" aria-hidden="true">' + icParts(ic.b).join('') + acc + '</svg>';
  }
  R.ICONS = AMICONS; R.ICON_GROUPS = AMICON_GROUPS; R.ICON_MORPHS = AMICON_MORPHS; R.IC_MO = IC_MO; R.IC_TRIGS = TRIGS; R.iconSVG = iconSVG; R.iconFind = icFind;
  R.FX.icon = {
    name: 'Ícone animado', cat: 'Ícones animados', kw: 'ícone icone ícones animados icon motion pictograma símbolo desenho traço lordicon', w: 120, h: 120, anim: { in: 'draw', dur: 900 }, variant: 'auto',
    gal: 'icon', vtitle: 'Movimento do ícone', tip: 'Na apresentação, o ícone se desenha ao entrar e se move conforme o gatilho escolhido em “Quando se move”.',
    variants: [['auto', 'Padrão do ícone', IC_TIP.auto]].concat(Object.keys(IC_MO).map(function (k) { return [k, IC_MO[k][0], IC_TIP[k]]; })),
    data: { name: 'target', trig: 'in-hover', color: '#002A46', accent: '#F78C16', bg: 'none', stroke: 1.85, label: '' },
    fields: [['name', 'Ícone', 'icon'], ['trig', 'Quando se move', 'sel:' + TRIGS.map(function (t) { return t[0] + '=' + t[1]; }).join('|')],
      ['color', 'Cor do traço', 'sel:#002A46=Navy|#FFFFFF=Branco|#43698F=Azul-aço'], ['accent', 'Cor do detalhe', 'sel:#F78C16=Laranja|#002A46=Navy|#7EA1C3=Azul-aço claro|#FFFFFF=Branco'],
      ['bg', 'Fundo', 'sel:none=Sem fundo|soft=Quadrado gelo|circle=Círculo gelo|ring=Anel|navy=Círculo navy'], ['stroke', 'Espessura do traço', 'sel:1.5=Fina|1.85=Média|2.25=Grossa'], ['label', 'Legenda (opcional)']],
    html: function (d, w, h, el) {
      var ic = icFind(d.name) || AMICONS[0], def = ic.m.split(':')[0], v = el && el.variant && el.variant !== 'auto' && IC_MO.hasOwnProperty(el.variant) ? el.variant : def, isDef = v === def, spec = IC_MO[v];
      var tg = isDef && /:a$/.test(ic.m) ? 'a' : spec[1]; if (tg === 'a' && !ic.a) tg = 'w';
      var a = (el && el.anim) || {}, draw = a.in === 'draw', r = icSVG(ic.b, ic.a, tg), t = +a.dur || (draw ? 1000 : 700);
      var tr = TRK.indexOf(d.trig) >= 0 ? d.trig : 'in-hover';
      /* o movimento contínuo começa depois da entrada: desenho = duração + (traços - 1) × 110 ms + 250 ms; outras entradas = duração + 150 ms */
      var t0 = tr === 'loop' ? 0 : (draw ? t + (r.n - 1) * 110 + 250 : (a.in && a.in !== 'none' ? t + 150 : 0));
      var vars = '--t0:' + t0 + 'ms;--md:' + spec[2] + 'ms;--ms:' + spec[3] + 'ms;' + (isDef && ic.o ? ic.o + ';' : '');
      return wrap(d, w, h, r.svg, ' data-mo="' + v + '" data-tr="' + tr + '" data-ms="' + (spec[2] + spec[3] * 6) + '"', vars);
    }
  };
  R.FX.iconmorph = {
    name: 'Ícone que se transforma', cat: 'Ícones animados', kw: 'ícone icone transformação morph troca estado antes depois problema solução', w: 120, h: 120, anim: { in: 'zoom' }, variant: 'loop',
    gal: 'one', flip: true, vtitle: 'Como alterna', /* flip: o desenho pode ser espelhado (Girar e inverter), como no ícone animado */ tip: 'O estado A aparece na cor do traço; o estado B, na cor do detalhe.',
    variants: [['loop', 'Alternando sozinho', 'Mostra o estado A e o estado B, alternando a cada 2,2 s.'], ['click', 'Ao clicar', 'Na apresentação, cada clique alterna entre os dois estados.']],
    data: { pair: 'alert-check', color: '#002A46', accent: '#F78C16', bg: 'circle', stroke: 1.85, label: '' },
    fields: [['pair', 'Transformação', 'sel:' + AMICON_MORPHS.map(function (m) { return m[0] + '=' + m[1]; }).join('|')], ['color', 'Cor do estado A', 'sel:#002A46=Navy|#FFFFFF=Branco|#43698F=Azul-aço'], ['accent', 'Cor do estado B', 'sel:#F78C16=Laranja|#002A46=Navy|#FFFFFF=Branco'], ['bg', 'Fundo', 'sel:none=Sem fundo|soft=Quadrado gelo|circle=Círculo gelo|ring=Anel|navy=Círculo navy'], ['label', 'Legenda (opcional)']],
    html: function (d, w, h, el) {
      var M = AMICON_MORPHS[0]; AMICON_MORPHS.forEach(function (m) { if (m[0] === d.pair) M = m; });
      function g(key, cls) { var ic = icFind(key), m = ic ? ic.b + (ic.a || '') : (AMICON_GLYPHS[key] || ''); return '<g class="ic-st ' + cls + '">' + icParts(m).map(function (p) { return p.replace(/^<(\w+)/, '<$1 class="ic-s" pathLength="1" style="--k:0"'); }).join('') + '</g>'; }
      return wrap(d, w, h, g(M[2], 'ic-sa') + g(M[3], 'ic-sb'), ' data-mo="morph" data-tr="' + ((el && el.variant) === 'click' ? 'click' : 'loop') + '"');
    }
  };
  /* gatilhos no player (delegado, como a inclinação 3D): passar o mouse ou clicar toca o movimento uma vez, até o fim;
     o clique alterna a transformação e não deixa o clique cair na zona de avançar slide (18% laterais) */
  R.bindIcons = function (root) {
    function go(f) { if (!f || f.classList.contains('ic-go')) return; f.classList.add('ic-go'); setTimeout(function () { f.classList.remove('ic-go'); }, +f.dataset.ms || 2000); }
    root.addEventListener('pointerover', function (e) { var f = e.target.closest && e.target.closest('.fxic[data-tr=in-hover],.fxic[data-tr=hover],.fxic[data-tr=boomerang]'); if (f) go(f); });
    root.addEventListener('click', function (e) {
      var f = e.target.closest && e.target.closest('.fxic[data-tr=click]'); if (!f) return;
      e.stopPropagation();
      if (f.dataset.mo === 'morph') f.classList.toggle('ic-on'); else go(f);
    });
  };
  R.hooks.player.push(function (hd) { R.bindIcons(hd.deckEl); });
})(window.AMRT);
