/* =====================================================================
   3D Exploded-View Viewer engine (v1)
   Reads product.json (or window.PRODUCT) and a .glb/.gltf model.
   You normally never edit this file: change product.json instead.
   ===================================================================== */
(function () {
'use strict';
var $ = function (s) { return document.querySelector(s); };
var V3 = function (x, y, z) { return new THREE.Vector3(x, y, z); };
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function asArr(m) { return Array.isArray(m) ? m : [m]; }

var EMBED = window.self !== window.top;
var LITE = false;
try { LITE = location.hash === '#lite' || sessionStorage.getItem('v3dlite') === '1'; } catch (e) {}

var statusEl = $('#status'), loadEl = $('#loading');
function showStatus(title, msg, offerLite) {
  statusEl.innerHTML = '<b>' + esc(title) + '</b><p>' + msg + '</p>' +
    (offerLite && !LITE ? '<button class="btn pri" id="goLite">Switch to Lite mode</button>' : '') +
    (LITE ? '<button class="btn" id="goFull">Try full quality again</button>' : '');
  statusEl.classList.remove('hide'); loadEl.classList.add('hide');
  var gl = $('#goLite'), gf = $('#goFull');
  if (gl) gl.onclick = function () { setLite(true); };
  if (gf) gf.onclick = function () { setLite(false); };
}
function setLite(on) {
  try { if (on) sessionStorage.setItem('v3dlite', '1'); else sessionStorage.removeItem('v3dlite'); } catch (e) {}
  location.hash = on ? 'lite' : ''; location.reload();
}
window.addEventListener('error', function (e) {
  if (!statusEl.classList.contains('hide')) return;
  showStatus('Something went wrong loading the 3D view', 'Error: ' + esc(e.message || 'unknown'), true);
});

/* ---------------- packages: which features each tier gets ---------------- */
var TIERS = {
  starter:  { explode: 1, drag: 1, labels: 1, partsList: 1, info: 1, specs: 0, xray: 0, wire: 0, cutaway: 0, dims: 0, compare: 0, paint: 0, animate: 0, autospin: 1, maxParts: 8,   scenes: ['studio', 'light'] },
  standard: { explode: 1, drag: 1, labels: 1, partsList: 1, info: 1, specs: 1, xray: 1, wire: 1, cutaway: 0, dims: 1, compare: 0, paint: 0, animate: 0, autospin: 1, maxParts: 20,  scenes: ['showroom', 'studio', 'light'] },
  pro:      { explode: 1, drag: 1, labels: 1, partsList: 1, info: 1, specs: 1, xray: 1, wire: 1, cutaway: 1, dims: 1, compare: 1, paint: 1, animate: 1, autospin: 1, maxParts: 999, scenes: ['showroom', 'blueprint', 'sunset', 'studio', 'light', 'day'] }
};
var SCENE_NAMES = { showroom: 'Showroom', blueprint: 'Blueprint', sunset: 'Sunset', studio: 'Studio', light: 'White', day: 'Outdoor', night: 'Night' };
var LOOKS = {
  showroom:  { top: 0xefeae3, bot: 0xd2cabf, floor: 0xf1ece5, key: 1.35, keyC: 0xfff1e0, hemi: 0.6, env: 1.0, exp: 1.0, rim: 0.45, rimC: 0xffe2c0, light: true, glow: 0xffffff, glowI: 0.35, pat: 'pool' },
  blueprint: { top: 0x0a2747, bot: 0x12416e, floor: 0x113b63, key: 1.5, keyC: 0xe6f1ff, hemi: 0.45, env: 0.85, exp: 1.05, rim: 0.9, rimC: 0x7fd3ff, light: false, glow: 0x3fa9ff, glowI: 0.35, pat: 'grid' },
  sunset:    { top: 0x1c1240, bot: 0x6b2b5e, floor: 0x24163f, key: 1.5, keyC: 0xffd2b0, hemi: 0.35, env: 0.8, exp: 1.05, rim: 1.4, rimC: 0xff7a59, light: false, glow: 0xff7a45, glowI: 0.9, pat: 'pool' },
  studio: { glow: 0x5a7fa8, glowI: 0.25, pat: 'pool', top: 0x1b2633, bot: 0x05080c, floor: 0x1b232d, key: 1.7, keyC: 0xffffff, hemi: 0.35, env: 0.9, exp: 1.0, rim: 0.7, rimC: 0x9cc4ff, light: false },
  light:  { glow: 0xffffff, glowI: 0.0, pat: 'none', top: 0xf5f7f9, bot: 0xd6dbe1, floor: 0xf2f4f6, key: 1.25, keyC: 0xffffff, hemi: 0.75, env: 1.0, exp: 1.0, rim: 0.3, rimC: 0xffffff, light: true },
  day:    { glow: 0xfff0d0, glowI: 0.5, pat: 'none', top: 0x5b8fd0, bot: 0xd9e5ef, floor: 0xa29e95, key: 2.2, keyC: 0xfff1dd, hemi: 0.45, env: 0.8, exp: 0.95, rim: 0.35, rimC: 0xbcd6ff, light: true },
  night:  { glow: 0xff9a5a, glowI: 0.3, pat: 'pool', top: 0x02050c, bot: 0x0e1a2b, floor: 0x0f151d, key: 0.55, keyC: 0x9fb6ff, hemi: 0.12, env: 0.3, exp: 1.15, rim: 1.6, rimC: 0xffb36b, light: false }
};
var UNIT = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };

function boot() {
  if (window.PRODUCT) { start(window.PRODUCT); return; }
  var src = document.body.getAttribute('data-config') || 'product.json';
  fetch(src, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(src + ' (HTTP ' + r.status + ')'); return r.json(); })
    .then(start)
    .catch(function (e) {
      showStatus('Could not load the product settings', 'Check that <b>' + esc(src) + '</b> is next to index.html and is valid JSON. ' +
        (location.protocol === 'file:' ? 'Opening the file directly from your computer blocks this: put it online (e.g. GitHub Pages) or use a local web server.' : '') +
        '<br><small>' + esc(e.message) + '</small>');
    });
}

/* ======================================================================= */
function start(cfg) {
  var tierName = String(cfg.package || 'pro').toLowerCase();
  var F = Object.assign({}, TIERS[tierName] || TIERS.pro, cfg.features || {});

  document.title = (cfg.title || '3D Product') + ' — Interactive 3D View';
  $('#title').innerHTML = esc(cfg.title || '3D Product') + '<small>' + esc(cfg.subtitle || 'Interactive exploded view · drag parts apart') + '</small>';
  if (cfg.accent) document.documentElement.style.setProperty('--acc', cfg.accent);
  if (cfg.accentText) document.documentElement.style.setProperty('--accInk', cfg.accentText);

  /* ---------------- renderer, scene, camera ---------------- */
  var canvas = $('#c');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  var PR = LITE ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(PR);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = !LITE;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);

  var pm = new THREE.PMREMGenerator(renderer);
  if (THREE.RoomEnvironment) scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  pm.dispose();

  var hemi = new THREE.HemisphereLight(0xdfe9f5, 0x2a2620, 0.4); scene.add(hemi);
  var key = new THREE.DirectionalLight(0xffffff, 1.6); key.castShadow = !LITE;
  key.shadow.mapSize.set(LITE ? 512 : 2048, LITE ? 512 : 2048);
  scene.add(key); scene.add(key.target);
  var rim = new THREE.DirectionalLight(0x9cc4ff, 0.6); scene.add(rim);

  var skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, glowI: { value: 0 }, gdir: { value: new THREE.Vector3(0, 0.12, -1).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top, bot, glow, gdir; uniform float glowI; varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = clamp(d.y*0.5+0.5,0.0,1.0); vec3 c = mix(bot, top, pow(h,1.4)); float g = max(dot(d, gdir), 0.0); c += glow * (pow(g, 5.0) * 0.8 + pow(g, 40.0) * 0.6) * glowI; c += glow * smoothstep(0.25, 0.0, abs(d.y - 0.02)) * 0.12 * glowI; gl_FragColor = linearToOutputTexel(vec4(c,1.0)); }',
    side: THREE.BackSide, depthWrite: false
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

  var fadeTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d');
    var g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#fff'); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
  })();
  function patTex(kind) {
    var c = document.createElement('canvas'); c.width = c.height = 1024; var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024);
    if (kind === 'grid') {
      for (var i = 0; i <= 1024; i += 16) {
        var major = i % 128 === 0; x.strokeStyle = major ? 'rgba(170,215,255,0.95)' : 'rgba(150,200,255,0.42)'; x.lineWidth = major ? 2.2 : 1;
        x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke();
      }
      x.globalCompositeOperation = 'multiply'; x.fillStyle = '#7f9cc0'; x.fillRect(0, 0, 1024, 1024); x.globalCompositeOperation = 'source-over';
      x.strokeStyle = 'rgba(210,235,255,0.9)'; x.lineWidth = 3; x.beginPath(); x.arc(512, 512, 200, 0, 7); x.stroke(); x.beginPath(); x.arc(512, 512, 330, 0, 7); x.setLineDash([14, 10]); x.stroke(); x.setLineDash([]);
    } else if (kind === 'pool') {
      var g = x.createRadialGradient(512, 512, 0, 512, 512, 512); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#d9d9d9'); g.addColorStop(1, '#8a8a8a');
      x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
    }
    var t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
  }
  var PATS = { grid: patTex('grid'), pool: patTex('pool'), none: null };
  var floorMat = new THREE.MeshStandardMaterial({ color: 0x1b232d, roughness: 0.9, metalness: 0, alphaMap: fadeTex, transparent: true, depthWrite: false });
  var floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.renderOrder = -1; scene.add(floor);

  /* ---------------- load model ---------------- */
  if (!THREE.GLTFLoader) { showStatus('3D loader missing', 'GLTFLoader.js did not load. Check your internet connection.'); return; }
  var modelUrl = cfg.model || 'model.glb';
  function onGltf(gltf) {
    try { setup(gltf.scene); }
    catch (err) { showStatus('The 3D model loaded but could not be set up', esc(err.message), false); if (window.console) console.error(err); }
  }
  if (window.MODEL_B64) {           // single-file mode: the model is packed inside the page
    try {
      var bin = atob(window.MODEL_B64), buf = new Uint8Array(bin.length);
      for (var bi = 0; bi < bin.length; bi++) buf[bi] = bin.charCodeAt(bi);
      new THREE.GLTFLoader().parse(buf.buffer, '', onGltf, function (err) { showStatus('Could not read the packed 3D model', esc(err && err.message ? err.message : err)); });
    } catch (err) { showStatus('Could not read the packed 3D model', esc(err.message)); }
    return;
  }
  new THREE.GLTFLoader().load(modelUrl, function (gltf) {
    try { setup(gltf.scene); }
    catch (err) { showStatus('The 3D model loaded but could not be set up', esc(err.message), false); if (window.console) console.error(err); }
  }, function (ev) {
    if (ev.total) $('#loadBar').style.width = Math.round(ev.loaded / ev.total * 100) + '%';
  }, function (err) {
    showStatus('Could not load the 3D model', 'Check that <b>' + esc(modelUrl) + '</b> exists next to index.html and is a .glb or .gltf file.<br><small>' + esc(err && err.message ? err.message : err) + '</small>');
  });

  /* ===================================================================== */
  function setup(root) {
    var s = cfg.scale || UNIT[cfg.units || 'm'] || 1;
    root.scale.multiplyScalar(s);
    if (cfg.rotate) root.rotation.set(cfg.rotate[0] * Math.PI / 180, (cfg.rotate[1] || 0) * Math.PI / 180, (cfg.rotate[2] || 0) * Math.PI / 180);
    scene.add(root);
    root.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(root), c0 = new THREE.Vector3(); box.getCenter(c0);
    root.position.x -= c0.x; root.position.z -= c0.z; root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
    box.setFromObject(root);
    var SIZE = new THREE.Vector3(); box.getSize(SIZE);
    var CENTER = new THREE.Vector3(); box.getCenter(CENTER);
    var R = Math.max(SIZE.length() / 2, 1e-3);

    // scale-aware scene furniture
    camera.near = R * 0.01; camera.far = R * 400; camera.updateProjectionMatrix();
    sky.scale.setScalar(R * 150);
    floor.scale.setScalar(R * 9);
    var sc = key.shadow.camera; sc.near = R * 0.1; sc.far = R * 12;
    key.shadow.bias = -0.0004; key.shadow.normalBias = R * 0.004;

    // materials: one copy per mesh so highlighting one part never lights another
    var allMats = [];
    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = !LITE; o.receiveShadow = !LITE;
      o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
    });
    function cloneMat(m) {
      var c = m.clone();
      c.userData = { baseOpacity: c.opacity, baseTransparent: c.transparent, baseDepthWrite: c.depthWrite,
        baseEmissive: c.emissive ? c.emissive.getHex() : 0, baseEI: c.emissiveIntensity || 1, name: m.name || '' };
      c.side = THREE.DoubleSide;
      allMats.push(c); return c;
    }

    /* ---------------- parts ---------------- */
    function findNode(name) {
      var n = root.getObjectByName(name);
      if (!n && THREE.PropertyBinding) n = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
      return n;
    }
    var defs = [];
    if (cfg.parts && cfg.parts.length) {
      cfg.parts.forEach(function (d) {
        var n = findNode(d.node);
        if (!n) { if (window.console) console.warn('Part node not found in model: ' + d.node); return; }
        defs.push({ node: n, d: d });
      });
    } else {
      var st = root; while (!st.isMesh && st.children.length === 1) st = st.children[0];
      (st.isMesh ? [st] : st.children).forEach(function (n, i) { defs.push({ node: n, d: { name: n.name || ('Part ' + (i + 1)) } }); });
    }
    if (defs.length > F.maxParts) defs = defs.slice(0, F.maxParts);
    var missing = (cfg.parts || []).length - defs.length;

    var parts = [], meshPart = new Map(), tmpBox = new THREE.Box3();
    var depth = function (o) { var k = 0; while (o.parent) { k++; o = o.parent; } return k; };
    defs.sort(function (a, b) { return depth(a.node) - depth(b.node); });
    defs.forEach(function (x, i) {
      var n = x.node, d = x.d;
      tmpBox.setFromObject(n);
      var ctr = new THREE.Vector3(), sz = new THREE.Vector3(); tmpBox.getCenter(ctr); tmpBox.getSize(sz);
      var dir;
      if (d.explode) dir = V3(d.explode[0], d.explode[1], d.explode[2]).multiplyScalar((cfg.explodeScale || 1) * (cfg.explodeUnitsAreModel ? s : 1));
      else {
        dir = ctr.clone().sub(CENTER);
        if (dir.length() < R * 0.05) dir.set(0, 1, 0);
        dir.normalize().multiplyScalar(R * 0.9 * (cfg.explodeScale || 1));
      }
      var p = { id: 'p' + i, node: n, name: d.name || n.name || ('Part ' + (i + 1)), cat: d.category || 'Parts', desc: d.description || '',
        shell: !!d.shell, dir: dir, ex: 0, exT: 0, user: new THREE.Vector3(), userT: new THREE.Vector3(),
        origWorld: n.getWorldPosition(new THREE.Vector3()), center: ctr, size: sz, mats: [], meshes: [], hidden: false, lvl: 0 };
      parts.push(p);
    });
    parts.forEach(function (p) {
      p.node.traverse(function (o) { if (o.isMesh) meshPart.set(o, p); });
    });
    meshPart.forEach(function (p, mesh) { p.meshes.push(mesh); asArr(mesh.material).forEach(function (m) { if (p.mats.indexOf(m) < 0) p.mats.push(m); }); });
    // keep only meshes that belong to the deepest part (a mesh in a nested part belongs to the inner part)
    parts.forEach(function (p) { p.meshes = p.meshes.filter(function (m) { return meshPart.get(m) === p; }); });

    /* ---------------- spin animations ---------------- */
    var spins = (cfg.spin || []).map(function (a) {
      var n = findNode(a.node); if (!n) return null;
      var c = new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()); n.worldToLocal(c);
      if (a.pivot) c.set(a.pivot[0], a.pivot[1], a.pivot[2]);
      var piv = new THREE.Object3D(); piv.position.copy(c);
      n.children.slice().forEach(function (ch) { ch.position.sub(c); piv.add(ch); });
      n.add(piv);
      return { node: piv, axis: V3(a.axis ? a.axis[0] : 0, a.axis ? a.axis[1] : 1, a.axis ? a.axis[2] : 0).normalize(), speed: (a.speed || 1) * Math.PI * 2 };
    }).filter(Boolean);

    /* ---------------- state ---------------- */
    var state = { xray: false, wire: false, labels: false, dims: false, compare: false, slice: false, spin: false, animate: false, lock: false };
    var selected = null, hover = null, isolated = null;
    var sceneMode = (cfg.scene && F.scenes.indexOf(cfg.scene) >= 0) ? cfg.scene : F.scenes[0];
    var clipPlane = new THREE.Plane(V3(-1, 0, 0), 0), slice = { axis: 'x', pos: 0.5 };
    var tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

    var lift = 0, lastLift = 0;
    function applyPositions() {
      var lo = 0;
      parts.forEach(function (p) { if (p.node.visible) lo = Math.min(lo, p.center.y - p.size.y / 2 + p.dir.y * p.ex); });
      lift = -lo + (lo < 0 ? R * 0.02 : 0);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        tmp.copy(p.origWorld).addScaledVector(p.dir, p.ex).add(p.user); tmp.y += lift;
        p.node.parent.updateMatrixWorld(true);
        p.node.parent.worldToLocal(tmp);
        p.node.position.copy(tmp);
      }
    }
    function meanEx() { var t = 0; parts.forEach(function (p) { t += p.ex; }); return parts.length ? t / parts.length : 0; }
    function meanT() { var t = 0; parts.forEach(function (p) { t += p.exT; }); return parts.length ? t / parts.length : 0; }
    function refreshVis() { parts.forEach(function (p) { p.node.visible = !p.hidden && (!isolated || isolated === p); }); }
    function refreshHL() {
      parts.forEach(function (p) {
        var lvl = p === selected ? 2 : (p === hover ? 1 : 0);
        if (p.lvl === lvl) return; p.lvl = lvl;
        p.mats.forEach(function (m) {
          if (!m.emissive) return;
          if (lvl === 0) { m.emissive.setHex(m.userData.baseEmissive); m.emissiveIntensity = m.userData.baseEI; }
          else { m.emissive.set(cfg.accent || '#ffb020'); m.emissiveIntensity = lvl === 2 ? 0.45 : 0.22; }
        });
      });
    }
    var shellSet = parts.some(function (p) { return p.shell; });
    function applyLook() {
      parts.forEach(function (p) {
        var see = state.xray && (!shellSet || p.shell);
        p.mats.forEach(function (m) {
          var u = m.userData;
          m.transparent = see || u.baseTransparent;
          m.opacity = see ? 0.16 : u.baseOpacity;
          m.depthWrite = see ? false : u.baseDepthWrite;
        });
      });
      allMats.forEach(function (m) { m.wireframe = state.wire; m.clippingPlanes = state.slice ? [clipPlane] : []; m.clipShadows = true; m.needsUpdate = true; });
    }
    function updateClip() {
      var b = box;
      if (slice.axis === 'x') { clipPlane.normal.set(-1, 0, 0); clipPlane.constant = b.min.x + (b.max.x - b.min.x) * slice.pos; }
      else { clipPlane.normal.set(0, 0, -1); clipPlane.constant = b.min.z + (b.max.z - b.min.z) * slice.pos; }
    }

    /* ---------------- camera orbit ---------------- */
    var cam0 = cfg.camera || {};
    var cam = { theta: cam0.theta !== undefined ? cam0.theta : 0.7, phi: cam0.phi !== undefined ? cam0.phi : 1.1, r: 1, tx: 0, ty: CENTER.y, tz: 0 };
    var camT = Object.assign({}, cam);
    function fitDist() {
      var f = (1 + 0.9 * clamp(meanT(), 0, 1)) * (state.compare ? cmpFit : 1);
      var vfov = camera.fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
      return R * f / Math.sin(Math.min(vfov, hfov) / 2) * 1.08;
    }
    function maxPhi() { return Math.PI / 2 - 0.02; }
    function updateCamera(dt) {
      var k = 1 - Math.exp(-dt * 10);
      camT.phi = clamp(camT.phi, 0.05, maxPhi());
      for (var kk in cam) cam[kk] += (camT[kk] - cam[kk]) * k;
      var sp = Math.sin(cam.phi);
      camera.position.set(cam.tx + cam.r * sp * Math.sin(cam.theta), cam.ty + cam.r * Math.cos(cam.phi), cam.tz + cam.r * sp * Math.cos(cam.theta));
      camera.lookAt(cam.tx, cam.ty, cam.tz);
    }
    function setView(v) {
      var t = { iso: [0.7, 1.1], front: [0, Math.PI / 2 - 0.03], side: [Math.PI / 2, Math.PI / 2 - 0.03], top: [0, 0.06], back: [Math.PI, Math.PI / 2 - 0.03] }[v];
      var d = t[0] - cam.theta; d = Math.atan2(Math.sin(d), Math.cos(d));
      camT.theta = cam.theta + d; camT.phi = t[1]; camT.r = fitDist(); camT.tx = 0; camT.ty = CENTER.y; camT.tz = 0;
    }
    function ensureFit() { camT.r = Math.max(camT.r, fitDist()); }

    /* ---------------- formatting ---------------- */
    function fmtLen(m) {
      if (m >= 1) { var ft = m * 3.28084, f = Math.floor(ft), inch = Math.round((ft - f) * 12); if (inch === 12) { f++; inch = 0; } return m.toFixed(2) + ' m · ' + f + ' ft ' + inch + ' in'; }
      if (m >= 0.1) return (m * 100).toFixed(1) + ' cm · ' + (m * 39.3701).toFixed(1) + ' in';
      return (m * 1000).toFixed(0) + ' mm · ' + (m * 39.3701).toFixed(2) + ' in';
    }

    /* ---------------- UI: chips ---------------- */
    var chipRow = $('#chipRow'), html = '';
    html += '<div class="grp"><span class="lbl">View</span>' + ['iso', 'front', 'side', 'top'].map(function (v) { return '<button class="chip" data-view="' + v + '">' + { iso: '3D', front: 'Front', side: 'Side', top: 'Top' }[v] + '</button>'; }).join('') + '</div>';
    if (F.scenes.length > 1) html += '<span class="sep"></span><div class="grp"><span class="lbl">Scene</span>' + F.scenes.map(function (sc2) { return '<button class="chip" data-scene="' + sc2 + '">' + SCENE_NAMES[sc2] + '</button>'; }).join('') + '</div>';
    var toggles = [['xray', 'X-ray'], ['cutaway', 'Cutaway', 'slice'], ['labels', 'Labels'], ['dims', 'Dimensions'], ['compare', 'Compare size'], ['wire', 'Wireframe'], ['animate', 'Animate'], ['autospin', 'Auto-spin', 'spin']];
    var tg = toggles.filter(function (t) { return F[t[0]] && !(t[0] === 'animate' && !spins.length); });
    if (tg.length) html += '<span class="sep"></span><div class="grp"><span class="lbl">Show</span>' + tg.map(function (t) { return '<button class="chip" data-t="' + (t[2] || t[0]) + '" aria-pressed="false">' + t[1] + '</button>'; }).join('') + '</div>';
    if (F.paint && ((cfg.paint && cfg.paint.length) || (cfg.editions && cfg.editions.length))) html += '<span class="sep"></span><button class="btn" id="bPaint" aria-pressed="false">🎨 ' + (cfg.editions && cfg.editions.length ? 'Design' : 'Colors') + '</button>';
    chipRow.innerHTML = html;
    if (!F.explode) $('#exRow').classList.add('hide');

    /* ---------------- UI: parts list + info ---------------- */
    function buildList() {
      var host = $('#parts'), cats = [], h = '<div class="plist-head"><span>' + parts.length + ' parts</span><button id="showAll">Show all</button></div>';
      parts.forEach(function (p) { if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
      cats.forEach(function (c) {
        h += '<div class="cat">' + esc(c) + '</div>';
        parts.filter(function (p) { return p.cat === c; }).forEach(function (p) {
          h += '<div class="row-p" data-id="' + p.id + '"><button class="eye" data-eye="' + p.id + '" aria-label="Show or hide ' + esc(p.name) + '"><i></i></button><span class="nm">' + esc(p.name) + '</span></div>';
        });
      });
      host.innerHTML = h;
      host.onclick = function (e) {
        var eye = e.target.closest('[data-eye]'), byId = function (id) { return parts.filter(function (x) { return x.id === id; })[0]; };
        if (eye) { var pp = byId(eye.dataset.eye); pp.hidden = !pp.hidden; eye.classList.toggle('off', pp.hidden); refreshVis(); return; }
        if (e.target.id === 'showAll') { parts.forEach(function (x) { x.hidden = false; }); isolated = null; host.querySelectorAll('.eye').forEach(function (b) { b.classList.remove('off'); }); refreshVis(); renderInfo(); return; }
        var row = e.target.closest('.row-p'); if (row) select(byId(row.dataset.id));
      };
    }
    function renderInfo() {
      var el = $('#sel');
      if (!selected) { el.innerHTML = '<p class="empty">Click or tap any part to see what it is. ' + (F.drag ? 'Drag it to pull it out.' : '') + '</p>'; return; }
      var p = selected;
      el.innerHTML = '<span class="tag">' + esc(p.cat) + '</span><h2>' + esc(p.name) + '</h2>' + (p.desc ? '<p>' + esc(p.desc) + '</p>' : '') +
        '<table class="kv"><tr><td>Width</td><td>' + fmtLen(p.size.x) + '</td></tr><tr><td>Height</td><td>' + fmtLen(p.size.y) + '</td></tr><tr><td>Depth</td><td>' + fmtLen(p.size.z) + '</td></tr></table>' +
        '<div class="acts"><button class="btn" id="bPut">Put back</button><button class="btn" id="bIso">' + (isolated === p ? 'Show all' : 'Isolate') + '</button></div>';
      $('#bPut').onclick = function () { p.userT.set(0, 0, 0); p.exT = 0; };
      $('#bIso').onclick = function () { isolated = isolated === p ? null : p; refreshVis(); renderInfo(); };
    }
    function renderSpecs() {
      var h = '';
      if (F.specs && cfg.specs && cfg.specs.length) {
        h += '<h3>Specs</h3><table class="kv">' + cfg.specs.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>';
      }
      h += '<h3>Overall size (model)</h3><table class="kv"><tr><td>Width</td><td>' + fmtLen(SIZE.x) + '</td></tr><tr><td>Height</td><td>' + fmtLen(SIZE.y) + '</td></tr><tr><td>Depth</td><td>' + fmtLen(SIZE.z) + '</td></tr></table>';
      if (cfg.sources && cfg.sources.length) h += '<div class="src">Sources: ' + cfg.sources.map(function (x) { return '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.label) + '</a>'; }).join(' · ') + '</div>';
      if (cfg.note) h += '<div class="src">' + esc(cfg.note) + '</div>';
      $('#specs').innerHTML = h;
    }
    function select(p) {
      selected = p;
      document.querySelectorAll('.row-p').forEach(function (r) { r.classList.toggle('sel', !!p && r.dataset.id === p.id); });
      refreshHL(); renderInfo();
      if (p && F.info && window.innerWidth > 820 && $('#info').classList.contains('hide')) { $('#info').classList.remove('hide'); $('#tglInfo').setAttribute('aria-pressed', 'true'); resize(); }
    }

    /* ---------------- labels ---------------- */
    var labelsHost = $('#labels'), leaders = $('#leaders'), labelEls = [];
    if (F.labels) parts.forEach(function (p) {
      var d = document.createElement('div'); d.textContent = p.name; d.style.display = 'none'; labelsHost.appendChild(d);
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); ln.setAttribute('stroke', getComputedStyle(document.documentElement).getPropertyValue('--acc') || '#ffb020'); ln.setAttribute('stroke-width', '1.2'); ln.style.display = 'none'; leaders.appendChild(ln);
      labelEls.push({ p: p, el: d, ln: ln });
    });
    function updateLabels() {
      if (!labelEls.length) return;
      var W = window.innerWidth, Hh = window.innerHeight;
      tmp2.copy(CENTER).project(camera); var cx = (tmp2.x + 1) / 2 * W, cy = (1 - tmp2.y) / 2 * Hh;
      labelEls.forEach(function (L) {
        var p = L.p, show = state.labels && p.node.visible && (p.ex > 0.25 || p.user.length() > R * 0.1 || isolated === p);
        if (show) { tmp.copy(p.center).addScaledVector(p.dir, p.ex).add(p.user); tmp.y += lift; tmp.project(camera); if (tmp.z > 1) show = false; }
        if (!show) { if (L.el.style.display !== 'none') { L.el.style.display = 'none'; L.ln.style.display = 'none'; } return; }
        var sx = (tmp.x + 1) / 2 * W, sy = (1 - tmp.y) / 2 * Hh, dx = sx - cx, dy = sy - cy, dl = Math.hypot(dx, dy) || 1;
        var lx = sx + dx / dl * 40, ly = sy + dy / dl * 40 - 8;
        L.el.style.display = 'block'; L.ln.style.display = 'block';
        var ox = dx >= 0 ? lx : lx - L.el.offsetWidth;
        L.el.style.transform = 'translate(' + ox.toFixed(1) + 'px,' + (ly - 10).toFixed(1) + 'px)';
        L.ln.setAttribute('x1', sx.toFixed(1)); L.ln.setAttribute('y1', sy.toFixed(1)); L.ln.setAttribute('x2', lx.toFixed(1)); L.ln.setAttribute('y2', ly.toFixed(1));
      });
    }

    /* ---------------- dimension overlay + size comparison ---------------- */
    function textSprite(text, h) {
      var cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; var x = cv.getContext('2d');
      x.font = '600 52px system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
      var tw = Math.min(1000, x.measureText(text).width + 56), rx = (1024 - tw) / 2;
      x.fillStyle = 'rgba(8,12,18,0.88)'; x.strokeStyle = cfg.accent || '#ffb020'; x.lineWidth = 4;
      x.beginPath(); x.moveTo(rx + 22, 14); x.arcTo(rx + tw, 14, rx + tw, 114, 22); x.arcTo(rx + tw, 114, rx, 114, 22); x.arcTo(rx, 114, rx, 14, 22); x.arcTo(rx, 14, rx + tw, 14, 22); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 512, 66);
      var t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(h * 8, h, 1); sp.renderOrder = 20; return sp;
    }
    var dimGroup = new THREE.Group(); dimGroup.visible = false; scene.add(dimGroup);
    (function () {
      var lm = new THREE.LineBasicMaterial({ color: cfg.accent || '#ffb020', depthTest: false, transparent: true }), b = box, y = 0.002 * R, th = R * 0.09, o = R * 0.25;
      function line(a, c, tick, text, off) {
        var t = tick.clone().multiplyScalar(R * 0.05);
        var g = new THREE.BufferGeometry().setFromPoints([a, c, a.clone().sub(t), a.clone().add(t), c.clone().sub(t), c.clone().add(t)]);
        var l = new THREE.LineSegments(g, lm); l.renderOrder = 19; dimGroup.add(l);
        var sp = textSprite(text, th); sp.position.copy(a).add(c).multiplyScalar(0.5).add(off); dimGroup.add(sp);
      }
      line(V3(b.min.x, y, b.max.z + o), V3(b.max.x, y, b.max.z + o), V3(0, 0, 1), 'Width ' + fmtLen(SIZE.x), V3(0, th * 0.8, 0));
      line(V3(b.max.x + o, y, b.min.z), V3(b.max.x + o, y, b.max.z), V3(1, 0, 0), 'Depth ' + fmtLen(SIZE.z), V3(0, th * 0.8, 0));
      line(V3(b.min.x - o, 0, b.max.z), V3(b.min.x - o, b.max.y, b.max.z), V3(1, 0, 0), 'Height ' + fmtLen(SIZE.y), V3(-th * 2.5, 0, 0));
    })();
    var cmpGroup = new THREE.Group(); cmpGroup.visible = false; scene.add(cmpGroup);
    var cmpFit = 1;
    (function () {
      var cc = cfg.compare || {}, items = (cc.items || []).slice(), maxDim = Math.max(SIZE.x, SIZE.y, SIZE.z);
      var usePerson = cc.person !== undefined ? cc.person : maxDim >= 0.6;
      if (!items.length && !usePerson) items.push({ label: 'Smartphone', size: [0.0715, 0.147, 0.008] });
      var gap = Math.max(maxDim * 0.25, 0.15), x = box.min.x - gap, ext = SIZE.x;
      var gm = new THREE.MeshStandardMaterial({ color: 0x6fb4ff, roughness: 0.5, transparent: true, opacity: 0.55 });
      if (usePerson) {
        var pg = new THREE.Group(), pmat = new THREE.MeshStandardMaterial({ color: 0xff9a3c, roughness: 0.6 });
        var add = function (geo, px, py) { var m = new THREE.Mesh(geo, pmat); m.position.set(px, py, 0); m.castShadow = true; pg.add(m); };
        add(new THREE.CylinderGeometry(0.2, 0.17, 0.72, 14), 0, 1.13); add(new THREE.SphereGeometry(0.12, 16, 12), 0, 1.66);
        [-0.1, 0.1].forEach(function (lx) { add(new THREE.CylinderGeometry(0.07, 0.06, 0.8, 10), lx, 0.4); add(new THREE.CylinderGeometry(0.05, 0.045, 0.68, 10), lx * 2.6, 1.12); });
        pg.position.set(x - 0.3, 0, 0); cmpGroup.add(pg);
        var l1 = textSprite('Person · 1.8 m', 0.16); l1.position.set(x - 0.3, 2.05, 0); cmpGroup.add(l1);
        x -= 0.6 + gap; ext += 0.6 + gap;
      }
      items.forEach(function (it) {
        var w = it.size[0], h = it.size[1], d = it.size[2];
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gm.clone()); if (it.color) m.material.color.set(it.color);
        m.position.set(x - w / 2, h / 2, 0); m.castShadow = true; cmpGroup.add(m);
        var t = textSprite(it.label + ' · ' + fmtLen(Math.max(w, h)), Math.max(h, maxDim) * 0.09); t.position.set(x - w / 2, h + Math.max(h, maxDim) * 0.12, 0); cmpGroup.add(t);
        x -= w + gap; ext += w + gap;
      });
      cmpGroup.position.x = 0;
      var tb = new THREE.Box3().setFromObject(cmpGroup).union(box);
      cmpFit = Math.max(1, tb.getSize(new THREE.Vector3()).length() / 2 / R * 1.15);
    })();

    /* ---------------- paint + editions ---------------- */
    if (F.paint && ((cfg.paint && cfg.paint.length) || (cfg.editions && cfg.editions.length))) {
      var paints = cfg.paint || [], eds = cfg.editions || [];
      var ph = '';
      if (eds.length) {
        ph += '<span class="lbl">Edition</span><div class="grp"><button class="chip" data-ed="-1" aria-pressed="true">' + esc(cfg.baseEditionName || 'Classic') + '</button>' +
          eds.map(function (ed, i) { return '<button class="chip" data-ed="' + i + '" aria-pressed="false">' + esc(ed.label) + '</button>'; }).join('') + '</div>';
        if (paints.length) ph += '<span class="sep"></span>';
      }
      if (paints.length) {
        ph += '<span class="lbl">Colors</span>';
        paints.forEach(function (pt, i) { ph += '<label class="sw">' + esc(pt.label) + ' <input type="color" data-paint="' + i + '"></label>'; });
        ph += '<span class="sep"></span><div class="grp"><button class="chip" data-fin="matte">Matte</button><button class="chip" data-fin="satin">Satin</button><button class="chip" data-fin="gloss">Gloss</button></div>';
      }
      ph += '<button class="btn" id="bPaintReset">Reset</button>';
      $('#paintRow').innerHTML = ph;
      var byName = function (n) { return allMats.filter(function (m) { return m.userData.name === n; }); };
      var paintMats = paints.map(function (pt) { return allMats.filter(function (m) { return (pt.materials || []).indexOf(m.userData.name) >= 0; }); });
      // remember every material's original look so Reset / Classic can restore it
      allMats.forEach(function (m) { m.userData.orig = { color: m.color ? m.color.clone() : null, map: m.map, rough: m.roughness, metal: m.metalness }; });
      var restoreAll = function () { allMats.forEach(function (m) { var o = m.userData.orig; if (o.color) m.color.copy(o.color); m.map = o.map; m.roughness = o.rough; m.metalness = o.metal; m.needsUpdate = true; }); };
      var toHex = function (c) { return '#' + c.clone().convertLinearToSRGB().getHexString(); };
      var syncPaint = function () { document.querySelectorAll('[data-paint]').forEach(function (inp) { var l = paintMats[+inp.dataset.paint]; if (l.length) inp.value = toHex(l[0].color); }); };
      var texCache = {}, texLoader = new THREE.TextureLoader();
      var getTex = function (src, rep) {
        var key = src + '|' + (rep || ''); if (texCache[key]) return texCache[key];
        var t = texLoader.load((window.EDITION_IMAGES && window.EDITION_IMAGES[src]) || src);
        t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (rep) t.repeat.set(rep[0], rep[1]); t.flipY = false; texCache[key] = t; return t;
      };
      // re-wrap a design evenly around any shape: each face takes the texture from the side it faces
      var boxDone = new Set();
      var boxUV = function (mat, tile) {
        root.traverse(function (o) {
          if (!o.isMesh || asArr(o.material).indexOf(mat) < 0 || boxDone.has(o.geometry)) return;
          boxDone.add(o.geometry);
          var g = o.geometry; if (g.index) { g = g.toNonIndexed(); o.geometry = g; boxDone.add(g); }
          var P = g.attributes.position, uv = new Float32Array(P.count * 2), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
          o.updateMatrixWorld(true);
          for (var t = 0; t < P.count; t += 3) {
            a.fromBufferAttribute(P, t).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(P, t + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(P, t + 2).applyMatrix4(o.matrixWorld);
            n.subVectors(b, a).cross(c.clone().sub(a)); var ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
            [a, b, c].forEach(function (v, k) {
              var u, w;
              if (ay >= ax && ay >= az) { u = v.x; w = v.z; } else if (ax >= az) { u = v.z; w = v.y; } else { u = v.x; w = v.y; }
              uv[(t + k) * 2] = u / tile; uv[(t + k) * 2 + 1] = w / tile;
            });
          }
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        });
      };
      var applyEdition = function (i) {
        restoreAll();
        if (i >= 0) {
          var ed = eds[i];
          Object.keys(ed.materials || {}).forEach(function (n) {
            var o = ed.materials[n];
            byName(n).forEach(function (m) {
              if (o.color) m.color.set(o.color).convertSRGBToLinear();
              if (o.map) { m.map = getTex(o.map, o.project === 'box' ? null : o.repeat); if (!o.color) m.color.set(0xffffff); }
              if (o.project === 'box') boxUV(m, o.tile || 0.25);
              if (o.roughness !== undefined) m.roughness = o.roughness;
              if (o.metalness !== undefined) m.metalness = o.metalness;
              m.needsUpdate = true;
            });
          });
        }
        document.querySelectorAll('[data-ed]').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.ed === i ? 'true' : 'false'); });
        syncPaint();
      };
      document.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { applyEdition(+b.dataset.ed); }; });
      document.querySelectorAll('[data-paint]').forEach(function (inp) {
        inp.addEventListener('input', function () { paintMats[+inp.dataset.paint].forEach(function (m) { m.color.set(inp.value).convertSRGBToLinear(); }); });
      });
      document.querySelectorAll('[data-fin]').forEach(function (b) {
        b.onclick = function () {
          var r = { matte: 0.85, satin: 0.5, gloss: 0.15 }[b.dataset.fin];
          paintMats.forEach(function (l) { l.forEach(function (m) { m.roughness = r; }); });
          document.querySelectorAll('[data-fin]').forEach(function (x2) { x2.setAttribute('aria-pressed', x2 === b ? 'true' : 'false'); });
        };
      });
      $('#bPaintReset').onclick = function () { applyEdition(-1); document.querySelectorAll('[data-fin]').forEach(function (x2) { x2.setAttribute('aria-pressed', 'false'); }); };
      paints.forEach(function (pt, i) { if (pt.default) paintMats[i].forEach(function (m) { m.color.set(pt.default).convertSRGBToLinear(); }); });
      allMats.forEach(function (m) { if (m.color) m.userData.orig.color = m.color.clone(); });
      syncPaint();
      if (cfg.startEdition !== undefined) applyEdition(cfg.startEdition);
      $('#bPaint').onclick = function () { var on = $('#paintRow').classList.toggle('hide') === false; this.setAttribute('aria-pressed', on ? 'true' : 'false'); measureDock(); };
      window.__applyEdition = applyEdition;
    }

    /* ---------------- scenes ---------------- */
    function setScene(m) {
      sceneMode = m; var L = LOOKS[m];
      skyMat.uniforms.top.value.set(L.top).convertSRGBToLinear(); skyMat.uniforms.bot.value.set(L.bot).convertSRGBToLinear();
      skyMat.uniforms.glow.value.set(L.glow || 0).convertSRGBToLinear(); skyMat.uniforms.glowI.value = L.glowI || 0;
      floorMat.map = PATS[L.pat || 'none'] || null; floorMat.needsUpdate = true;
      floorMat.color.set(L.floor).convertSRGBToLinear(); floorMat.envMapIntensity = L.light ? 0.5 : 0.04;
      hemi.intensity = L.hemi; key.intensity = L.key; key.color.set(L.keyC); rim.intensity = L.rim; rim.color.set(L.rimC);
      renderer.toneMappingExposure = L.exp;
      allMats.forEach(function (mm) { if (mm.envMapIntensity !== undefined) mm.envMapIntensity = L.env; });
      document.body.classList.toggle('lightui', L.light);
      document.querySelectorAll('[data-scene]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.scene === m ? 'true' : 'false'); });
    }

    /* ---------------- interaction ---------------- */
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    var pointers = new Map(), mode = null, drag = null, moved = 0, pinch = null, lastTap = 0, holdTimer = 0, hintedHold = false, HOLD_MS = 280;
    var tip = $('#tip'), hint = $('#hint');
    var cX = new THREE.Vector3(), cY = new THREE.Vector3(), cZ = new THREE.Vector3();
    function setRay(e) { var r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
    function pick(e) {
      setRay(e);
      var objs = []; parts.forEach(function (p) { if (p.node.visible) p.meshes.forEach(function (m) { objs.push(m); }); });
      var hits = ray.intersectObjects(objs, false);
      for (var i = 0; i < hits.length; i++) {
        if (state.slice && clipPlane.distanceToPoint(hits[i].point) < 0) continue;
        var p = meshPart.get(hits[i].object);
        if (state.xray && p.shell && hits.some(function (h) { var q = meshPart.get(h.object); return q && !q.shell; })) continue;
        return { part: p, point: hits[i].point };
      }
      return null;
    }
    function flash(msg, t) { hint.textContent = msg; hint.classList.remove('gone'); flashT = t || 2.5; }
    var flashT = 0;
    function stopSpin() { if (state.spin) { state.spin = false; syncChips(); } }
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      canvas.focus({ preventScroll: true });
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); stopSpin(); moved = 0; hint.classList.add('gone');
      if (pointers.size === 2) {
        clearTimeout(holdTimer); drag = null; canvas.classList.remove('grabbing');
        var a = Array.from(pointers.values());
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 }; mode = 'pinch'; return;
      }
      var wantPan = e.button === 2 || e.button === 1 || e.shiftKey;
      var hit = (!wantPan && e.button === 0) ? pick(e) : null;
      if (hit) {
        select(hit.part);
        if (F.drag && !state.lock) {
          var n = new THREE.Vector3(); camera.getWorldDirection(n);
          drag = { part: hit.part, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.point), start: hit.point.clone(), su: hit.part.user.clone(), t0: e.timeStamp };
          mode = 'pending';
          holdTimer = setTimeout(function () { if (mode === 'pending' && drag) { canvas.classList.add('grabbing'); flash('Now drag to move: ' + drag.part.name, 1.5); } }, HOLD_MS);
        } else mode = 'orbit';
      } else mode = wantPan ? 'pan' : 'orbit';
    });
    canvas.addEventListener('pointermove', function (e) {
      var prev = pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') {
          var h = pick(e), hp = h ? h.part : null;
          if (hp !== hover) { hover = hp; refreshHL(); }
          canvas.classList.toggle('over', !!hp);
          if (hp) { tip.textContent = hp.name; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.style.opacity = 1; } else tip.style.opacity = 0;
        }
        return;
      }
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y; prev.x = e.clientX; prev.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (mode === 'pending' && moved > 4) {
        clearTimeout(holdTimer);
        // in an exploded view a drag on a part moves it; when assembled a quick drag rotates the view
        if (meanEx() > 0.15 || e.timeStamp - drag.t0 > HOLD_MS) { mode = 'part'; canvas.classList.add('grabbing'); }
        else { mode = 'orbit'; drag = null; canvas.classList.remove('grabbing'); if (!hintedHold) { hintedHold = true; flash('Tip: press and hold a part, then drag, to pull it out', 3.5); } }
      }
      if (mode === 'part' && drag) {
        setRay(e); var out = new THREE.Vector3();
        if (ray.ray.intersectPlane(drag.plane, out)) {
          var dp = drag.part; dp.user.copy(drag.su).add(out.sub(drag.start)).clampLength(0, R * 6);
          var floorY = -(dp.center.y - dp.size.y / 2 + dp.dir.y * dp.ex + lift) + R * 0.01;
          if (dp.user.y < floorY) dp.user.y = floorY;
          dp.userT.copy(dp.user);
        }
      } else if (mode === 'orbit') { camT.theta -= dx * 0.0065; camT.phi = clamp(camT.phi - dy * 0.0065, 0.05, maxPhi()); }
      else if (mode === 'pan') panBy(dx, dy);
      else if (mode === 'pinch' && pinch && pointers.size >= 2) {
        var a = Array.from(pointers.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        if (pinch.d > 0 && d > 0) camT.r = clamp(camT.r * pinch.d / d, R * 0.8, R * 30);
        panBy(mx - pinch.mx, my - pinch.my); pinch.d = d; pinch.mx = mx; pinch.my = my;
      }
    });
    function panBy(dx, dy) {
      camera.matrixWorld.extractBasis(cX, cY, cZ);
      var k = 2 * camT.r * Math.tan(camera.fov * Math.PI / 360) / window.innerHeight;
      camT.tx += (-dx * cX.x + dy * cY.x) * k; camT.ty += (-dx * cX.y + dy * cY.y) * k; camT.tz += (-dx * cX.z + dy * cY.z) * k;
    }
    function endPointer(e) {
      clearTimeout(holdTimer);
      pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if (mode === 'orbit' && moved < 5) {
          var now = performance.now();
          if (now - lastTap < 300) setView('iso'); else select(null);
          lastTap = now;
        }
        mode = null; drag = null; canvas.classList.remove('grabbing'); tip.style.opacity = 0;
      } else if (pointers.size === 1) mode = 'orbit';
    }
    canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', function () { if (!pointers.size) { hover = null; refreshHL(); tip.style.opacity = 0; canvas.classList.remove('over'); } });
    canvas.addEventListener('wheel', function (e) {
      // inside someone else's page, only zoom after the visitor has clicked the model (so page scrolling still works)
      if (EMBED && document.activeElement !== canvas) { flash('Click the model first to zoom with the scroll wheel'); return; }
      e.preventDefault(); stopSpin();
      camT.r = clamp(camT.r * Math.exp(e.deltaY * 0.0012), R * 0.8, R * 30);
    }, { passive: false });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape') { select(null); isolated = null; refreshVis(); } });

    /* ---------------- controls wiring ---------------- */
    var slider = $('#ex'), pct = $('#pct');
    slider.addEventListener('input', function () { var v = slider.value / 100; parts.forEach(function (p) { p.exT = v; }); ensureFit(); });
    $('#bExplode').onclick = function () { parts.forEach(function (p) { p.exT = 1; }); slider.value = 100; ensureFit(); };
    $('#bAssemble').onclick = function () { parts.forEach(function (p) { p.exT = 0; p.userT.set(0, 0, 0); }); slider.value = 0; };
    document.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { setView(b.dataset.view); stopSpin(); }; });
    document.querySelectorAll('[data-scene]').forEach(function (b) { b.onclick = function () { setScene(b.dataset.scene); }; });
    function syncChips() { document.querySelectorAll('[data-t]').forEach(function (b) { b.setAttribute('aria-pressed', state[b.dataset.t] ? 'true' : 'false'); }); }
    document.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.t; state[k] = !state[k];
        if (k === 'dims') dimGroup.visible = state.dims;
        if (k === 'compare') { cmpGroup.visible = state.compare; camT.r = fitDist(); }
        if (k === 'slice') { $('#sliceRow').classList.toggle('hide', !state.slice); updateClip(); measureDock(); }
        syncChips(); applyLook();
      };
    });
    document.querySelectorAll('[data-axis]').forEach(function (b) {
      b.onclick = function () { slice.axis = b.dataset.axis; document.querySelectorAll('[data-axis]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); updateClip(); };
    });
    $('#slicePos').addEventListener('input', function () { slice.pos = this.value / 100; updateClip(); });

    function togglePanel(btn, panel, other, otherBtn, allowed) {
      if (!allowed) { btn.classList.add('hide'); panel.classList.add('hide'); return; }
      btn.onclick = function () {
        var show = panel.classList.contains('hide');
        panel.classList.toggle('hide', !show); btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        if (show && window.innerWidth <= 820) { other.classList.add('hide'); otherBtn.setAttribute('aria-pressed', 'false'); }
        resize();
      };
    }
    togglePanel($('#tglParts'), $('#parts'), $('#info'), $('#tglInfo'), F.partsList);
    togglePanel($('#tglInfo'), $('#info'), $('#parts'), $('#tglParts'), F.info);
    var startCompact = window.innerWidth <= 820 || (EMBED && window.innerWidth < 1100) || cfg.panels === 'closed';
    if (startCompact) { ['#parts', '#info'].forEach(function (q) { $(q).classList.add('hide'); }); $('#tglParts').setAttribute('aria-pressed', 'false'); $('#tglInfo').setAttribute('aria-pressed', 'false'); }
    $('#tglLite').setAttribute('aria-pressed', LITE ? 'true' : 'false');
    $('#tglLite').onclick = function () { setLite(!LITE); };

    /* ---------------- layout ---------------- */
    function measureDock() { document.documentElement.style.setProperty('--dockH', (($('#dock').offsetHeight) || 140) + 'px'); resize(); }
    function resize() {
      var w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      var desk = w > 820, lw = desk && !$('#parts').classList.contains('hide') ? 252 : 0, rw = desk && !$('#info').classList.contains('hide') ? 302 : 0;
      var dockH = ($('#dock').offsetHeight || 140) + 12;
      camera.setViewOffset(w, h, -(lw - rw) / 2, (dockH - 56) / 2, w, h); camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', measureDock);

    /* ---------------- go ---------------- */
    buildList(); renderInfo(); renderSpecs(); setScene(sceneMode); applyLook(); refreshVis(); syncChips(); updateClip(); measureDock();
    cam.r = camT.r = fitDist();
    if (F.autospin && cfg.autoSpin) { state.spin = true; syncChips(); }
    if (missing > 0) flash(missing + ' part name(s) in product.json were not found in the model', 6);
    else flash(EMBED ? 'Drag to rotate · hold a part to pull it out · click, then scroll to zoom' : 'Drag to rotate · press and hold a part to pull it out · scroll / pinch to zoom', 5);

    var last = performance.now(), frames = 0, failures = 0, lost = false, lastPct = -1;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); lost = true; showStatus('Your device ran out of graphics memory', 'Lite mode lowers the quality so the 3D view runs smoothly.', true); });
    function frame(now) {
      requestAnimationFrame(frame);
      if (lost) return;
      try { step(now); frames++; if (frames === 2) loadEl.classList.add('hide'); }
      catch (err) { failures++; if (window.console) console.error(err); if (failures > 3) { lost = true; showStatus('Something went wrong drawing the 3D view', esc(err.message), true); } }
    }
    function step(now) {
      var dt = clamp((now - last) / 1000, 0, 0.05); last = now;
      var k = 1 - Math.exp(-dt * 8);
      parts.forEach(function (p) {
        p.ex += (p.exT - p.ex) * k; if (Math.abs(p.exT - p.ex) < 1e-4) p.ex = p.exT;
        if (!(drag && drag.part === p)) p.user.lerp(p.userT, k);
      });
      if (state.animate) spins.forEach(function (s2) { s2.node.rotateOnAxis(s2.axis, s2.speed * dt); });
      if (state.spin) camT.theta += dt * 0.35;
      applyPositions();
      camT.ty = CENTER.y + lift * 0.6 + (camT.ty - CENTER.y - lastLift * 0.6); lastLift = lift;
      updateCamera(dt);
      var mex = meanEx(), ext = 1 + mex * 1.2 + (state.compare ? cmpFit - 1 : 0);
      key.position.set(CENTER.x - R * 3, R * 5, CENTER.z - R * 2.5); key.target.position.copy(CENTER);
      sc.left = -R * 2 * ext; sc.right = R * 2 * ext; sc.top = R * 2 * ext; sc.bottom = -R * 2 * ext; sc.updateProjectionMatrix();
      rim.position.set(R * 3, R * 1.5, R * 4);
      sky.position.copy(camera.position);
      if (dimGroup.visible) dimGroup.children.forEach(function (c) { c.visible = mex < 0.15; });
      if (flashT > 0) { flashT -= dt; if (flashT <= 0) hint.classList.add('gone'); }
      var pc = Math.round(mex * 100); if (pc !== lastPct) { pct.textContent = pc + '%'; lastPct = pc; }
      updateLabels();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
    setTimeout(function () { if (frames < 2 && !lost) showStatus('The 3D view is taking too long to start', 'Your device may be struggling. Lite mode should fix it.', true); }, 15000);

    // test / integration hook
    window.__viewer = { parts: parts, state: state, camT: camT, select: select, setScene: setScene, setView: setView, size: SIZE, config: cfg, features: F };
  }
}

boot();
})();
