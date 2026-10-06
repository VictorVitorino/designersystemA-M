// S12: BPMN Diagram Runtime
// Task, gateway, flow, swimlane shapes with connection rendering
// Simplified shapes: task boxes, diamond gates, circle start/end, arrows

(function(){
  const SHAPES = {
    task: { w: 100, h: 60, svg: (x,y,l) => `<rect x="${x}" y="${y}" width="100" height="60" fill="#2196F3" stroke="#1976D2" stroke-width="2" rx="4"/><text x="${x+50}" y="${y+35}" text-anchor="middle" fill="white" font-size="12" font-weight="bold">${l}</text>` },
    start: { w: 40, h: 40, svg: (x,y,l) => `<circle cx="${x+20}" cy="${y+20}" r="20" fill="#4CAF50" stroke="#388E3C" stroke-width="2"/><text x="${x+20}" y="${y+25}" text-anchor="middle" fill="white" font-size="10">${l}</text>` },
    end: { w: 40, h: 40, svg: (x,y,l) => `<circle cx="${x+20}" cy="${y+20}" r="20" fill="#F44336" stroke="#D32F2F" stroke-width="2"/><text x="${x+20}" y="${y+25}" text-anchor="middle" fill="white" font-size="10">${l}</text>` },
    gateway: { w: 60, h: 60, svg: (x,y,l) => `<polygon points="${x+30},${y+0} ${x+60},${y+30} ${x+30},${y+60} ${x+0},${y+30}" fill="#FF9800" stroke="#F57C00" stroke-width="2"/><text x="${x+30}" y="${y+35}" text-anchor="middle" fill="white" font-size="10" font-weight="bold">${l}</text>` },
    swimlane: { w: 200, h: 150, svg: (x,y,l) => `<rect x="${x}" y="${y}" width="200" height="150" fill="none" stroke="#9C27B0" stroke-width="2" stroke-dasharray="5,5" rx="4"/><text x="${x+5}" y="${y+20}" fill="#9C27B0" font-size="12" font-weight="bold">${l}</text>` }
  };

  window.gxBPMN = {
    // Parse BPMN outline data into nodes and flows
    parse(outline) {
      const nodes = [];
      const flows = [];
      
      outline.forEach((item, i) => {
        const type = item.kind || 'task';
        const label = item.text || item.t || `Node ${i}`;
        const connections = item.to || [];
        
        nodes.push({
          id: `node-${i}`,
          type: type,
          label: label,
          x: (i % 4) * 150,
          y: Math.floor(i / 4) * 150
        });
        
        connections.forEach(targetIdx => {
          flows.push({
            from: `node-${i}`,
            to: `node-${targetIdx}`,
            label: item.flowLabel || ''
          });
        });
      });
      
      return { nodes, flows };
    },
    
    // Render BPMN diagram as SVG
    render(parent, outline, width=800, height=600) {
      const { nodes, flows } = this.parse(outline);
      
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('class', 'gx-bpmn-diagram');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      
      // Render flows (arrows)
      flows.forEach(flow => {
        const fromNode = nodes.find(n => n.id === flow.from);
        const toNode = nodes.find(n => n.id === flow.to);
        if (fromNode && toNode) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', fromNode.x + 50);
          line.setAttribute('y1', fromNode.y + 50);
          line.setAttribute('x2', toNode.x + 50);
          line.setAttribute('y2', toNode.y + 50);
          line.setAttribute('stroke', '#666');
          line.setAttribute('stroke-width', '2');
          line.setAttribute('marker-end', 'url(#arrowhead)');
          svg.appendChild(line);
        }
      });
      
      // Arrow marker definition
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = '<marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><polygon points="0 0, 10 3, 0 6" fill="#666" /></marker>';
      svg.appendChild(defs);
      
      // Render nodes
      nodes.forEach(node => {
        const shape = SHAPES[node.type] || SHAPES.task;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'gx-bpmn-node');
        g.setAttribute('data-node', node.id);
        g.innerHTML = shape.svg(node.x, node.y, node.label);
        svg.appendChild(g);
      });
      
      parent.appendChild(svg);
      return svg;
    },
    
    // Export BPMN as outline data
    export(svg) {
      const outline = [];
      const nodes = svg.querySelectorAll('.gx-bpmn-node');
      
      nodes.forEach((node, i) => {
        const text = node.querySelector('text');
        outline.push({
          kind: node.dataset.kind || 'task',
          text: text?.textContent || `Node ${i}`,
          to: []
        });
      });
      
      return outline;
    }
  };
})();
