// S11: Editable HTML Export + Comments
// Export presentation as contenteditable HTML with comment markers
// Each element is editable, comments are inline, history preserved

(function(){
  const COMMENT_MARKER = '<!--comment-';
  
  window.gxExportHTML = {
    // Generate contenteditable HTML from deck
    generate(deck, title) {
      let html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHTML(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; padding: 20px; }
    .slide { 
      background: white; margin: 20px auto; padding: 40px; max-width: 960px; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-radius: 8px; page-break-after: always; 
    }
    .slide[data-bg] { background: attr(data-bg); }
    .slide h1 { font-size: 32px; margin-bottom: 20px; color: #333; }
    .slide h2 { font-size: 24px; margin: 20px 0 10px; color: #555; }
    .slide p, .slide li { font-size: 16px; line-height: 1.6; color: #666; margin-bottom: 10px; }
    .slide ul, .slide ol { margin-left: 20px; }
    .slide ul li { list-style-type: disc; }
    .slide ol li { list-style-type: decimal; }
    .slide [contenteditable] { 
      outline: 2px solid transparent; padding: 2px 4px; border-radius: 2px; 
      transition: all 0.2s;
    }
    .slide [contenteditable]:focus { 
      outline: 2px solid #2196F3; background: rgba(33,150,243,0.05); 
    }
    .slide .comment { 
      position: relative; display: inline-block; padding: 0 2px; 
      background: rgba(255,193,7,0.15); border-radius: 2px;
    }
    .slide .comment-text { 
      position: absolute; bottom: 100%; left: 0; background: #fff3cd; color: #856404;
      border: 1px solid #ffc107; border-radius: 4px; padding: 6px 8px; font-size: 12px;
      white-space: nowrap; z-index: 10; box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      display: none;
    }
    .slide .comment:hover .comment-text { display: block; }
    @media print { 
      body { background: none; padding: 0; } 
      .slide { margin: 0; padding: 40px; box-shadow: none; }
      .slide [contenteditable] { outline: none; background: none; }
    }
  </style>
</head>
<body>
`;
      
      // Generate slides
      deck.slides.forEach((slide, idx) => {
        html += `<div class="slide" data-slide="${idx}" data-bg="${this.escapeHTML(slide.bg?.c || '#fff')}">\n`;
        
        // Title
        if (slide.title?.t) {
          html += `  <h1 contenteditable="true" data-field="title">${this.escapeHTML(slide.title.t)}</h1>\n`;
        }
        
        // Elements
        if (slide.els?.length > 0) {
          slide.els.forEach((el, elIdx) => {
            html += this.elementToHTML(el, elIdx);
          });
        }
        
        html += `</div>\n`;
      });
      
      html += `
</body>
</html>`;
      
      return html;
    },
    
    // Convert element to contenteditable HTML
    elementToHTML(el, idx) {
      const kind = el.kind || 'text';
      let html = '';
      
      if (kind === 'text' || kind === 'title') {
        const tag = el.size === 'h2' ? 'h2' : el.size === 'h3' ? 'h3' : 'p';
        html += `  <${tag} contenteditable="true" data-el="${idx}" data-kind="${kind}">`;
        html += this.escapeHTML(el.t || '');
        if (el.comments?.length > 0) {
          html += ` <span class="comment" data-comment="${el.comments[0].id}">`;
          html += `<span class="comment-text">${this.escapeHTML(el.comments[0].text)}</span></span>`;
        }
        html += `</${tag}>\n`;
      } else if (kind === 'shape' || kind === 'line') {
        html += `  <div contenteditable="true" data-el="${idx}" data-kind="${kind}" `;
        html += `style="padding: 10px; border: 1px solid #ddd; border-radius: 4px; margin: 10px 0;">`;
        html += `[${kind.toUpperCase()}]`;
        if (el.text) html += ` ${this.escapeHTML(el.text)}`;
        html += `</div>\n`;
      } else if (kind === 'image') {
        html += `  <figure contenteditable="true" data-el="${idx}" data-kind="image">\n`;
        html += `    <img src="${this.escapeHTML(el.src || '')}" alt="${this.escapeHTML(el.alt || '')}" style="max-width: 100%; height: auto;">\n`;
        html += `    <figcaption>${this.escapeHTML(el.caption || '')}</figcaption>\n`;
        html += `  </figure>\n`;
      }
      
      return html;
    },
    
    // Extract edits from contenteditable HTML
    extractEdits(html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const edits = {};
      
      doc.querySelectorAll('[contenteditable]').forEach(el => {
        const slideIdx = el.closest('[data-slide]')?.dataset.slide;
        const elIdx = el.dataset.el;
        const field = el.dataset.field || 'text';
        
        if (slideIdx !== undefined) {
          const key = `slide:${slideIdx}.${elIdx || 'title'}.${field}`;
          edits[key] = el.textContent || el.innerText;
        }
      });
      
      return edits;
    },
    
    // Parse comment markers from HTML
    extractComments(html) {
      const comments = [];
      const regex = /<!--comment-(\d+):(.*?)-->/g;
      let match;
      
      while ((match = regex.exec(html)) !== null) {
        comments.push({
          id: match[1],
          text: match[2]
        });
      }
      
      return comments;
    },
    
    // Escape HTML special characters
    escapeHTML(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
    
    // Download HTML file
    download(html, filename) {
      const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename || 'presentation.html';
      link.click();
      URL.revokeObjectURL(link.href);
    }
  };
})();
