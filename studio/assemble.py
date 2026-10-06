"""Monta AM-Studio-Editor.html (arquivo único). Uso: python3 assemble.py [saida.html]

Extensões (opcionais, concatenadas em ordem alfabética):
  rt-*.js / rt-*.css  -> DENTRO de <script id="am-runtime"> / <style id="am-runtime-css">, logo depois de
                         runtime.js / runtime.css; por isso vão junto em todo arquivo exportado (exportHTML).
  ed-*.js             -> só no editor: um <script id="am-ed-..."> por arquivo, depois de editor.js.
  ed-*.css            -> só no editor: <style id="am-ed-css"> no <head>.
  xedit.js            -> inerte no editor (<script type="text/plain" id="am-xedit">), para o arquivo exportado.
  history.js          -> só no editor (<script id="am-history">), antes da capa.
"""
import base64, glob, os, re, shutil, subprocess, sys
B = '../am/brand/'
def uri(f): return 'data:image/png;base64,' + base64.b64encode(open(B + f, 'rb').read()).decode()
def rd(f): return open(f, encoding='utf-8').read() if os.path.exists(f) else ''
def ext(pat): return sorted(glob.glob(pat))
out = sys.argv[1] if len(sys.argv) > 1 else 'AM-Studio-Editor.html'

RTJS, RTCSS, EDJS, EDCSS = ext('rt-*.js'), ext('rt-*.css'), ext('ed-*.js'), ext('ed-*.css')
# extensões: sintaxe conferida antes de montar (um erro num rt-*.js derrubaria o runtime inteiro)
node = shutil.which('node')
if node:
    for f in RTJS + EDJS + [x for x in ('xedit.js', 'history.js') if os.path.exists(x)]:
        r = subprocess.run([node, '--check', f], capture_output=True, text=True)
        assert r.returncode == 0, 'erro de sintaxe em %s:\n%s' % (f, r.stderr)

h = rd('editor.html')
js = rd('editor.js')
cjs = rd('cover.js'); ccss = rd('cover.css'); chtml = rd('cover.html')
edjs = [(f, rd(f)) for f in EDJS]
for k, f in {'%%LOGO_PERF_W%%': 'logo-perf.png', '%%LOGO_PERF_N%%': 'logo-perf-navy.png', '%%WM_W%%': 'wordmark-white.png', '%%WM_N%%': 'wordmark-navy.png'}.items():
    u = uri(f)
    js = js.replace(k, u); cjs = cjs.replace(k, u); chtml = chtml.replace(k, u); h = h.replace(k, u)
    edjs = [(n, t.replace(k, u)) for n, t in edjs]
# S34: slides institucionais A&M — specs JSON em inst/*.json (imagens relativas viram data:) entram em ed-45-institucional.js no lugar de /*%%INST_SPECS%%*/null
import json
INST = {}
for name in ('cover', 'map', 'clients', 'spheres', 'chain'):
    p = os.path.join('inst', name + '.json')
    if not os.path.exists(p): continue
    spec = json.load(open(p, encoding='utf-8'))
    def inl(src):
        if not src or src.startswith('data:'): return src
        f = os.path.join('inst', src); ext = os.path.splitext(f)[1].lower()
        mime = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/svg+xml' if ext == '.svg' else 'image/' + ext.lstrip('.')
        return 'data:' + mime + ';base64,' + base64.b64encode(open(f, 'rb').read()).decode()
    if spec.get('bgImg'): spec['bgImg'] = inl(spec['bgImg'])
    for e in spec.get('els', []):
        if e.get('type') == 'image' and e.get('src'): e['src'] = inl(e['src'])
    INST[name] = spec
if INST:
    lit = json.dumps(INST, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    edjs = [(n, t.replace('/*%%INST_SPECS%%*/null', lit)) for n, t in edjs]
# ';' entre arquivos: um arquivo terminado em "})(window.AMRT)" sem ponto e vírgula não vira chamada do próximo
rt = rd('runtime.js') + ''.join('\n;/* ---- %s ---- */\n' % f + rd(f) for f in RTJS)
css = rd('runtime.css') + ''.join('\n/* ---- %s ---- */\n' % f + rd(f) for f in RTCSS)
edcss = ''.join('/* ---- %s ---- */\n' % f + rd(f) + '\n' for f in EDCSS)
xe = rd('xedit.js'); hj = rd('history.js')

alljs = rt + js + cjs + xe + hj + ''.join(t for n, t in edjs)
assert '</script' not in alljs.lower(), '"</script" no JS'
assert '</style' not in (css + ccss + edcss).lower(), '"</style" no CSS'
# CR-04: o arquivo exportado (runtime + rt-* + xedit) nunca contém onerror/onmouseover/onclick, nem em comentários
bad = re.search(r'onerror|onmouseover|onclick', rt + css + xe, re.I)
assert not bad, 'texto proibido no runtime exportado: %r' % bad.group(0)

h = h.replace('/*%%RTCSS%%*/', css).replace('/*%%RTJS%%*/', rt).replace('/*%%EDITOR%%*/', js)
if edcss: h = h.replace('</head>', '<style id="am-ed-css">' + edcss + '</style>\n</head>', 1)
if ccss: h = h.replace('</head>', '<style id="am-cover-css">' + ccss + '</style>\n</head>', 1)
if chtml: h = h.replace('<body>', '<body>\n' + chtml, 1)
if xe: h = h.replace('<script id="am-runtime">', '<script type="text/plain" id="am-xedit">' + xe + '</script>\n<script id="am-runtime">', 1)
tail = ''.join('<script id="am-' + re.sub(r'[^\w-]', '', os.path.splitext(n)[0]) + '">' + t + '</script>\n' for n, t in edjs)
if hj: tail += '<script id="am-history">' + hj + '</script>\n'
if cjs: tail += '<script id="am-cover">' + cjs + '</script>\n'
i = h.rfind('</body>'); h = h[:i] + tail + h[i:]
open(out, 'w', encoding='utf-8').write(h)
extra = RTJS + RTCSS + EDJS + EDCSS
print('ok', out, round(len(h) / 1024), 'KB' + (' · extensões: ' + ', '.join(extra) if extra else ''))
