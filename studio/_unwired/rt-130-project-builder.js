// S13: Project Builder / Template System
// Predefined layouts and templates for quick start

(function(){
  const TEMPLATES = {
    pitch: {
      name: 'Pitch Deck',
      slides: [
        {title:{t:'Problema'}, els:[{kind:'text',t:'Qual é o problema?'}]},
        {title:{t:'Solução'}, els:[{kind:'text',t:'Como você resolve?'}]},
        {title:{t:'Mercado'}, els:[{kind:'text',t:'Tamanho do mercado'}]},
        {title:{t:'Modelo'}, els:[{kind:'text',t:'Como ganha dinheiro?'}]},
        {title:{t:'Team'}, els:[{kind:'text',t:'Quem executa?'}]}
      ]
    },
    proposal: {
      name: 'Proposta Comercial',
      slides: [
        {title:{t:'Executivo'}, els:[{kind:'text',t:'Resumo 1 página'}]},
        {title:{t:'Escopo'}, els:[{kind:'text',t:'O que será entregue'}]},
        {title:{t:'Timeline'}, els:[{kind:'text',t:'Quando será entregue'}]},
        {title:{t:'Investimento'}, els:[{kind:'text',t:'Quanto custa'}]},
        {title:{t:'Próximos passos'}, els:[{kind:'text',t:'Como começamos'}]}
      ]
    },
    report: {
      name: 'Relatório Executivo',
      slides: [
        {title:{t:'Índice'}, els:[{kind:'text',t:'Navegação do documento'}]},
        {title:{t:'Contexto'}, els:[{kind:'text',t:'Situação atual'}]},
        {title:{t:'Análise'}, els:[{kind:'text',t:'Dados e insights'}]},
        {title:{t:'Recomendações'}, els:[{kind:'text',t:'Próximos passos recomendados'}]},
        {title:{t:'Conclusão'}, els:[{kind:'text',t:'Resumo executivo'}]}
      ]
    }
  };
  
  window.gxProjectBuilder = {
    // List available templates
    listTemplates() {
      return Object.entries(TEMPLATES).map(([id, tpl]) => ({
        id,
        name: tpl.name,
        slides: tpl.slides.length
      }));
    },
    
    // Get template by ID
    getTemplate(id) {
      return TEMPLATES[id];
    },
    
    // Create deck from template
    createFromTemplate(id) {
      const template = TEMPLATES[id];
      if (!template) return null;
      
      return {
        title: template.name,
        slides: JSON.parse(JSON.stringify(template.slides)), // Deep copy
        created: new Date().toISOString()
      };
    },
    
    // Render template picker
    renderPicker(parent, onSelect) {
      const picker = document.createElement('div');
      picker.className = 'gx-template-picker';
      
      const title = document.createElement('h3');
      title.textContent = 'Começar com um template';
      picker.appendChild(title);
      
      const grid = document.createElement('div');
      grid.className = 'gx-template-grid';
      
      this.listTemplates().forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'gx-template-card';
        card.innerHTML = `
          <div class="gx-template-icon">📄</div>
          <h4>${tpl.name}</h4>
          <p>${tpl.slides} slides</p>
        `;
        card.addEventListener('click', () => onSelect(tpl.id));
        grid.appendChild(card);
      });
      
      picker.appendChild(grid);
      parent.appendChild(picker);
      return picker;
    }
  };
})();
