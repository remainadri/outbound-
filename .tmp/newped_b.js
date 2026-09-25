
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
        const cyl = (rt, rb, h, seg) => CarGeoCache.cyl(rt, rb, h, seg);
        const box = (w, h2, d) => CarGeoCache.box(w, h2, d);
        const sph = (r) => new THREE.SphereGeometry(r, 8, 6);
        const oct = (r) => new THREE.OctahedronGeometry(r);
        const cone = (r, h, seg) => new THREE.ConeGeometry(r, h, seg);
        const tor = (r, t) => new THREE.TorusGeometry(r, t, 5, 8);
        const tet = (r) => new THREE.TetrahedronGeometry(r);
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
