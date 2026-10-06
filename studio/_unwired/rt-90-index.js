// S9: Index + Timeline + Slide Summary
// Outline view with thumbnails, timeline scrubber, and slide summary panels
// Integration: AMRT.indexPanel (player overlay), AMRT.indexDrawer (editor drawer)

(function(){
  const CACHE = new Map();
  
  window.gxIndex = {
    // Generate thumbnail for slide (small preview image)
    thumbnail(slide, w=120, h=90) {
      const key = JSON.stringify(slide) + '::' + w + 'x' + h;
      if (CACHE.has(key)) return CACHE.get(key);
      
      // Canvas-based thumbnail generation
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      
      // Background
      ctx.fillStyle = slide.bg?.c || '#ffffff';
      ctx.fillRect(0, 0, w, h);
      
      // Title (small text)
      ctx.fillStyle = '#333';
      ctx.font = 'bold 8px sans-serif';
      ctx.textBaseline = 'top';
      const title = slide.title?.t || 'Slide ' + (slide.i || 1);
      ctx.fillText(title.substring(0, 15), 4, 4);
      
      // Element count badge
      ctx.fillStyle = '#2196F3';
      ctx.font = '6px sans-serif';
      const count = (slide.els || []).length;
      ctx.fillText(count + ' els', w - 22, h - 10);
      
      const url = canvas.toDataURL();
      CACHE.set(key, url);
      return url;
    },
    
    // Render index drawer (outline + thumbnails)
    renderDrawer(parent, deck, onSelect) {
      const drawer = document.createElement('div');
      drawer.className = 'gx-index-drawer';
      
      const title = document.createElement('h3');
      title.textContent = `Índice (${deck.slides.length} slides)`;
      drawer.appendChild(title);
      
      const list = document.createElement('div');
      list.className = 'gx-index-list';
      
      deck.slides.forEach((slide, i) => {
        const item = document.createElement('div');
        item.className = 'gx-index-item';
        item.dataset.slide = i;
        
        // Thumbnail
        const thumb = document.createElement('img');
        thumb.src = this.thumbnail(slide);
        thumb.alt = 'Slide ' + (i + 1);
        item.appendChild(thumb);
        
        // Metadata
        const meta = document.createElement('div');
        meta.className = 'gx-index-meta';
        
        const num = document.createElement('span');
        num.className = 'gx-index-num';
        num.textContent = String(i + 1);
        meta.appendChild(num);
        
        const desc = document.createElement('span');
        desc.className = 'gx-index-desc';
        desc.textContent = (slide.title?.t || '').substring(0, 20) || '(sem título)';
        meta.appendChild(desc);
        
        item.appendChild(meta);
        
        // Click handler
        item.addEventListener('click', () => {
          onSelect(i);
          drawer.querySelectorAll('.gx-index-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
        });
        
        list.appendChild(item);
      });
      
      drawer.appendChild(list);
      parent.appendChild(drawer);
      return drawer;
    },
    
    // Render timeline scrubber (horizontal position control)
    renderTimeline(parent, deck, current, onChange) {
      const timeline = document.createElement('div');
      timeline.className = 'gx-timeline';
      
      const track = document.createElement('div');
      track.className = 'gx-timeline-track';
      
      const progress = document.createElement('div');
      progress.className = 'gx-timeline-progress';
      progress.style.width = ((current / deck.slides.length) * 100) + '%';
      track.appendChild(progress);
      
      const handle = document.createElement('div');
      handle.className = 'gx-timeline-handle';
      handle.style.left = ((current / deck.slides.length) * 100) + '%';
      track.appendChild(handle);
      
      let dragging = false;
      const updatePos = (e) => {
        const rect = track.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const slide = Math.min(deck.slides.length - 1, Math.max(0, Math.floor(pos * deck.slides.length)));
        onChange(slide);
        progress.style.width = ((slide / deck.slides.length) * 100) + '%';
        handle.style.left = ((slide / deck.slides.length) * 100) + '%';
      };
      
      track.addEventListener('mousedown', (e) => {
        dragging = true;
        updatePos(e);
      });
      
      document.addEventListener('mousemove', (e) => {
        if (dragging) updatePos(e);
      });
      
      document.addEventListener('mouseup', () => {
        dragging = false;
      });
      
      timeline.appendChild(track);
      parent.appendChild(timeline);
      return timeline;
    },
    
    // Render slide summary panel (key info about current slide)
    renderSummary(parent, slide) {
      const summary = document.createElement('div');
      summary.className = 'gx-slide-summary';
      
      const header = document.createElement('div');
      header.className = 'gx-summary-header';
      
      const title = document.createElement('h4');
      title.textContent = slide.title?.t || '(sem título)';
      header.appendChild(title);
      
      const info = document.createElement('div');
      info.className = 'gx-summary-info';
      info.innerHTML = `
        <span class="gx-summary-stat">
          <strong>${(slide.els || []).length}</strong> elementos
        </span>
        <span class="gx-summary-stat">
          Fundo: <strong>${slide.bg?.c || '#fff'}</strong>
        </span>
      `;
      header.appendChild(info);
      
      summary.appendChild(header);
      
      // Element list (scrollable)
      if (slide.els?.length > 0) {
        const elList = document.createElement('div');
        elList.className = 'gx-summary-elements';
        
        slide.els.forEach((el, i) => {
          const elItem = document.createElement('div');
          elItem.className = 'gx-summary-element';
          elItem.textContent = `${el.kind || 'shape'} #${i}`;
          elList.appendChild(elItem);
        });
        
        summary.appendChild(elList);
      }
      
      parent.appendChild(summary);
      return summary;
    }
  };
})();
