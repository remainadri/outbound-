// Headless smoke test of the NPC system with stubbed THREE + World.
const fs = require('fs');
const vm = require('vm');

let geoCount = 0, meshCount = 0;
class V3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;} clone(){return new V3(this.x,this.y,this.z);} }
class Euler { constructor(){this.x=0;this.y=0;this.z=0;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
class Obj3D {
  constructor(){ this.position=new V3(); this.rotation=new Euler(); this.scale={setScalar(){},set(){}}; this.children=[]; this.visible=true; }
  add(c){ this.children.push(c); return c; }
  remove(c){ const i=this.children.indexOf(c); if(i>=0) this.children.splice(i,1); }
  clone(){ const o=new Obj3D(); o.position.copy(this.position); return o; }
}
class Group extends Obj3D {}
class Mesh extends Obj3D { constructor(g,m){ super(); this.geometry=g; this.material=m; meshCount++; } }
const gk = () => { geoCount++; return {}; };
const THREE = {
  Vector3: V3, Euler, Group, Mesh, Object3D: Obj3D,
  SphereGeometry: gk, BoxGeometry: gk, CylinderGeometry: gk, ConeGeometry: gk,
  TorusGeometry: gk, OctahedronGeometry: gk, TetrahedronGeometry: gk,
  MeshLambertMaterial: (o)=>({color:o.color}),
  MathUtils: { clamp:(v,a,b)=>Math.max(a,Math.min(b,v)) },
};
class BoxCollider { constructor(pos,w,h,d){ this.position=pos.clone(); this.width=w; this.height=h; this.depth=d; } }

const win = { addEventListener(){}, removeEventListener(){}, innerWidth:1280, innerHeight:720, devicePixelRatio:1, location:{href:''}, matchMedia:()=>({matches:false,addEventListener(){}}), requestAnimationFrame(){}, setTimeout(){}, setInterval(){}, localStorage:{getItem:()=>null,setItem(){}}, navigator:{userAgent:'',deviceMemory:8}, performance:{now:()=>0}, document:{ getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], addEventListener(){}, createElement:()=>({style:{},classList:{add(){},remove(){}},appendChild(){},setAttribute(){},addEventListener(){}}), body:{appendChild(){}} } };
const sandbox = { THREE, BoxCollider, console, window: win, document: win.document, navigator: win.navigator, localStorage: win.localStorage, performance: win.performance,
  Math, Map, Set, JSON, Number, Array, Object, String, Boolean, Date, Infinity, NaN, isFinite, setTimeout(){}, setInterval(){}, requestAnimationFrame(){}, addEventListener(){}, URLSearchParams: class {}, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array };
sandbox.globalThis = sandbox;
win.window = win;
vm.createContext(sandbox);

const html = fs.readFileSync('/workspace/index.html','utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
let code = scripts[1].replace(/^\s*import .*$/m, '');
try { vm.runInContext(code, sandbox, { timeout: 30000 }); } catch(e) { console.log('EVAL NOTE:', e.message.slice(0,300)); }

const roads = [];
for (let i=-4;i<=4;i++){ roads.push({x1:i*60,z1:-260,x2:i*60,z2:260,width:8}); roads.push({x1:-260,z1:i*60,x2:260,z2:i*60,width:8}); }
const colliders = [ new BoxCollider(new V3(0,0,0), 10, 20, 10) ];
const world = { _roadPolylines: roads, collisionSystem: { colliders }, getGroundHeight: () => 0 };
const scene = new Group();
win.__game = { dayNightCycle: { gameTime: 9.0 }, controller:{position:new V3()}, inVehicle:false, vehicle:null };

const P = sandbox.Pedestrian;
if (!P) { console.log('FAIL: Pedestrian not defined'); process.exit(1); }
const peds = [];
for (let i=0;i<800;i++) peds.push(new P(scene, world, i));
console.log('built 800 NPCs OK. total meshes created:', meshCount, 'cached geos:', geoCount);

const seen = new Set(peds.map(p=>p.variety.id));
console.log('varieties used:', seen.size);
const heights = new Set(peds.slice(0,20).map(p=>p.heightScale.toFixed(3)));
const genders = new Set(peds.map(p=>p.gender));
console.log('genders:', [...genders], 'distinct heights among first 20:', heights.size);

const again = new P(scene, world, 5);
console.log('deterministic identity:', again.name===peds[5].name && again.homeLot.join()===peds[5].homeLot.join() && again.workPost.join()===peds[5].workPost.join());

const dt = 1/30;
for (let h=0; h<24; h+=0.25) {
  win.__game.dayNightCycle.gameTime = h;
  for (const p of peds) for (let s=0;s<30;s++) p.update(dt, new V3(1e6,0,1e6), false);
}
console.log('clock hour', win.__game.dayNightCycle.gameTime, 'phase counts:',
  ['HOME','COMMUTE','WORK','RETURN'].map(ph=>ph+'='+peds.filter(p=>p._phase===ph).length).join(' '));

let bad = 0, farFromRoad = 0;
for (const p of peds) {
  if (!isFinite(p.position.x) || !isFinite(p.position.z)) bad++;
  let dmin = 1e9;
  for (const r of roads) {
    const dx=r.x2-r.x1, dz=r.z2-r.z1, len2=dx*dx+dz*dz||1;
    let t=((p.position.x-r.x1)*dx+(p.position.z-r.z1)*dz)/len2; t=Math.max(0,Math.min(1,t));
    dmin=Math.min(dmin, Math.hypot(r.x1+dx*t-p.position.x, r.z1+dz*t-p.position.z));
  }
  if (dmin > 30) farFromRoad++;
}
console.log('non-finite positions:', bad, '| NPCs >30m off road network:', farFromRoad);

const victim = peds[0];
victim.die();
for (let s=0;s<100;s++) victim.update(dt, new V3(), false);
console.log('dead state ok:', victim.state==='DEAD');
victim.spawnInitial();
console.log('respawn -> phase:', victim._phase, 'state:', victim.state);

const f = peds[1];
f.update(dt, new V3(f.position.x+3,0,f.position.z), true);
console.log('flees when threatened:', f.state==='FLEE');

// Ultra preset check
console.log('ultra npc preset:', sandbox.CONFIG ? sandbox.CONFIG.npcCount : 'n/a');
