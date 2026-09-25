// ============================================================
// NPC PEDESTRIAN — STORY-DRIVEN POPULATION SYSTEM
// No random roaming: every pedestrian is one of 20 distinct archetypes
// with a name, a trade, a home, a workplace and a fixed daily route
// (home → driveway car → commute along sidewalks → work post → home).
// Night-shift workers (nurse, chef, musician, drunk) live by their own
// clocks. Character meshes are assembled from 30+ geometric primitives
// (spheres, tapered cylinders, cones, boxes, octahedra, tori, tetrahedra)
// with per-archetype height, weight/build, gender silhouette and props.
// Deterministic: seeded RNG + hand-placed lots — identical every load.
// ============================================================

// Small deterministic PRNG (mulberry32) — same seed => same city life
function npcRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- 20 DISTINCT NPC VARIETIES (each tells a story) ---------------------
// h = height scale, build = body width/weight scale, gender, skin/hair,
// hours = shift window in game clock, hat/prop = silhouette identifiers.
const NPC_VARIETIES = [
    { id:'baker',      role:'Baker',              names:['Otto Krume','Hana Weiss'],     h:1.00, build:1.14, gender:'m', hours:[4,12],   shirt:0xF2EDE2, pants:0x4E342E, apron:true, hat:'chef',   hairCol:0x3E2723, skin:0xE8B98C, prop:null },
    { id:'butcher',    role:'Butcher',            names:['Viktor Marek','Stana Petrova'],h:0.98, build:1.26, gender:'m', hours:[6,16],   shirt:0xECEFF1, pants:0xB71C1C, apron:true, hat:null,     hairCol:0x4E342E, skin:0xD9A66B, prop:'cleaver' },
    { id:'office',     role:'Office worker',      names:['Daniel Reed','Maria Kovacs'],  h:1.02, build:0.94, gender:'m', hours:[8,17],   shirt:0x64B5F6, pants:0x263238, suit:true,  hat:null,     hairCol:0x2b1d0e, skin:0xF1C27D, prop:'briefcase' },
    { id:'nurse',      role:'Night nurse',        names:['Elena Voss','Priya Nair'],     h:0.96, build:0.90, gender:'f', hours:[21,7],   shirt:0x4DB6AC, pants:0xFFFFFF, skirt:true, hat:null,     hairCol:0x5D4037, skin:0xC68642, prop:'clipboard' },
    { id:'jogger',     role:'Morning jogger',     names:['Tomas Lukac','Greta Bauer'],   h:1.00, build:0.88, gender:'m', hours:[5,7],    shirt:0xFF8A65, pants:0x212121, headband:true, hat:null, hairCol:0x212121, skin:0xE0AC69, prop:null },
    { id:'fisherman',  role:'Harbor fisherman',   names:['Old Barnaby','Kees van Daal'], h:0.97, build:1.08, gender:'m', hours:[3,11],   shirt:0x37474F, pants:0x455A64, hat:'cap', hatCol:0xBF360C, hairCol:0x9E9E9E, skin:0xA1662F, prop:'rod' },
    { id:'student',    role:'University student', names:['Lena Fischer','Arik Sol'],     h:0.93, build:0.86, gender:'f', hours:[9,15],   shirt:0xBA68C8, pants:0x1A237E, backpack:true, hat:'beanie', hairCol:0xFFB300, skin:0xFFDBAC, prop:'book' },
    { id:'businesswoman',role:'Banker',           names:['Sofia Marchetti','Ingrid Holm'],h:1.01,build:0.90, gender:'f', hours:[7,18],   shirt:0xF5F5F5, pants:0x212121, suit:true,  skirt:true, hat:null,     hairCol:0x3E2723, skin:0xE8B98C, prop:'briefcase' },
    { id:'gardener',   role:'Parks gardener',     names:['Mateo Ruiz','Hinko Babic'],    h:0.99, build:1.05, gender:'m', hours:[6,14],   shirt:0x81C784, pants:0x5D4037, hat:'straw',  hairCol:0x4E342E, skin:0x8D5524, prop:'rake' },
    { id:'postman',    role:'Mail carrier',       names:['Arthur Pen','Ivo Stanek'],     h:1.02, build:0.98, gender:'m', hours:[8,16],   shirt:0xFFD54F, pants:0x0D47A1, bag:true,   hat:'cap',    hairCol:0x6D4C41, skin:0xF1C27D, prop:'parcel' },
    { id:'cop',        role:'Beat cop on patrol', names:['Officer Dane','Officer Kova'], h:1.04, build:1.06, gender:'m', hours:[6,22],   shirt:0x1A3A6B, pants:0x142C50, belt:true,  hat:'brim',   hairCol:0x212121, skin:0xC68642, prop:'radio' },
    { id:'clerk',      role:'Shop clerk',         names:['Nina Park','Rosa Delgado'],    h:0.95, build:0.92, gender:'f', hours:[10,19],  shirt:0xF06292, pants:0x37474F, skirt:true, hat:null,     hairCol:0x212121, skin:0xFFDBAC, prop:'bag' },
    { id:'drunk',      role:'Bar regular',        names:['Salty Jim','Branko T.'],       h:0.97, build:1.20, gender:'m', hours:[17,24],  shirt:0x8D6E63, pants:0x3E2723, hat:null,     hairCol:0x757575, skin:0xB0793B, prop:'bottle', wobble:true },
    { id:'chef',       role:'Restaurant chef',    names:['Marco Rossi','Pierre Leblanc'],h:1.00, build:1.18, gender:'m', hours:[11,23],  shirt:0xFAFAFA, pants:0x212121, apron:true, hat:'chef',   hairCol:0x212121, skin:0xE0AC69, prop:'pan' },
    { id:'mother',     role:'Mother on errands',  names:['Anna Berg','Lucia Costa'],     h:0.94, build:1.02, gender:'f', hours:[9,17],   shirt:0xAED581, pants:0x6D4C41, skirt:true, bag:true,   hat:null,     hairCol:0x8D6E63, skin:0xF1C27D, prop:'tote' },
    { id:'mechanic',   role:'Garage mechanic',    names:['Dexter Vale','Milos Rataj'],   h:1.00, build:1.12, gender:'m', hours:[7,15],   shirt:0x42A5F5, pants:0x263238, belt:true,  hat:'cap',    hairCol:0x3E2723, skin:0xA1662F, prop:'wrench' },
    { id:'elderly',    role:'Retired pensioner',  names:['Grandpa Elias','Mrs. Grundig'],h:0.90, build:1.00, gender:'f', hours:[8,12],   shirt:0xBCAAA4, pants:0x455A64, cane:true,  hat:null,     hairCol:0xCFD8DC, skin:0xE8B98C, prop:null },
    { id:'firefighter',role:'On-duty firefighter',names:['Cade Ember','Rok Hladnik'],    h:1.06, build:1.16, gender:'m', hours:[7,19],   shirt:0xC62828, pants:0x212121, belt:true,  hat:'brim',   hairCol:0x4E342E, skin:0xD9A66B, prop:'axe' },
    { id:'vendor',     role:'Market vendor',      names:['Yusuf Ali','Katerina Novak'],  h:0.99, build:1.08, gender:'f', hours:[7,15],   shirt:0xFFB74D, pants:0x33691E, apron:true, hat:'straw',  hairCol:0x212121, skin:0xC68642, prop:'crate' },
    { id:'musician',   role:'Street musician',    names:['Florian Bach','DJ Kosey'],     h:1.01, build:0.92, gender:'m', hours:[16,23],  shirt:0x7E57C2, pants:0x1A237E, hat:'brim',   hairCol:0x212121, skin:0x8D5524, prop:'guitar' },
];

// ---- Hand-placed residential streets (front-door points along sidewalks) --
// Matches the suburban cottages of placeSuburbanHouses() and the avenues
// that run through town: every NPC is born into one of these addresses.
const HOME_STREETS = [
    [-200,-60],[-210,-110],[-190,-170],[-150,-205],[-100,-215],[-55,-195],[-35,-155],[-70,-135],[-130,-125],[-175,-95],
    [40,-145],[70,-200],[115,-215],[150,-185],[145,-150],[100,-135],[55,-145],[30,-175],[-170,-50],[-155,-70],[130,-70],[155,-50],
    [-210,60],[-215,110],[-190,155],[-130,185],[100,175],[150,185],[190,155],
    [-140,-40],[-140,-80],[-50,-90],[50,-90],[-140,40],[-140,90],[90,40],[90,90],[-50,90],[140,-40],[140,40],
    [-200,40],[-200,-40],[50,110],[-50,-40],[20,-40],[-20,40],[140,-90],[-180,100],[40,-140],
    [-80,-140],[80,-140],[-80,0],[80,0],[-80,150],[80,150],[-160,200],[160,80],[200,20],[-240,20],
    [0,-180],[-40,-180],[40,-180],[-100,-100],[100,-100],[-100,100],[100,100],[0,150],[0,230],[-80,230],[80,230],
];

// ---- Workplace registry (hand-placed posts that give each district life) --
const WORKPLACES = {
    downtown:   [[0,14],[14,0],[-14,0],[0,-14]],
    bankPlaza:  [[-50,14],[-64,0],[-36,0]],
    market:     [[50,14],[64,0],[36,0]],
    oldTown:    [[-120,60],[-106,46]],
    harbor:     [[246,60],[246,100],[240,140]],
    campus:     [[-120,246],[-140,260]],
    hospital:   [[200,-140],[214,-126]],
    station:    [[-240,-120],[-226,-134]],
    fire:       [[-200,-140],[-186,-126]],
    factory:    [[200,200],[214,186]],
    garage:     [[160,-200],[174,-186]],
    bar:        [[80,-80],[94,-66]],
    parkPost:   [[-60,-60],[60,-60],[-60,60],[60,60]],
    plazaNorth: [[0,-80],[14,-94]],
    mallEast:   [[200,20],[214,34]],
};
