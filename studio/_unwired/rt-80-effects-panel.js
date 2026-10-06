// S8: Effect Controls Panel
// Timing controls (duration, delay, easing, repeat, offset, stagger) with live preview
// Integration: gxEdit.fx() reads/writes effect.timing object
// UI: Drawer panel "Efeito" tab ▸ "Tempo" section

(function(){
  const EASINGS = [
    'linear',
    'ease', 'ease-in', 'ease-out', 'ease-in-out',
    'cubic-bezier(0.25,0.8,0.25,1)',      // smooth
    'cubic-bezier(0.42,0,0.58,1)',        // smooth-in-out
    'cubic-bezier(0.5,0,0.5,1)',          // bounce-light
    'cubic-bezier(0.68,-0.55,0.265,1.55)' // back-out
  ];
  
  const DEFAULTS = {
    duration: 800,      // ms
    delay: 0,           // ms  
    easing: 'ease-out',
    repeat: 0,          // 0 = once, 1 = repeat once more, etc.
    offset: 0,          // stagger offset per item (ms)
    stagger: 0          // per-child delay (ms)
  };

  window.gxEffectPanel = {
    // Render timing controls in "Tempo" drawer section
    render(parent, effect) {
      const sec = document.createElement('div');
      sec.className = 'gx-effect-timing';
      
      // Duration slider (100–5000 ms, step 50)
      const durRow = document.createElement('div');
      durRow.className = 'gx-control-row';
      durRow.innerHTML = `
        <label>Duração</label>
        <input type="range" class="gx-duration-slider" min="100" max="5000" step="50" 
               value="${effect.timing?.duration || DEFAULTS.duration}">
        <span class="gx-duration-display">${effect.timing?.duration || DEFAULTS.duration}ms</span>
      `;
      sec.appendChild(durRow);
      
      // Delay slider (0–2000 ms, step 50)
      const delRow = document.createElement('div');
      delRow.className = 'gx-control-row';
      delRow.innerHTML = `
        <label>Atraso</label>
        <input type="range" class="gx-delay-slider" min="0" max="2000" step="50" 
               value="${effect.timing?.delay || DEFAULTS.delay}">
        <span class="gx-delay-display">${effect.timing?.delay || DEFAULTS.delay}ms</span>
      `;
      sec.appendChild(delRow);
      
      // Easing dropdown
      const easRow = document.createElement('div');
      easRow.className = 'gx-control-row';
      easRow.innerHTML = '<label>Suavização</label>';
      const easDropdown = document.createElement('select');
      easDropdown.className = 'gx-easing-select';
      EASINGS.forEach(eas => {
        const opt = document.createElement('option');
        opt.value = eas;
        opt.textContent = eas.split('(')[0];
        opt.selected = (effect.timing?.easing === eas);
        easDropdown.appendChild(opt);
      });
      easRow.appendChild(easDropdown);
      sec.appendChild(easRow);
      
      // Repeat count (0–10)
      const repRow = document.createElement('div');
      repRow.className = 'gx-control-row';
      repRow.innerHTML = `
        <label>Repetir</label>
        <input type="range" class="gx-repeat-slider" min="0" max="10" step="1" 
               value="${effect.timing?.repeat || DEFAULTS.repeat}">
        <span class="gx-repeat-display">${effect.timing?.repeat || DEFAULTS.repeat}×</span>
      `;
      sec.appendChild(repRow);
      
      // Stagger offset (0–500 ms per item)
      const stagRow = document.createElement('div');
      stagRow.className = 'gx-control-row';
      stagRow.innerHTML = `
        <label>Desvio (itens)</label>
        <input type="range" class="gx-stagger-slider" min="0" max="500" step="25" 
               value="${effect.timing?.stagger || DEFAULTS.stagger}">
        <span class="gx-stagger-display">${effect.timing?.stagger || DEFAULTS.stagger}ms</span>
      `;
      sec.appendChild(stagRow);
      
      // Event handlers with live preview
      const updatePreview = () => {
        if (!window.gxPreview || !window.gxPreview.updateEffectTiming) return;
        const timing = {
          duration: parseFloat(sec.querySelector('.gx-duration-slider').value),
          delay: parseFloat(sec.querySelector('.gx-delay-slider').value),
          easing: sec.querySelector('.gx-easing-select').value,
          repeat: parseInt(sec.querySelector('.gx-repeat-slider').value),
          stagger: parseFloat(sec.querySelector('.gx-stagger-slider').value)
        };
        effect.timing = timing;
        window.gxPreview.updateEffectTiming(effect);
        // Update display values
        sec.querySelector('.gx-duration-display').textContent = timing.duration + 'ms';
        sec.querySelector('.gx-delay-display').textContent = timing.delay + 'ms';
        sec.querySelector('.gx-repeat-display').textContent = timing.repeat + '×';
        sec.querySelector('.gx-stagger-display').textContent = timing.stagger + 'ms';
      };
      
      sec.querySelector('.gx-duration-slider').addEventListener('input', updatePreview);
      sec.querySelector('.gx-delay-slider').addEventListener('input', updatePreview);
      sec.querySelector('.gx-easing-select').addEventListener('change', updatePreview);
      sec.querySelector('.gx-repeat-slider').addEventListener('input', updatePreview);
      sec.querySelector('.gx-stagger-slider').addEventListener('input', updatePreview);
      
      return sec;
    },
    
    // Apply timing CSS to animated element
    applyTiming(el, effect) {
      const t = effect.timing || DEFAULTS;
      const repeatCount = t.repeat > 0 ? `${t.repeat + 1}` : '1';
      const animDelay = t.delay + (t.stagger * (el.gxItemIndex || 0));
      
      el.style.animationDuration = t.duration + 'ms';
      el.style.animationDelay = animDelay + 'ms';
      el.style.animationTimingFunction = t.easing;
      el.style.animationIterationCount = repeatCount;
      el.style.animationFillMode = 'both';
    },
    
    // Generate animation CSS for timeline scrubber preview
    generateCSS(selector, effect) {
      const t = effect.timing || DEFAULTS;
      const repeatCount = t.repeat > 0 ? `${t.repeat + 1}` : '1';
      return `
        ${selector} {
          animation-duration: ${t.duration}ms;
          animation-delay: ${t.delay}ms;
          animation-timing-function: ${t.easing};
          animation-iteration-count: ${repeatCount};
          animation-fill-mode: both;
        }
      `;
    }
  };
})();
