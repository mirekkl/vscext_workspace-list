/**
 * Self-contained inline color picker for VS Code webviews.
 *
 * This module has no dependency on the host extension beyond plain strings/DOM APIs, so it can
 * be lifted into its own package: it exports pure functions that return CSS/HTML/JS fragments to
 * splice into a webview's document. It renders a popover (hue/saturation area + swatches + hex
 * input) anchored to a trigger element, opened on a single click; double-clicking a color choice
 * (a swatch, or the saturation/hue area) both applies and closes it - filling the gap that native
 * <input type="color"> pickers can't offer (they're OS chrome with no scriptable "accept & close").
 *
 * Usage inside a webview's HTML template:
 *   ${colorPickerStyles()}
 *   ... <button id="myTrigger" class="color-dot"></button> ...
 *   <script nonce="...">${colorPickerScript()}
 *     const picker = createColorPicker({
 *       trigger: document.getElementById('myTrigger'),
 *       initialColor: '#808080',
 *       presets: [...],
 *       onChange: (hex) => { ... live preview ... },
 *       onCommit: (hex) => { ... double-click confirm ... },
 *     });
 *   </script>
 */

export function colorPickerStyles(): string {
  return /* css */ `
  .cp-popover {
    position: absolute; z-index: 1000; padding: 12px; border-radius: 4px;
    background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, transparent));
    box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    width: 216px; display: none;
  }
  .cp-popover.open { display: block; }
  .cp-hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; line-height: 1.4; }
  .cp-sv {
    position: relative; width: 100%; height: 120px; border-radius: 3px; cursor: crosshair;
    background-image: linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0));
    margin-bottom: 10px; user-select: none;
  }
  .cp-sv-thumb {
    position: absolute; width: 10px; height: 10px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.6);
    transform: translate(-50%, -50%); pointer-events: none;
  }
  .cp-hue {
    position: relative; width: 100%; height: 12px; border-radius: 6px; cursor: pointer;
    background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
    margin-bottom: 10px; user-select: none;
  }
  .cp-hue-thumb {
    position: absolute; top: -2px; width: 16px; height: 16px; border-radius: 50%;
    border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,0.6);
    transform: translateX(-50%); pointer-events: none; background: transparent;
  }
  .cp-swatches { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .cp-swatch {
    width: 20px; height: 20px; border-radius: 4px; cursor: pointer;
    border: 2px solid transparent; padding: 0; box-sizing: border-box;
  }
  .cp-swatch:hover, .cp-swatch:focus { border-color: var(--vscode-focusBorder); }
  .cp-hex-row { display: flex; gap: 6px; align-items: center; }
  .cp-hex-input {
    flex: 1 1 auto; min-width: 0; font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-settings-textInputBackground, var(--vscode-input-background));
    color: var(--vscode-settings-textInputForeground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-settings-textInputBorder, var(--vscode-input-border, transparent));
    border-radius: 2px; padding: 5px 7px; font-size: 12px;
  }
  `;
}

/** Returns the picker's runtime JS as a raw string; embed it inside a <script nonce="..."> tag. */
export function colorPickerScript(): string {
  return /* js */ `
  function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  function hsvToHex(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  const CP_HEX_RE = /^#[0-9a-fA-F]{6}$/;

  function createColorPicker(opts) {
    const { trigger, initialColor, presets = [], onChange, onCommit } = opts;

    const popover = document.createElement('div');
    popover.className = 'cp-popover';
    popover.innerHTML =
      '<div class="cp-hint">Click to preview, double-click to apply and close.</div>' +
      '<div class="cp-sv"><div class="cp-sv-thumb"></div></div>' +
      '<div class="cp-hue"><div class="cp-hue-thumb"></div></div>' +
      '<div class="cp-swatches"></div>' +
      '<div class="cp-hex-row"><input type="text" class="cp-hex-input" spellcheck="false" /></div>';
    document.body.appendChild(popover);

    const svEl = popover.querySelector('.cp-sv');
    const svThumb = popover.querySelector('.cp-sv-thumb');
    const hueEl = popover.querySelector('.cp-hue');
    const hueThumb = popover.querySelector('.cp-hue-thumb');
    const swatchesEl = popover.querySelector('.cp-swatches');
    const hexInput = popover.querySelector('.cp-hex-input');

    let hsv = hexToHsv(/^#[0-9a-fA-F]{6}$/.test(initialColor) ? initialColor : '#808080');
    let isOpen = false;

    function currentHex() {
      return hsvToHex(hsv.h, hsv.s, hsv.v);
    }

    function updateSvBackground() {
      const hueHex = hsvToHex(hsv.h, 1, 1);
      svEl.style.backgroundColor = hueHex;
    }

    function positionThumbs() {
      svThumb.style.left = (hsv.s * 100) + '%';
      svThumb.style.top = ((1 - hsv.v) * 100) + '%';
      hueThumb.style.left = ((hsv.h / 360) * 100) + '%';
    }

    function syncHex(hex) {
      hexInput.value = hex;
    }

    function renderSwatches() {
      swatchesEl.innerHTML = '';
      presets.forEach((hex) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cp-swatch';
        btn.style.background = hex;
        btn.title = hex;
        btn.addEventListener('click', () => {
          hsv = hexToHsv(hex);
          refresh();
          if (onChange) onChange(currentHex());
        });
        btn.addEventListener('dblclick', () => {
          hsv = hexToHsv(hex);
          refresh();
          commitAndClose();
        });
        swatchesEl.appendChild(btn);
      });
    }

    function refresh() {
      updateSvBackground();
      positionThumbs();
      syncHex(currentHex());
    }

    function commitAndClose() {
      if (onCommit) onCommit(currentHex());
      close();
    }

    function pointFromEvent(el, evt) {
      const rect = el.getBoundingClientRect();
      const x = Math.min(Math.max(evt.clientX - rect.left, 0), rect.width);
      const y = Math.min(Math.max(evt.clientY - rect.top, 0), rect.height);
      return { x: x / rect.width, y: y / rect.height };
    }

    function handleSvPointer(evt, isDouble) {
      const p = pointFromEvent(svEl, evt);
      hsv.s = p.x;
      hsv.v = 1 - p.y;
      refresh();
      if (isDouble) { commitAndClose(); return; }
      if (onChange) onChange(currentHex());
    }

    function handleHuePointer(evt, isDouble) {
      const p = pointFromEvent(hueEl, evt);
      hsv.h = p.x * 360;
      refresh();
      if (isDouble) { commitAndClose(); return; }
      if (onChange) onChange(currentHex());
    }

    let dragTarget = null;
    svEl.addEventListener('mousedown', (e) => { dragTarget = 'sv'; handleSvPointer(e, false); });
    hueEl.addEventListener('mousedown', (e) => { dragTarget = 'hue'; handleHuePointer(e, false); });
    window.addEventListener('mousemove', (e) => {
      if (dragTarget === 'sv') handleSvPointer(e, false);
      else if (dragTarget === 'hue') handleHuePointer(e, false);
    });
    window.addEventListener('mouseup', () => { dragTarget = null; });
    svEl.addEventListener('dblclick', (e) => handleSvPointer(e, true));
    hueEl.addEventListener('dblclick', (e) => handleHuePointer(e, true));

    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim();
      if (CP_HEX_RE.test(v)) {
        hsv = hexToHsv(v);
        positionThumbs();
        updateSvBackground();
        if (onChange) onChange(v);
      }
    });
    hexInput.addEventListener('dblclick', () => {
      const v = hexInput.value.trim();
      if (CP_HEX_RE.test(v)) {
        hsv = hexToHsv(v);
        commitAndClose();
      }
    });
    hexInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = hexInput.value.trim();
        if (CP_HEX_RE.test(v)) { hsv = hexToHsv(v); commitAndClose(); }
      } else if (e.key === 'Escape') {
        close();
      }
    });

    function position() {
      const r = trigger.getBoundingClientRect();
      popover.style.left = (r.left + window.scrollX) + 'px';
      popover.style.top = (r.bottom + window.scrollY + 6) + 'px';
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      refresh();
      position();
      popover.classList.add('open');
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onDocKeyDown, true);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      popover.classList.remove('open');
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
    }

    function toggle() {
      if (isOpen) close(); else open();
    }

    function onDocMouseDown(e) {
      if (popover.contains(e.target) || e.target === trigger) return;
      close();
    }
    function onDocKeyDown(e) {
      if (e.key === 'Escape') close();
    }

    renderSwatches();
    trigger.addEventListener('click', toggle);

    return {
      open, close, toggle,
      setColor(hex) {
        if (CP_HEX_RE.test(hex)) { hsv = hexToHsv(hex); refresh(); }
      },
      getColor: currentHex,
      dispose() {
        close();
        popover.remove();
      },
    };
  }
  `;
}
