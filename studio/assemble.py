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

# S37: o HTML montado vai SEM comentários, indentação e linhas vazias (as fontes continuam comentadas). Tokenizador mínimo e conservador:
# strings e regex passam intactas; comentário de várias linhas vira quebra de linha (a inserção automática de ';' do JS não muda);
# marcadores /*%%...%%*/ ficam. Cada pedaço limpo passa por node --check. AM_NOSTRIP=1 monta com os comentários (depuração).
STRIP = os.environ.get('AM_NOSTRIP') != '1'
_RE_OK = set('(,=:[!&|?{};+-*%<>~^')
_RE_KW = {'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof'}
def strip_js(s):
    if not STRIP or not s: return s
    o = []; lit = 0; i = 0; n = len(s); bol = True
    def sig():
        k = len(o) - 1
        while k >= 0 and o[k] in ' \t\n': k -= 1
        if k < 0: return '', ''
        c = o[k]
        if not (c.isalnum() or c in '_$'): return c, ''
        j = k
        while j >= 0 and (o[j].isalnum() or o[j] in '_$'): j -= 1
        return c, ''.join(o[j + 1:k + 1])
    def nl():
        nonlocal bol
        while len(o) > lit and o[-1] in ' \t': o.pop()
        if not bol: o.append('\n'); bol = True
    while i < n:
        c = s[i]
        if c == '\n': nl(); i += 1; continue
        if c in ' \t\r' and bol: i += 1; continue
        if c in '"\'`':
            j = i + 1
            while j < n and s[j] != c: j += 2 if s[j] == '\\' else 1
            o.extend(s[i:j + 1]); lit = len(o); bol = False; i = j + 1; continue
        if c == '/' and s.startswith('//', i):
            j = s.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and s.startswith('/*', i):
            j = s.find('*/', i + 2); j = n if j < 0 else j + 2; body = s[i:j]
            if body.startswith('/*%%'): o.extend(body); lit = len(o); bol = False
            elif '\n' in body: nl()
            elif not bol and o[-1] not in ' \t': o.append(' ')
            i = j; continue
        if c == '/':
            p, w = sig()
            if not p or p in _RE_OK or w in _RE_KW:
                j = i + 1; cls = False
                while j < n and s[j] != '\n':
                    if s[j] == '\\': j += 2; continue
                    if s[j] == '[': cls = True
                    elif s[j] == ']': cls = False
                    elif s[j] == '/' and not cls: break
                    j += 1
                if j < n and s[j] == '/':
                    j += 1
                    while j < n and s[j].isalpha(): j += 1
                    o.extend(s[i:j]); lit = len(o); bol = False; i = j; continue
        o.append(c); bol = False; i += 1
    return ''.join(o).strip('\n') + '\n'
def strip_css(s):
    if not STRIP or not s: return s
    o = []; i = 0; n = len(s)
    while i < n:
        c = s[i]
        if c in '"\'':
            j = i + 1
            while j < n and s[j] != c: j += 2 if s[j] == '\\' else 1
            o.append(s[i:j + 1]); i = j + 1; continue
        if s.startswith('/*', i) and not s.startswith('/*%%', i):
            j = s.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        j = i + 1
        while j < n and s[j] not in '"\'/': j += 1
        o.append(s[i:j]); i = j
    return re.sub(r'\n[ \t]*(?=\n)|(?<=\n)[ \t]+', '', ''.join(o))

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
rtraw = rd('runtime.js') + ''.join(rd(f) for f in RTJS); cssraw = rd('runtime.css') + ''.join(rd(f) for f in RTCSS); xeraw = rd('xedit.js')
rt = strip_js(rd('runtime.js')) + ''.join('\n;/* ---- %s ---- */\n' % f + strip_js(rd(f)) for f in RTJS)
css = strip_css(rd('runtime.css')) + ''.join('\n/* ---- %s ---- */\n' % f + strip_css(rd(f)) for f in RTCSS)
edcss = ''.join('/* ---- %s ---- */\n' % f + strip_css(rd(f)) + '\n' for f in EDCSS)
xe = strip_js(xeraw); hj = strip_js(rd('history.js'))
js = strip_js(js); cjs = strip_js(cjs); ccss = strip_css(ccss); edjs = [(n, strip_js(t)) for n, t in edjs]
h = re.sub(r'(<style[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + strip_css(m.group(2)) + m.group(3), h, flags=re.S)
if node and STRIP:  # o que foi limpo continua JS válido (um erro do tokenizador derrubaria o editor inteiro)
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        for nm, t in [('editor.js', js), ('cover.js', cjs), ('history.js', hj), ('runtime+rt.js', rt)] + edjs:
            if not t: continue
            fp = os.path.join(td, re.sub(r'[^\w.+-]', '_', nm)); open(fp, 'w', encoding='utf-8').write(t)
            r = subprocess.run([node, '--check', fp], capture_output=True, text=True)
            assert r.returncode == 0, 'limpeza de comentários quebrou %s:\n%s' % (nm, r.stderr)

alljs = rt + js + cjs + xe + hj + ''.join(t for n, t in edjs)
assert '</script' not in alljs.lower(), '"</script" no JS'
assert '</style' not in (css + ccss + edcss).lower(), '"</style" no CSS'
# CR-04: o arquivo exportado (runtime + rt-* + xedit) nunca contém onerror/onmouseover/onclick, nem em comentários
bad = re.search(r'onerror|onmouseover|onclick', rtraw + cssraw + xeraw + rt + css + xe, re.I)
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
