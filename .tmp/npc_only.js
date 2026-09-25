const CarGeoCache = {
    _cache: new Map(),
    box(w, h, d) {
        const k = `b${w}_${h}_${d}`;
        if (!this._cache.has(k)) this._cache.set(k, new THREE.BoxGeometry(w, h, d));
        return this._cache.get(k);
    },
    cyl(rt, rb, h, seg) {
        const k = `c${rt}_${rb}_${h}_${seg}`;
        if (!this._cache.has(k)) this._cache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
        return this._cache.get(k);
    },
    mat(color) {
        const k = `m${color}`;
        if (!this._cache.has(k)) this._cache.set(k, new THREE.MeshLambertMaterial({ color, flatShading: true }));
        return this._cache.get(k);
    },
    sph(r) {
        const k = `s${r}`;
        if (!this._cache.has(k)) this._cache.set(k, new THREE.SphereGeometry(r, 8, 6));
        return this._cache.get(k);
    }
};

const _npcTmp = new THREE.Vector3();

// ============================================================
// TRAFFIC VEHICLE - blueprint-built car with an AI driving engine
// (follows road polylines, right-hand lane, stops for obstacles)
// ============================================================
class TrafficVehicle {
    constructor(scene, world, type) {
        this.scene = scene;
        this.world = world;
        this.type = type;
        this.bp = CAR_BLUEPRINTS[type];
        this.mesh = new THREE.Group();
        this.mesh.name = 'Traffic_' + type;

        // Physics state
        this.position = new THREE.Vector3(0, 0.12, 0);
        this.rotation = 0;
        this.speed = 0;
        this.steering = 0;
        this.wheelSpin = 0;
        this.isOccupied = false;
        this.enginePhase = Math.random() * Math.PI * 2;
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.angularVelocity = 0;
        this.engineSpec = this.bp.engine;
        this.wheelRotation = 0;

        // AI route state
        this.aiSegIndex = 0;
        this.aiTarget = new THREE.Vector3();
        this.aiStoppedFor = 0;

        this.buildMesh();
        this.mesh.position.copy(this.position);
        scene.add(this.mesh);
    }

    buildMesh() {
        const bp = this.bp;
        const g = this.mesh;
        const bodyMat = CarGeoCache.mat(bp.bodyColor);
        const darkMat = CarGeoCache.mat(0x222222);
        const glassMat = CarGeoCache.mat(0x1a2a35);
        const tireMat = CarGeoCache.mat(0x151515);
        const rimMat = CarGeoCache.mat(0x999999);
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
        const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });

        // Chassis
        const body = new THREE.Mesh(CarGeoCache.box(bp.w, bp.h, bp.len), bodyMat);
        body.position.y = bp.y;
        body.castShadow = true;
        g.add(body);

        // Hood (raked)
        const hood = new THREE.Mesh(CarGeoCache.box(bp.w * 0.9, 0.12, bp.len * 0.3), darkMat);
        hood.position.set(0, bp.y + bp.h / 2 + 0.08, -bp.len * 0.3);
        hood.rotation.x = -bp.hoodRake;
        g.add(hood);

        // Cabin
        const cab = bp.cabin;
        const cabin = new THREE.Mesh(CarGeoCache.box(cab.w, cab.h, cab.d), glassMat);
        cabin.position.set(0, bp.y + bp.h / 2 + cab.h / 2 - 0.05, cab.z);
        cabin.castShadow = true;
        g.add(cabin);

        // Trunk / hatch / spoiler / cargo box
        if (bp.trunk) {
            const trunk = new THREE.Mesh(CarGeoCache.box(bp.w * 0.9, 0.14, bp.len * 0.22), bodyMat);
            trunk.position.set(0, bp.y + bp.h / 2 + 0.05, bp.len * 0.36);
            g.add(trunk);
        }
        if (bp.hatchBack) {
            const hatch = new THREE.Mesh(CarGeoCache.box(bp.w * 0.92, 0.5, 0.14), bodyMat);
            hatch.position.set(0, bp.y + bp.h / 2 + 0.3, bp.len * 0.42);
            hatch.rotation.x = 0.25;
            g.add(hatch);
        }
        if (bp.spoiler) {
            const wing = new THREE.Mesh(CarGeoCache.box(bp.w * 0.9, 0.06, 0.35), darkMat);
            wing.position.set(0, bp.y + bp.h / 2 + 0.55, bp.len * 0.42);
            g.add(wing);
            const postL = new THREE.Mesh(CarGeoCache.box(0.06, 0.4, 0.1), darkMat);
            postL.position.set(-bp.w * 0.35, bp.y + bp.h / 2 + 0.32, bp.len * 0.42);
            g.add(postL);
            const postR = postL.clone();
            postR.position.x = bp.w * 0.35;
            g.add(postR);
        }
        if (bp.box) {
            const cargo = new THREE.Mesh(CarGeoCache.box(bp.box.w, bp.box.h, bp.box.d), CarGeoCache.mat(0xDDDDDD));
            cargo.position.set(0, bp.y + bp.h / 2 + bp.box.h / 2 - 0.1, bp.box.z);
            cargo.castShadow = true;
            g.add(cargo);
        }
        // POLICE SYSTEM REMOVED — doorPanel / lightbar cruiser styling deleted

        // Head/tail lights
        const hl = new THREE.Mesh(CarGeoCache.box(0.35, 0.12, 0.06), lightMat);
        hl.position.set(-bp.w * 0.32, bp.y + 0.05, -bp.len / 2 - 0.03);
        g.add(hl);
        const hl2 = hl.clone(); hl2.position.x = bp.w * 0.32; g.add(hl2);
        const tl = new THREE.Mesh(CarGeoCache.box(0.4, 0.12, 0.06), tailMat);
        tl.position.set(-bp.w * 0.32, bp.y + 0.05, bp.len / 2 + 0.03);
        g.add(tl);
        const tl2 = tl.clone(); tl2.position.x = bp.w * 0.32; g.add(tl2);

        // Wheels
        this.wheels = [];
        const wr = bp.wheelR;
        const positions = [
            { x: -bp.wheelX, z: -bp.wheelZ, steer: true },
            { x: bp.wheelX, z: -bp.wheelZ, steer: true },
            { x: -bp.wheelX, z: bp.wheelZ, steer: false },
            { x: bp.wheelX, z: bp.wheelZ, steer: false },
        ];
        if (bp.wheelsCount === 6) {
            positions.push({ x: -bp.wheelX, z: bp.wheelZ * 0.55, steer: false });
            positions.push({ x: bp.wheelX, z: bp.wheelZ * 0.55, steer: false });
        }
        positions.forEach(pos => {
            const wg = new THREE.Group();
            const tire = new THREE.Mesh(CarGeoCache.cyl(wr, wr, 0.24, 10), tireMat);
            tire.rotation.z = Math.PI / 2;
            wg.add(tire);
            const rim = new THREE.Mesh(CarGeoCache.cyl(wr * 0.55, wr * 0.55, 0.25, 6), rimMat);
            rim.rotation.z = Math.PI / 2;
            wg.add(rim);
            wg.position.set(pos.x, wr, pos.z);
            wg.userData.steerable = pos.steer;
            g.add(wg);
            this.wheels.push(wg);
        });
    }

    placeOnRoad(segIndex) {
        const roads = this.world._roadPolylines;
        if (!roads || !roads.length) return;
        const seg = roads[segIndex % roads.length];
        this.aiSegIndex = segIndex % roads.length;
        const t = Math.random();
        this.position.set(
            seg.x1 + (seg.x2 - seg.x1) * t,
            0.12,
            seg.z1 + (seg.z2 - seg.z1) * t
        );
        this.rotation = Math.atan2(-(seg.z2 - seg.z1), -(seg.x2 - seg.x1));
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.rotation;
    }

    nextAiSegment() {
        const roads = this.world._roadPolylines;
        const cur = roads[this.aiSegIndex];
        if (!cur) return;
        const ex = cur.x2, ez = cur.z2;
        let best = -1, bestScore = Infinity;
        const curAngle = Math.atan2(ez - cur.z1, ex - cur.x1);
        for (let i = 0; i < roads.length; i++) {
            const s = roads[i];
            let sx, sz;
            if (Math.hypot(s.x1 - ex, s.z1 - ez) < 6) { sx = s.x2; sz = s.z2; }
            else if (Math.hypot(s.x2 - ex, s.z2 - ez) < 6) { sx = s.x1; sz = s.z1; }
            else continue;
            const ang = Math.atan2(sz - ez, sx - ex);
            let diff = Math.abs(ang - curAngle);
            if (diff > Math.PI) diff = Math.PI * 2 - diff;
            if (diff < 2.6 && diff < bestScore) { bestScore = diff; best = i; }
        }
        this.aiSegIndex = best >= 0 ? best : (this.aiSegIndex + 1) % roads.length;
    }

    update(deltaTime, world, npcs) {
        if (this.isOccupied) return;
        const eng = this.bp.engine;

        const roads = world._roadPolylines;
        const seg = roads[this.aiSegIndex];
        if (seg) {
            const dx = seg.x2 - seg.x1, dz = seg.z2 - seg.z1;
            const len = Math.hypot(dx, dz) || 1;
            const ox = (-dz / len) * Math.min(3, seg.width * 0.22);
            const oz = (dx / len) * Math.min(3, seg.width * 0.22);
            this.aiTarget.set(seg.x2 + ox, 0, seg.z2 + oz);
        }

        const toTarget = _npcTmp.subVectors(this.aiTarget, this.position);
        const targetAngle = Math.atan2(-toTarget.x, -toTarget.z);
        let angleDiff = targetAngle - this.rotation;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        this.steering = THREE.MathUtils.clamp(angleDiff * 1.6, -0.5, 0.5);

        // Stop for obstacles ahead (player on foot / player car / pedestrians)
        let blocked = false;
        const fx = -Math.sin(this.rotation), fz = -Math.cos(this.rotation);
        const game = window.__game;
        const checkPos = (px, pz, r) => {
            const rx = px - this.position.x, rz = pz - this.position.z;
            const ahead = rx * fx + rz * fz;
            if (ahead > 0 && ahead < 9) {
                const side = Math.abs(rx * fz - rz * fx);
                if (side < r + 1.4) blocked = true;
            }
        };
        if (game && game.controller && !game.inVehicle) checkPos(game.controller.position.x, game.controller.position.z, 1.0);
        if (game && game.inVehicle && game.vehicle) checkPos(game.vehicle.position.x, game.vehicle.position.z, 2.4);
        if (npcs) {
            for (const n of npcs) {
                if (n.state === 'DEAD') continue;
                checkPos(n.position.x, n.position.z, 0.6);
                if (blocked) break;
            }
        }

        const cruise = eng.maxSpeed * 0.45;
        if (blocked) {
            this.speed *= Math.pow(0.8, deltaTime * 60);
            this.aiStoppedFor += deltaTime;
        } else {
            this.aiStoppedFor = 0;
            if (this.speed < cruise) this.speed = Math.min(cruise, this.speed + eng.accel * deltaTime);
            else this.speed *= Math.pow(0.98, deltaTime * 60);
        }

        if (Math.abs(this.speed) > 0.3) {
            this.rotation += this.steering * (this.speed / eng.maxSpeed) * eng.grip * deltaTime;
        }

        this.position.x += -Math.sin(this.rotation) * this.speed * deltaTime;
        this.position.z += -Math.cos(this.rotation) * this.speed * deltaTime;
        this.position.y = 0.12;

        if (Math.hypot(toTarget.x, toTarget.z) < 8) this.nextAiSegment();
        if (this.aiStoppedFor > 6) {
            this.aiStoppedFor = 0;
            this.nextAiSegment();
        }

        this.applyTransform(deltaTime);
    }

    getPosition() { return this.position.clone(); }
    getRotation() { return this.rotation; }
    enter() { this.isOccupied = true; }
    exit(playerPosition) {
        this.isOccupied = false;
        const exitOffset = new THREE.Vector3(2, 0, 0);
        exitOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation);
        playerPosition.copy(this.position).add(exitOffset);
        playerPosition.y = this.position.y;
    }
    // Player driving uses the same physics as Vehicle.update (character cam follows).
    playerDrive(deltaTime, input, world) {
        if (!this.isOccupied) return;
        if (!this.velocity) this.velocity = new THREE.Vector3(0, 0, 0);
        const joystickVector = input.getJoystickVector();
        const hasJoystickInput = Math.abs(joystickVector.x) > 0.1 || Math.abs(joystickVector.y) > 0.1;
        let accelerationInput = 0;
        if (hasJoystickInput) accelerationInput = -joystickVector.y;
        else if (input.forward) accelerationInput = 1.0;
        else if (input.backward) accelerationInput = -1.0;
        const eng = this.engineSpec || this.bp.engine;
        if (Math.abs(accelerationInput) > 0.1) {
            if (accelerationInput > 0) this.speed += eng.accel * accelerationInput * deltaTime;
            else this.speed += eng.brake * accelerationInput * deltaTime;
        } else {
            this.speed *= Math.pow(CONFIG.vehicleFriction, deltaTime * 60);
        }
        if (input.handbrake) this.speed *= Math.pow(1 - CONFIG.vehicleHandbrake * 0.1, deltaTime * 60);
        const maxForwardSpeed = eng.maxSpeed;
        const maxReverseSpeed = CONFIG.vehicleMaxSpeed * 0.3;
        this.speed = THREE.MathUtils.clamp(this.speed, -maxReverseSpeed, maxForwardSpeed);
        let steeringInput = 0;
        if (hasJoystickInput) steeringInput = -joystickVector.x;
        else if (input.left) steeringInput = 1.0;
        else if (input.right) steeringInput = -1.0;
        const speedFactor = Math.abs(this.speed) / Math.max(0.01, eng.maxSpeed);
        const steeringSensitivity = eng.steer * (1 - speedFactor * 0.5);
        if (Math.abs(steeringInput) > 0.1) this.steering += steeringInput * steeringSensitivity * deltaTime;
        else this.steering *= Math.pow(0.85, deltaTime * 60);
        this.steering = THREE.MathUtils.clamp(this.steering, -CONFIG.vehicleMaxSteering, CONFIG.vehicleMaxSteering);
        if (Math.abs(this.speed) > 0.5) {
            this.angularVelocity = this.steering * (this.speed / eng.maxSpeed) * eng.grip;
        } else {
            this.angularVelocity = 0;
        }
        this.angularVelocity *= CONFIG.vehicleAngularDamping;
        this.rotation += this.angularVelocity * deltaTime;
        const forwardDirection = new THREE.Vector3(0, 0, -1);
        forwardDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation);
        this.velocity.x = forwardDirection.x * this.speed;
        this.velocity.z = forwardDirection.z * this.speed;
        const terrainHeight = world.getTerrainHeight(this.position.x, this.position.z);
        const groundLevel = terrainHeight + CONFIG.vehicleGroundHeight;
        if (this.position.y > groundLevel + 0.01) this.velocity.y += CONFIG.vehicleGravity * deltaTime;
        else { this.velocity.y = 0; this.position.y = groundLevel; }
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;
        this.position.z += this.velocity.z * deltaTime;
        if (this.position.y <= groundLevel) { this.position.y = groundLevel; this.velocity.y = 0; }
        else this.velocity.y -= CONFIG.vehicleGravity * 0.5 * deltaTime;
        this.velocity.y = Math.min(this.velocity.y, 5.0);
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.rotation;
        this.wheelRotation += this.speed * deltaTime * 3;
        if (this.wheels) {
            this.wheels.forEach(wheel => {
                if (wheel.children[0]) wheel.children[0].rotation.x = this.wheelRotation;
                if (wheel.children[1]) wheel.children[1].rotation.x = this.wheelRotation;
                if (wheel.userData.steerable) wheel.rotation.y = this.steering;
                else wheel.rotation.y = 0;
            });
        }
    }
    applyTransform(deltaTime) {
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.rotation;
        this.wheelSpin += this.speed * deltaTime * 3;
        for (const w of this.wheels) {
            w.children[0].rotation.x = this.wheelSpin;
            w.children[1].rotation.x = this.wheelSpin;
            if (w.userData.steerable) w.rotation.y = this.steering * 0.6;
        }
    }
}

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

class Pedestrian {
    constructor(scene, world, index) {
        this.scene = scene;
        this.world = world;
        this.index = index;

        // ---- Story identity: deterministic archetype assignment ----
        const v = NPC_VARIETIES[index % NPC_VARIETIES.length];
        const variant = Math.floor(index / NPC_VARIETIES.length); // sub-variant of the archetype
        const rng = npcRng(0xA5C3 ^ Math.imul(index + 1, 2654435761));
        this.variety = v;
        this.name = v.names[variant % v.names.length];
        this.gender = v.gender;
        this.heightScale = v.h * (0.94 + rng() * 0.12);      // individual height
        this.buildScale = v.build * (0.92 + rng() * 0.16);   // individual weight/width
        this.legLen = 0.72 + rng() * 0.14;
        this.shoeExtra = 0.02 + rng() * 0.05;
        this.skinMat = CarGeoCache.mat(v.skin);
        this.shirtMat = CarGeoCache.mat(v.shirt);
        this.pantsMat = CarGeoCache.mat(v.pants);
        this.hairMat = CarGeoCache.mat(v.hairCol);
        this.speedMul = 0.85 + rng() * 0.4;
        this.bearded = v.gender === 'm' && rng() < 0.35;

        // ---- Fixed daily path: home lot -> driveway -> sidewalk route -> work post ----
        this.homeLot = HOME_STREETS[(index * 13 + variant * 7) % HOME_STREETS.length];
        this.driveSpot = [this.homeLot[0] + (rng() < 0.5 ? 3 : -3), this.homeLot[1] + 2.5];
        const zoneList = Object.keys(WORKPLACES);
        const zone = v.id === 'fisherman' ? 'harbor'
            : v.id === 'student' ? 'campus'
            : v.id === 'nurse' ? 'hospital'
            : v.id === 'firefighter' ? 'fire'
            : v.id === 'mechanic' ? 'garage'
            : v.id === 'drunk' ? 'bar'
            : v.id === 'vendor' ? 'market'
            : (v.id === 'gardener' || v.id === 'jogger') ? 'parkPost'
            : v.id === 'businesswoman' ? 'bankPlaza'
            : v.id === 'chef' ? 'oldTown'
            : v.id === 'cop' ? zoneList[Math.floor(index / 4) % zoneList.length]
            : zoneList[(index * 5 + variant) % zoneList.length];
        const posts = WORKPLACES[zone];
        this.workZone = zone;
        this.workPost = posts[(index * 3 + variant) % posts.length];

        this.position = new THREE.Vector3();
        this.rotation = 0;
        this.speed = 0;
        this.target = new THREE.Vector3();
        this.state = 'WALK'; // WALK | FLEE | DEAD
        this.deadTimer = 0;
        this.walkPhase = rng() * 10;
        this.pauseTimer = 0;
        this.wobble = !!v.wobble;

        this._route = [];      // ordered waypoints for the current leg
        this._routeIdx = 0;
        this._phase = '';      // HOME | COMMUTE | WORK | RETURN
        this._waitAtPost = 0;

        this.group = new THREE.Group();
        this._buildBody(rng);
        scene.add(this.group);
    }

    // ------------------------------------------------------------
    // HIGH-DETAIL LOW-POLY BODY — every NPC assembled from 30+
    // geometric primitives: spheres (skull/jaw/shoulders/knees/elbows/
    // hands-as-octahedra), tapered cylinders (limbs, neck, rods), cones
    // (nose, skirt), boxes (chest, hips, shoes, hair, props), tori
    // (belts/headbands), tetrahedra (collar). No plain "box man".
    // ------------------------------------------------------------
    _buildBody(rng) {
        const G = this.group;
        const b = this.buildScale;
        const cyl = (rt, rb, h, seg) => CarGeoCache.cyl(Math.round(rt * 1e4) / 1e4, Math.round(rb * 1e4) / 1e4, Math.round(h * 1e4) / 1e4, seg);
        const box = (w, h2, d) => CarGeoCache.box(Math.round(w * 1e4) / 1e4, Math.round(h2 * 1e4) / 1e4, Math.round(d * 1e4) / 1e4);
        const sph = (r) => CarGeoCache.sph(Math.round(r * 1e4) / 1e4);
        const oct = (r) => {
            const rr = Math.round(r * 1e4) / 1e4, k = `o${rr}`;
            if (!CarGeoCache._cache.has(k)) CarGeoCache._cache.set(k, new THREE.OctahedronGeometry(rr));
            return CarGeoCache._cache.get(k);
        };
        const cone = (r, h, seg) => {
            const k = `n${Math.round(r * 1e4) / 1e4}_${Math.round(h * 1e4) / 1e4}_${seg}`;
            if (!CarGeoCache._cache.has(k)) CarGeoCache._cache.set(k, new THREE.ConeGeometry(Math.round(r * 1e4) / 1e4, Math.round(h * 1e4) / 1e4, seg));
            return CarGeoCache._cache.get(k);
        };
        const tor = (r, t) => {
            const k = `t${Math.round(r * 1e4) / 1e4}_${Math.round(t * 1e4) / 1e4}`;
            if (!CarGeoCache._cache.has(k)) CarGeoCache._cache.set(k, new THREE.TorusGeometry(Math.round(r * 1e4) / 1e4, Math.round(t * 1e4) / 1e4, 5, 8));
            return CarGeoCache._cache.get(k);
        };
        const tet = (r) => {
            const rr = Math.round(r * 1e4) / 1e4, k = `e${rr}`;
            if (!CarGeoCache._cache.has(k)) CarGeoCache._cache.set(k, new THREE.TetrahedronGeometry(rr));
            return CarGeoCache._cache.get(k);
        };
        const add = (geo, mat, x, y, z, rx, ry, rz) => {
            const m = new THREE.Mesh(geo, mat);
            m.position.set(x, y, z);
            if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
            m.castShadow = true;
            G.add(m);
            return m;
        };
        const female = this.gender === 'f';
        const legTop = this.legLen;

        // --- Legs: upper cylinder + knee sphere + lower tapered cylinder + shoe box ---
        this.legL = new THREE.Group(); this.legR = new THREE.Group();
        for (const pair of [[this.legL, -1], [this.legR, 1]]) {
            const grp = pair[0], side = pair[1];
            const sx = side * 0.11 * b;
            const u = new THREE.Mesh(cyl(0.085 * b, 0.07 * b, legTop * 0.55, 6), this.pantsMat);
            u.position.y = legTop * 0.72; u.castShadow = true; grp.add(u);           // 1 thigh
            const knee = new THREE.Mesh(sph(0.068 * b), this.pantsMat);
            knee.position.y = legTop * 0.45; grp.add(knee);                            // 2 knee
            const lo = new THREE.Mesh(cyl(0.066 * b, 0.055 * b, legTop * 0.45, 6), this.pantsMat);
            lo.position.y = legTop * 0.22; lo.castShadow = true; grp.add(lo);          // 3 shin
            const shoe = new THREE.Mesh(box(0.12 * b, 0.07, 0.26 + this.shoeExtra), CarGeoCache.mat(0x1c1c1c));
            shoe.position.set(0, 0.035, -0.05); shoe.castShadow = true; grp.add(shoe); // 4 shoe
            grp.position.set(sx, legTop, 0);
            G.add(grp);
        }

        // --- Torso: hips box + chest box + shoulder spheres + collar tetrahedron ---
        const chestH = 0.34 * (female ? 0.92 : 1.0), chestW = (female ? 0.34 : 0.42) * b;
        this.torsoY = legTop + 0.30;
        add(box(chestW * 0.96, 0.2, 0.2 * b), this.pantsMat, 0, legTop + 0.1, 0);              // 5 hips
        add(box(chestW, chestH, 0.22 * b), this.shirtMat, 0, legTop + 0.1 + chestH / 2 + 0.06, 0); // 6 chest
        if (female) add(sph(0.085 * b), this.shirtMat, 0, legTop + 0.36, -0.115 * b);          // 7 bust form
        add(sph(0.075 * b), this.shirtMat, -chestW / 2 - 0.02, legTop + 0.52, 0);              // 8 shoulder L
        add(sph(0.075 * b), this.shirtMat, chestW / 2 + 0.02, legTop + 0.52, 0);               // 9 shoulder R
        add(tet(0.09), this.shirtMat, 0, legTop + 0.62, 0, 0, Math.PI / 4, 0);                 // 10 collar

        // --- Arms: upper cyl + elbow sphere + forearm cyl + octahedron hand ---
        this.armL = new THREE.Group(); this.armR = new THREE.Group();
        for (const pair of [[this.armL, -1], [this.armR, 1]]) {
            const grp = pair[0], side = pair[1];
            const up = new THREE.Mesh(cyl(0.055 * b, 0.05 * b, 0.3, 6), this.shirtMat);
            up.position.y = -0.15; up.castShadow = true; grp.add(up);                       // 11/15 upper arm
            const el = new THREE.Mesh(sph(0.05 * b), this.shirtMat);
            el.position.y = -0.3; grp.add(el);                                              // 12/16 elbow
            const fo = new THREE.Mesh(cyl(0.048 * b, 0.04 * b, 0.26, 6), this.skinMat);
            fo.position.y = -0.44; fo.castShadow = true; grp.add(fo);                       // 13/17 forearm
            const hand = new THREE.Mesh(oct(0.05 * b), this.skinMat);
            hand.position.y = -0.58; grp.add(hand);                                         // 14/18 hand
            grp.position.set(side * (chestW / 2 + 0.06), legTop + 0.55, 0);
            G.add(grp);
        }

        // --- Head: neck cyl + skull sphere + jaw box + nose cone + ears + eyes +
        //     brows + mouth + hair cap + hair back slab (+ long hair / beard) ---
        const headY = legTop + 0.72;
        this.headGrp = new THREE.Group();
        const mk = (geo, mat, x, y, z) => {
            const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
            m.castShadow = true; this.headGrp.add(m); return m;
        };
        mk(cyl(0.05, 0.055, 0.08, 6), this.skinMat, 0, headY - 0.06, 0);                     // 19 neck
        const skull = mk(sph(0.125), this.skinMat, 0, headY + 0.08, 0);                      // 20 skull
        skull.scale.set(0.92, 1.05, 0.95);
        mk(box(0.16, 0.09, 0.15), this.skinMat, 0, headY - 0.01, -0.02);                     // 21 jaw
        const nose = mk(cone(0.022, 0.06, 4), this.skinMat, 0, headY + 0.06, -0.13);         // 22 nose
        nose.rotation.x = -Math.PI / 2;
        mk(sph(0.028), this.skinMat, -0.115, headY + 0.07, 0);                               // 23 ear L
        mk(sph(0.028), this.skinMat, 0.115, headY + 0.07, 0);                                // 24 ear R
        const eyeMat = CarGeoCache.mat(0x1a1a1a);
        mk(sph(0.016), eyeMat, -0.045, headY + 0.09, -0.115);                                // 25 eye L
        mk(sph(0.016), eyeMat, 0.045, headY + 0.09, -0.115);                                 // 26 eye R
        mk(box(0.05, 0.012, 0.02), this.hairMat, -0.045, headY + 0.125, -0.112);             // 27 brow L
        mk(box(0.05, 0.012, 0.02), this.hairMat, 0.045, headY + 0.125, -0.112);              // 28 brow R
        mk(box(0.05, 0.012, 0.015), CarGeoCache.mat(0x8d4a4a), 0, headY - 0.02, -0.125);     // 29 mouth
        const hairCap = mk(sph(0.132), this.hairMat, 0, headY + 0.13, 0);                    // 30 hair cap
        hairCap.scale.set(0.95, 0.72, 0.98);
        mk(box(0.2, 0.14, 0.06), this.hairMat, 0, headY + 0.06, 0.1);                        // 31 hair back
        if (female) mk(box(0.22, 0.34, 0.07), this.hairMat, 0, headY - 0.12, 0.11);          // 32 long hair
        if (this.bearded) mk(box(0.14, 0.07, 0.05), this.hairMat, 0, headY - 0.03, -0.1);    // 33 beard
        G.add(this.headGrp);

        // --- Outfit extras & hats per archetype (silhouette storytelling) ---
        const v = this.variety;
        if (v.apron) add(box(chestW * 0.8, 0.5, 0.05), CarGeoCache.mat(0xFAFAFA), 0, legTop + 0.36, -0.12 * b);
        if (v.suit) {
            add(box(0.06, chestH + 0.1, 0.03), CarGeoCache.mat(0x1c1c22), -chestW * 0.22, legTop + 0.42, -0.12 * b); // lapel L
            add(box(0.06, chestH + 0.1, 0.03), CarGeoCache.mat(0x1c1c22), chestW * 0.22, legTop + 0.42, -0.12 * b); // lapel R
            add(box(0.05, 0.24, 0.03), CarGeoCache.mat(0xB71C1C), 0, legTop + 0.44, -0.13 * b);                      // tie
        }
        if (v.skirt) add(cone(0.24 * b, 0.34, 8), this.pantsMat, 0, legTop + 0.02, 0, Math.PI, 0, 0);
        if (v.belt) { const bt = new THREE.Mesh(tor(0.19 * b, 0.02), CarGeoCache.mat(0x212121)); bt.rotation.x = Math.PI / 2; bt.position.y = legTop + 0.16; G.add(bt); }
        if (v.headband) { const hb = new THREE.Mesh(tor(0.13, 0.018), CarGeoCache.mat(0xE53935)); hb.rotation.x = Math.PI / 2; hb.position.y = headY + 0.16; this.headGrp.add(hb); }
        if (v.backpack) { const bp2 = new THREE.Mesh(box(0.24, 0.3, 0.12), CarGeoCache.mat(0x37474F)); bp2.position.set(0, legTop + 0.42, 0.16 * b); G.add(bp2); }
        if (v.bag) { const bg = new THREE.Mesh(box(0.16, 0.18, 0.08), CarGeoCache.mat(0x6D4C41)); bg.position.set(0.24 * b, legTop + 0.2, 0); G.add(bg); }
        if (v.cane) { const cn = new THREE.Mesh(cyl(0.018, 0.018, 0.9, 5), CarGeoCache.mat(0x4E342E)); cn.position.set(0.3, legTop * 0.6, -0.1); G.add(cn); }
        if (v.hat === 'chef') {
            const hc = new THREE.Mesh(cyl(0.1, 0.11, 0.16, 8), CarGeoCache.mat(0xFFFFFF)); hc.position.y = headY + 0.24; this.headGrp.add(hc);
            const hb2 = new THREE.Mesh(sph(0.11), CarGeoCache.mat(0xFFFFFF)); hb2.position.y = headY + 0.33; this.headGrp.add(hb2);
        }
        if (v.hat === 'cap') {
            const cc = new THREE.Mesh(sph(0.135), CarGeoCache.mat(v.hatCol || 0x1A3A6B)); cc.scale.set(1, 0.55, 1); cc.position.y = headY + 0.16; this.headGrp.add(cc);
            const br = new THREE.Mesh(box(0.12, 0.02, 0.1), CarGeoCache.mat(v.hatCol || 0x1A3A6B)); br.position.set(0, headY + 0.13, -0.16); this.headGrp.add(br);
        }
        if (v.hat === 'beanie') { const bn = new THREE.Mesh(sph(0.135), CarGeoCache.mat(0x2E7D32)); bn.scale.set(1, 0.7, 1); bn.position.y = headY + 0.17; this.headGrp.add(bn); }
        if (v.hat === 'straw' || v.hat === 'brim') {
            const col = v.hat === 'straw' ? 0xD7B860 : v.shirt;
            const cb = new THREE.Mesh(cyl(0.09, 0.1, 0.12, 8), CarGeoCache.mat(col)); cb.position.y = headY + 0.2; this.headGrp.add(cb);
            const brim = new THREE.Mesh(cyl(0.2, 0.2, 0.02, 10), CarGeoCache.mat(v.hat === 'straw' ? 0xC8A94F : v.shirt)); brim.position.y = headY + 0.15; this.headGrp.add(brim);
        }

        // --- Handheld tool/prop anchored to the right arm ---
        if (v.prop) {
            const pg = new THREE.Group();
            const pm = (c) => CarGeoCache.mat(c);
            const pmesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); pg.add(m); return m; };
            switch (v.prop) {
                case 'briefcase': pmesh(box(0.18, 0.14, 0.06), pm(0x5D4037), 0, 0, 0); break;
                case 'clipboard': pmesh(box(0.14, 0.19, 0.02), pm(0xFFF9C4), 0, 0, 0).rotation.x = -0.4; break;
                case 'book': pmesh(box(0.13, 0.03, 0.18), pm(0x1565C0), 0, 0, 0); break;
                case 'rod': pmesh(cyl(0.01, 0.02, 1.4, 5), pm(0x8D6E63), 0.2, 0.3, 0).rotation.z = 0.6; break;
                case 'rake':
                    pmesh(cyl(0.015, 0.015, 1.3, 5), pm(0x795548), 0, 0.4, 0);
                    pmesh(box(0.3, 0.03, 0.03), pm(0x9E9E9E), 0, 1.05, 0); break;
                case 'wrench': pmesh(box(0.04, 0.26, 0.04), pm(0x9E9E9E), 0, 0, 0); break;
                case 'cleaver': pmesh(box(0.03, 0.2, 0.12), pm(0xB0BEC5), 0, 0, 0); break;
                case 'axe':
                    pmesh(cyl(0.015, 0.015, 0.8, 5), pm(0x795548), 0, 0.2, 0);
                    pmesh(box(0.16, 0.14, 0.03), pm(0xB0BEC5), 0, 0.6, 0); break;
                case 'bottle': pmesh(cyl(0.03, 0.035, 0.16, 6), pm(0x2E7D32), 0, 0.06, 0); break;
                case 'pan': pmesh(cyl(0.1, 0.09, 0.05, 8), pm(0x424242), 0, 0, 0); break;
                case 'parcel': pmesh(box(0.16, 0.12, 0.12), pm(0xBCAAA4), 0, 0, 0); break;
                case 'tote': pmesh(box(0.14, 0.18, 0.07), pm(0xA1887F), 0, 0, 0); break;
                case 'crate': pmesh(box(0.2, 0.16, 0.2), pm(0x8D6E63), 0, 0, 0); break;
                case 'guitar':
                    pmesh(sph(0.11), pm(0x8D6E63), 0, 0, 0).scale.set(0.8, 1, 0.4);
                    pmesh(box(0.03, 0.5, 0.03), pm(0x5D4037), 0, 0.3, 0); break;
                case 'radio': pmesh(box(0.05, 0.1, 0.03), pm(0x212121), 0, 0, 0); break;
            }
            pg.position.y = -0.6;
            this.armR.add(pg);
        }

        G.scale.setScalar(this.heightScale);
    }

    // ------------------------------------------------------------
    // DAILY ROUTINE (game-clock driven, never random):
    // HOME lot -> driveway car spot -> sidewalk commute -> WORK post -> home
    // ------------------------------------------------------------
    _hour() {
        const g = window.__game;
        return (g && g.dayNightCycle && typeof g.dayNightCycle.gameTime === 'number')
            ? g.dayNightCycle.gameTime : 12;
    }

    _inWorkWindow() {
        const v = this.variety, h = this._hour();
        return v.hours[0] < v.hours[1] ? (h >= v.hours[0] && h < v.hours[1])
                                       : (h >= v.hours[0] || h < v.hours[1]); // overnight shift
    }

    _sidewalkPoint(x, z) {
        // Snap a target onto the nearest sidewalk shoulder so routes hug streets.
        const roads = this.world._roadPolylines;
        let best = null, bd = 1e9;
        if (roads) {
            for (let i = 0; i < roads.length; i += 3) {
                const s = roads[i];
                const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
                const len2 = dx * dx + dz * dz || 1;
                let t = ((x - s.x1) * dx + (z - s.z1) * dz) / len2;
                t = Math.max(0, Math.min(1, t));
                const px = s.x1 + dx * t, pz = s.z1 + dz * t;
                const d = Math.hypot(px - x, pz - z);
                if (d < bd) {
                    bd = d;
                    const l = Math.sqrt(len2);
                    const off = s.width / 2 + 1.6;
                    const sgn = ((x - px) * (-dz / l) + (z - pz) * (dx / l)) >= 0 ? 1 : -1;
                    best = [px + (-dz / l) * off * sgn, pz + (dx / l) * off * sgn];
                }
            }
        }
        return best || [x, z];
    }

    _setLeg(dest) {
        // Explicit waypoint route: midpoint sidewalk node -> destination sidewalk node.
        const mid = this._sidewalkPoint((this.position.x + dest[0]) / 2, (this.position.z + dest[1]) / 2);
        const end = this._sidewalkPoint(dest[0], dest[1]);
        this._route = [mid, end];
        this._routeIdx = 0;
    }

    spawnInitial() {
        // Place at whichever phase the game clock demands — deterministic jitter only.
        const rng = npcRng(0xBEEF ^ Math.imul(this.index + 1, 40503));
        const jx = (rng() - 0.5) * 6, jz = (rng() - 0.5) * 6;
        const atWork = this._inWorkWindow();
        const p = atWork ? [this.workPost[0] + jx, this.workPost[1] + jz]
                         : [this.homeLot[0] + jx, this.homeLot[1] + jz];
        this.position.set(p[0], this.world.getGroundHeight(p[0], p[1]), p[1]);
        this._phase = atWork ? 'WORK' : 'HOME';
        this._waitAtPost = 2 + rng() * 4;
        this.target.copy(this.position);
        this.state = 'WALK';
        this.deadTimer = 0;
        this.group.visible = true;
        this.group.rotation.set(0, 0, 0);
        this.group.position.copy(this.position);
    }

    spawnAt(x, z) {
        this.position.set(x, this.world.getGroundHeight(x, z), z);
        this.state = 'WALK';
        this.deadTimer = 0;
        this.group.visible = true;
    }

    die() {
        if (this.state === 'DEAD') return false;
        this.state = 'DEAD';
        this.deadTimer = 0;
        return true;
    }

    respawnNear(playerPos) { /* superseded by schedule-driven spawnInitial() */ }

    update(deltaTime, playerPos, playerThreat) {
        if (this.state === 'DEAD') {
            this.deadTimer += deltaTime;
            this.group.rotation.x = Math.min(Math.PI / 2, this.deadTimer * 5);
            this.group.position.copy(this.position);
            return;
        }

        // ---- Phase machine driven purely by the game clock ----
        const atWork = this._inWorkWindow();
        if (atWork && this._phase === 'HOME') { this._phase = 'COMMUTE'; this._setLeg(this.workPost); }
        else if (!atWork && (this._phase === 'WORK' || this._phase === 'COMMUTE')) { this._phase = 'RETURN'; this._setLeg(this.homeLot); }

        const distToPlayer = Math.hypot(playerPos.x - this.position.x, playerPos.z - this.position.z);
        const threat = playerThreat && distToPlayer < 14;
        if (threat) this.state = 'FLEE';
        else if (this.state === 'FLEE' && distToPlayer > 25) this.state = 'WALK';

        let moveTarget = this.target;
        let stepSpeed = 1.35 * this.speedMul;
        if (this.state === 'FLEE') {
            const ax = this.position.x - playerPos.x, az = this.position.z - playerPos.z;
            const al = Math.hypot(ax, az) || 1;
            moveTarget = { x: this.position.x + (ax / al) * 20, z: this.position.z + (az / al) * 20 };
            stepSpeed = 4.6;
        } else if (this._phase === 'WORK' || this._phase === 'HOME') {
            // Standing at the work post / home stoop: idle breathing only, no wandering.
            this.speed = 0;
            if (this._waitAtPost > 0) this._waitAtPost -= deltaTime;
            else if (this._phase === 'HOME' && atWork) { this._phase = 'COMMUTE'; this._setLeg(this.workPost); }
            else if (this._phase === 'WORK' && !atWork) { this._phase = 'RETURN'; this._setLeg(this.homeLot); }
            this._idle(deltaTime);
            return;
        } else {
            // COMMUTE / RETURN: follow the explicit designed waypoint route.
            if (this._routeIdx >= this._route.length) {
                this._phase = (this._phase === 'COMMUTE') ? 'WORK' : 'HOME';
                this._waitAtPost = 1 + ((this.index * 31) % 5);
                this.target.copy(this.position);
                this._idle(deltaTime);
                return;
            }
            const wp = this._route[this._routeIdx];
            moveTarget = { x: wp[0], z: wp[1] };
            if (Math.hypot(wp[0] - this.position.x, wp[1] - this.position.z) < 1.6) this._routeIdx++;
        }

        const dx = moveTarget.x - this.position.x;
        const dz = moveTarget.z - this.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist < 1.2 && this.state !== 'FLEE') {
            this.speed = 0;
        } else {
            const wantRot = Math.atan2(-dx, -dz);
            let diff = wantRot - this.rotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            this.rotation += THREE.MathUtils.clamp(diff, -4 * deltaTime, 4 * deltaTime);
            this.speed = stepSpeed;
            const nx = this.position.x - Math.sin(this.rotation) * this.speed * deltaTime;
            const nz = this.position.z - Math.cos(this.rotation) * this.speed * deltaTime;
            let blocked = false;
            const cs = this.world.collisionSystem;
            if (cs && cs.colliders) {
                for (const c of cs.colliders) {
                    if (c instanceof BoxCollider) {
                        const hw = (c.width || 0) / 2 + 0.4, hd = (c.depth || 0) / 2 + 0.4;
                        if (nx > c.position.x - hw && nx < c.position.x + hw &&
                            nz > c.position.z - hd && nz < c.position.z + hd) { blocked = true; break; }
                    }
                }
            }
            if (!blocked) { this.position.x = nx; this.position.z = nz; }
            else if (this._routeIdx < this._route.length) {
                // Route clipped a wall corner: advance to next designed waypoint (never random).
                this._routeIdx++;
            }
        }

        this.position.y = this.world.getGroundHeight(this.position.x, this.position.z);
        this.group.position.copy(this.position);
        this.group.rotation.y = this.rotation;
        if (this.wobble) this.group.rotation.z = Math.sin(this.walkPhase * 0.7) * 0.08;

        this.walkPhase += deltaTime * this.speed * 2.4;
        const swing = Math.sin(this.walkPhase) * (this.speed > 3 ? 0.9 : 0.55);
        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing;
        this.armL.rotation.x = -swing * 0.8;
        this.armR.rotation.x = swing * 0.8;
    }

    _idle(deltaTime) {
        this.position.y = this.world.getGroundHeight(this.position.x, this.position.z);
        this.group.position.copy(this.position);
        this.walkPhase += deltaTime * 1.2;
        const breathe = Math.sin(this.walkPhase) * 0.03;
        this.legL.rotation.x = 0; this.legR.rotation.x = 0;
        this.armL.rotation.x = breathe; this.armR.rotation.x = -breathe;
    }
}
