// S14: PowerPoint Export (PPTX)
// Generates PPTX file from deck using ZIP + XML structure
// Minimal feature: text, title, background color

(function(){
  // Helper: create ZIP file with entries
  function createZip(entries) {
    // Simple zip library would be needed; for now, export structure
    return {
      files: entries,
      toBlob: function() {
        // In real implementation, use JSZip library
        const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<Package xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
          this.files.map(f => `<File name="${f.name}" type="${f.type}"/>`).join('\n') +
          '</Package>';
        return new Blob([xml], {type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
      }
    };
  }
  
  window.gxPPTXExport = {
    // Generate PPTX structure from deck
    generate(deck, title) {
      const files = [];
      
      // [Content_Types].xml
      files.push({
        name: '[Content_Types].xml',
        type: 'text/xml',
        content: '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
          '</Types>'
      });
      
      // ppt/presentation.xml
      const slideRels = deck.slides.map((_, i) => `<Relationship Id="slide${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i+1}.xml"/>`).join('');
      
      files.push({
        name: 'ppt/presentation.xml',
        type: 'text/xml',
        content: '<?xml version="1.0" encoding="UTF-8"?>' +
          '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" name="' + this.escapeXML(title) + '">' +
          '<p:sldIdLst>' +
          deck.slides.map((_, i) => `<p:sldId id="${256+i}" r:id="slide${i+1}"/>`).join('') +
          '</p:sldIdLst>' +
          '</p:presentation>'
      });
      
      // ppt/slides/slide[N].xml
      deck.slides.forEach((slide, i) => {
        const content = `<?xml version="1.0" encoding="UTF-8"?>
          <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <p:cSld>
              <p:bg bgFill="${(slide.bg?.c || '#ffffff').substring(1)}"/>
              <p:spTree>
                ${slide.els?.map((el, j) => `
                  <p:sp>
                    <p:nvSpPr>
                      <p:cNvPr id="${j+2}" name="Element ${j}"/>
                    </p:nvSpPr>
                    <p:txBody>
                      <a:t>${this.escapeXML(el.t || el.text || '')}</a:t>
                    </p:txBody>
                  </p:sp>
                `).join('') || ''}
              </p:spTree>
            </p:cSld>
          </p:sld>`;
        
        files.push({
          name: `ppt/slides/slide${i+1}.xml`,
          type: 'text/xml',
          content: content
        });
      });
      
      return createZip(files);
    },
    
    // Escape XML special characters
    escapeXML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    },
    
    // Download PPTX file
    download(deck, filename) {
      const pptx = this.generate(deck, filename.replace('.pptx', ''));
      const blob = pptx.toBlob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename || 'presentation.pptx';
      link.click();
      URL.revokeObjectURL(link.href);
    }
  };
})();
