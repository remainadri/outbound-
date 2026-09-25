const fs = require('fs');
const vm = require('vm');
let geoCount = 0, meshCount = 0;
class V3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;} clone(){return new V3(this.x,this.y,this.z);} }
class Euler { constructor(){this.x=0;this.y=0;this.z=0;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} }
class Obj3D {
  constructor(){ this.position=new V3(); this.rotation=new Euler(); this.scale={setScalar(){},set(){}}; this.children=[]; this.visible=true; }
  add(c){ this.children.push(c); return c; } remove(c){ const i=this.children.indexOf(c); if(i>=0) this.children.splice(i,1); }
  clone(){ const o=new Obj3D(); o.position.copy(this.position); return o; }
}
class Group extends Obj3D {}
class Mesh extends Obj3D { constructor(g,m){ super(); this.geometry=g; this.material=m; meshCount++; } }
const gk = () => { geoCount++; return {}; };
const THREE = { Vector3:V3, Euler, Group, Mesh, Object3D:Obj3D,
  SphereGeometry:gk, BoxGeometry:gk, CylinderGeometry:gk, ConeGeometry:gk, TorusGeometry:gk, OctahedronGeometry:gk, TetrahedronGeometry:gk,
  MeshLambertMaterial:(o)=>({color:o.color}), MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))} };
class BoxCollider { constructor(pos,w,h,d){ this.position=pos.clone(); this.width=w; this.height=h; this.depth=d; } }
const sandbox = { THREE, BoxCollider, console, window:{__game:null}, Math, Map, Set, JSON, Number, Array, Object, Infinity, NaN, isFinite };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('/workspace/.tmp/npc_only.js','utf8'), sandbox);

const roads = [];
for (let i=-4;i<=4;i++){ roads.push({x1:i*60,z1:-260,x2:i*60,z2:260,width:8}); roads.push({x1:-260,z1:i*60,x2:260,z2:i*60,width:8}); }
const world = { _roadPolylines: roads, collisionSystem:{ colliders:[ new BoxCollider(new V3(0,0,0),10,20,10) ] }, getGroundHeight:()=>0 };
const scene = new Group();
sandbox.window.__game = { dayNightCycle:{ gameTime:9.0 } };

const P = sandbox.Pedestrian;
if (!P) { console.log('FAIL: Pedestrian not defined'); process.exit(1); }
const t0=Date.now();
const peds=[]; for(let i=0;i<800;i++) peds.push(new P(scene,world,i));
console.log(`built 800 NPCs in ${Date.now()-t0}ms | meshes:${meshCount} cachedGeos:${geoCount}`);
console.log('varieties used:', new Set(peds.map(p=>p.variety.id)).size, '| genders:', [...new Set(peds.map(p=>p.gender))]);
console.log('distinct heights among first 20:', new Set(peds.slice(0,20).map(p=>p.heightScale.toFixed(3))).size);
console.log('distinct builds among first 20:', new Set(peds.slice(0,20).map(p=>p.buildScale.toFixed(3))).size);
const a5 = new P(scene,world,5);
console.log('deterministic identity:', a5.name===peds[5].name && a5.homeLot.join()===peds[5].homeLot.join() && a5.workPost.join()===peds[5].workPost.join());
// count primitives per character (must be >= 30)
const prims = peds[0].group.children.length + peds[0].headGrp.children.length; // groups counted once; count deep:
function deep(o){ let n=0; for(const c of o.children||[]){ n+=1+deep(c);} return n; }
console.log('meshes in one NPC body (all parts):', deep(peds[0].group));

const dt=1/30;
for (let h=0;h<24;h+=0.25){ sandbox.window.__game.dayNightCycle.gameTime=h; for(const p of peds) for(let s=0;s<30;s++) p.update(dt,new V3(1e6,0,1e6),false); }
console.log('hour', sandbox.window.__game.dayNightCycle.gameTime, 'phases:', ['HOME','COMMUTE','WORK','RETURN'].map(ph=>ph+'='+peds.filter(p=>p._phase===ph).length).join(' '));
let bad=0,far=0;
for (const p of peds){
  if(!isFinite(p.position.x)||!isFinite(p.position.z)) bad++;
  let dmin=1e9;
  for(const r of roads){const dx=r.x2-r.x1,dz=r.z2-r.z1,l2=dx*dx+dz*dz||1;let t=((p.position.x-r.x1)*dx+(p.position.z-r.z1)*dz)/l2;t=Math.max(0,Math.min(1,t));dmin=Math.min(dmin,Math.hypot(r.x1+dx*t-p.position.x,r.z1+dz*t-p.position.z));}
  if(dmin>30) far++;
}
console.log('non-finite:',bad,'| >30m off road:',far);
const v=peds[0]; v.die(); for(let s=0;s<100;s++) v.update(dt,new V3(),false);
console.log('dead ok:',v.state==='DEAD'); v.spawnInitial(); console.log('respawn phase:',v._phase);
const f=peds[1]; f.update(dt,new V3(f.position.x+3,0,f.position.z),true);
console.log('flees when threatened:',f.state==='FLEE');
