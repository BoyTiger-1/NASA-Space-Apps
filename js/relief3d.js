// Earthset: 3D relief view of the shadow map. Plain WebGL, no libraries.
// The terrain block is drawn at true vertical scale times a user-set
// exaggeration, textured with the same lit/shadow image as the flat map.
// SI disclosure: written with the assistance of an SI coding tool (Claude).

const VS = `
attribute vec3 a;
uniform vec4 u;            // yaw, pitch, vertical exaggeration, aspect
varying vec2 v;
void main() {
  v = a.xy;
  vec3 p = vec3(a.x * 2.0 - 1.0, a.z * u.z, a.y * 2.0 - 1.0);
  float c = cos(u.x), s = sin(u.x);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  c = cos(u.y); s = sin(u.y);
  p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
  p.z -= 3.4;
  gl_Position = vec4(p.x * 2.55 / u.w, p.y * 2.55 + 0.2 * -p.z, p.z * -1.0202 - 0.20202, -p.z);
}`;
const FS = `
precision mediump float;
uniform sampler2D t;
uniform vec4 col;
varying vec2 v;
void main() { gl_FragColor = mix(texture2D(t, v), vec4(col.rgb, 1.0), col.a); }`;

export function createRelief(cv, onChange) {
  let gl = null;
  try { gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }); } catch (e) { gl = null; }
  if (!gl) return null;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  try { gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS)); } catch (e) { console.warn('3D relief unavailable:', e.message); return null; }
  gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const aLoc = gl.getAttribLocation(prog, 'a'), uLoc = gl.getUniformLocation(prog, 'u'), colLoc = gl.getUniformLocation(prog, 'col');
  const mesh = gl.createBuffer(), skirt = gl.createBuffer(), pin = gl.createBuffer(), tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [k, val] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
  const R = { yaw: -0.6, pitch: 0.62, exag: 2, ready: false, meshKey: '' };
  let nMesh = 0, nSkirt = 0;

  // h: Float32Array(N*N) heights in metres, res: metres per pixel, image: N x N canvas
  R.setData = (key, h, N, res, image) => {
    if (key !== R.meshKey) {
      R.meshKey = key;
      const half = N * res / 2, h0 = h[Math.floor(N / 2) * N + Math.floor(N / 2)], q = N - 1;
      const z = (i, j) => (h[j * N + i] - h0) / half;
      const m = new Float32Array(q * q * 18); let o = 0, lo = Infinity;
      const put = (arr, i, j, zz) => { arr[o++] = i / q; arr[o++] = j / q; arr[o++] = zz; };
      for (let j = 0; j < q; j++) for (let i = 0; i < q; i++) {
        const a = z(i, j), b = z(i + 1, j), c = z(i, j + 1), d = z(i + 1, j + 1); if (a < lo) lo = a;
        put(m, i, j, a); put(m, i + 1, j, b); put(m, i, j + 1, c); put(m, i + 1, j, b); put(m, i + 1, j + 1, d); put(m, i, j + 1, c);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh); gl.bufferData(gl.ARRAY_BUFFER, m, gl.STATIC_DRAW); nMesh = m.length / 3;
      // walls down to a flat base so the terrain reads as a solid block
      const base = lo - 0.06, sk = new Float32Array(q * 4 * 18); o = 0;
      const wall = (i0, j0, i1, j1) => { const a = z(i0, j0), b = z(i1, j1); put(sk, i0, j0, a); put(sk, i1, j1, b); put(sk, i0, j0, base); put(sk, i1, j1, b); put(sk, i1, j1, base); put(sk, i0, j0, base); };
      for (let k = 0; k < q; k++) { wall(k, 0, k + 1, 0); wall(k, q, k + 1, q); wall(0, k, 0, k + 1); wall(q, k, q, k + 1); }
      gl.bindBuffer(gl.ARRAY_BUFFER, skirt); gl.bufferData(gl.ARRAY_BUFFER, sk, gl.STATIC_DRAW); nSkirt = sk.length / 3;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    R.ready = true;
  };

  R.draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round((cv.clientWidth || 400) * dpr), hh = Math.round((cv.clientHeight || 400) * dpr);
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    gl.viewport(0, 0, w, hh); gl.clearColor(0.043, 0.043, 0.039, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!R.ready) return;
    gl.enable(gl.DEPTH_TEST); gl.useProgram(prog); gl.uniform4f(uLoc, R.yaw, R.pitch, R.exag, w / hh); gl.enableVertexAttribArray(aLoc);
    const run = (buf, n, r, g, b, a) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(aLoc, 3, gl.FLOAT, false, 0, 0); gl.uniform4f(colLoc, r, g, b, a); gl.drawArrays(gl.TRIANGLES, 0, n); };
    run(mesh, nMesh, 0, 0, 0, 0);
    run(skirt, nSkirt, 0.16, 0.155, 0.145, 1);
    // site pin: two crossed thin blades, constant height on screen
    const t = 0.22 / R.exag, e = 0.006, c = 0.5, pv = new Float32Array([c - e, c, 0, c + e, c, 0, c - e, c, t, c + e, c, 0, c + e, c, t, c - e, c, t, c, c - e, 0, c, c + e, 0, c, c - e, t, c, c + e, 0, c, c + e, t, c, c - e, t]);
    gl.bindBuffer(gl.ARRAY_BUFFER, pin); gl.bufferData(gl.ARRAY_BUFFER, pv, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(aLoc, 3, gl.FLOAT, false, 0, 0); gl.uniform4f(colLoc, 1, 0.35, 0.21, 1); gl.drawArrays(gl.TRIANGLES, 0, 12);
  };

  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; R.yaw += (e.clientX - drag.x) * 0.008; R.pitch = Math.max(0.12, Math.min(1.5, R.pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; R.draw(); if (onChange) onChange(); });
  const end = () => { drag = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('keydown', (e) => { const d = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); R.yaw += d[0]; R.pitch = Math.max(0.12, Math.min(1.5, R.pitch + d[1])); R.draw(); });
  return R;
}
