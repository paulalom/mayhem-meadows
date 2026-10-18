/* Primitive-based models match the approved alien C and classic saucer A. */
(function (root) {
  'use strict';
  const UNIT = 20, SCALE = root.MayhemPhysics?.CHARACTER_SCALE ?? .86;
  const TAU = Math.PI * 2;

  function character(scene, disguised = true) {
    const T = scene.T, group = new T.Group();
    group.name = disguised ? 'Alien C in obvious human disguise' : 'Alien C pilot';
    const skin = '#8d9da4', dark = '#353a40', mustard = '#b49a50';
    const box = (parent, color, x, y, z, w, h, d) => scene._box(parent, color, x, y, z, w, h, d);
    const oval = (parent, color, x, y, z, w, h, d) => scene._mesh(scene._sphere, scene._material(color), parent, x, y, z, w, h, d);
    const cylinder = (parent, color, x, y, z, w, h, d) => scene._mesh(scene._cylinder, scene._material(color), parent, x, y, z, w, h, d);
    const torso = box(group, mustard, 0, 1.03, 0, .29, .57, .38);
    box(group, '#514e48', -.12, 1.04, 0, .08, .59, .40);
    const sash = box(group, '#605c54', .165, 1.13, -.04, .035, .36, .35); sash.rotation.x = -.42;
    const clasp = oval(group, '#bfc2b5', .204, 1.22, .045, .035, .07, .095);
    clasp.name = 'Off-center alien clasp';
    // A pointed overlapping hem distinguishes the tunic from an Earth jacket.
    const hem = scene._mesh(scene._cone, scene._material(mustard), group, .08, .74, -.03, .18, .23, .18);
    hem.rotation.z = Math.PI;
    box(group, '#727c7d', -.02, .92, .25, .11, .19, .09);
    cylinder(group, skin, 0, 1.47, 0, .075, .30, .085);
    const head = new T.Group(); head.name = 'Wide cranium, long nose and grumpy face'; head.position.y = 1.78; group.add(head);
    oval(head, skin, -.10, .065, 0, .32, .24, .29);
    oval(head, skin, .10, -.10, 0, .19, .24, .18);
    const nose = scene._mesh(scene._cone, scene._material('#8999a1'), head, .285, -.075, 0, .085, .22, .085);
    nose.rotation.z = -Math.PI + .4;
    oval(head, '#8b9ba3', .19, -.26, 0, .12, .12, .12);
    for (const sign of [-1, 1]) {
      oval(head, '#6d7b85', .16, .025, sign * .16, .14, .10, .103);
      oval(head, '#dfdfcd', .245, .02, sign * .16, .035, .059, .071);
      oval(head, '#544938', .277, .02, sign * .153, .012, .042, .036);
      oval(head, '#242b33', .287, .02, sign * .149, .009, .028, .023);
      const brow = box(head, '#677884', .265, .091, sign * .155, .065, .046, .15);
      brow.rotation.x = -sign * .34;
      // Inverted arch: both mouth corners sit lower than the centre.
      const lip = box(head, '#37464f', .297, -.205, sign * .043, .015, .014, .096);
      lip.rotation.x = sign * .40;
    }
    const limbs = {};
    for (const [name, sign] of [['left', -1], ['right', 1]]) {
      const leg = new T.Group(); leg.position.set(0, .72, sign * .115); group.add(leg);
      box(leg, dark, 0, -.30, 0, .12, .60, .13);
      box(leg, '#768183', 0, -.55, 0, .135, .09, .15);
      box(leg, '#58656d', .055, -.66, 0, .27, .11, .16);
      const arm = new T.Group(); arm.position.set(0, 1.29, sign * .25); group.add(arm);
      box(arm, mustard, 0, -.14, 0, .15, .30, .17);
      box(arm, skin, 0, -.35, 0, .095, .20, .10);
      box(arm, '#747e80', 0, -.47, 0, .115, .21, .12);
      box(arm, skin, .018, -.63, 0, .085, .14, .10);
      for (let finger = 0; finger < 3; finger++) box(arm, skin, .04, -.73, (finger - 1) * .035, .035, .12, .025);
      limbs[name + 'Leg'] = leg; limbs[name + 'Arm'] = arm;
      scene._mergeColored(leg); scene._mergeColored(arm);
    }
    let costume = null;
    if (disguised) {
      costume = new T.Group(); costume.name = 'Taped moustache, fake eyebrows, spectacles and tiny hat'; head.add(costume);
      // Empty rectangular frames let the real eyes remain visible.
      for (const sign of [-1, 1]) {
        for (const side of [-1, 1]) box(costume, '#292d31', .306, .02, sign * .16 + side * .087, .025, .16, .024);
        for (const side of [-1, 1]) box(costume, '#292d31', .306, .02 + side * .075, sign * .16, .025, .022, .19);
        const fakeBrow = box(costume, '#242728', .305, .145, sign * .16, .065, .064, .19); fakeBrow.rotation.x = -sign * .48;
        const tape = box(costume, '#e7ddbb', .34, .18, sign * .246, .014, .10, .04); tape.rotation.x = sign * .45;
        oval(costume, '#272b2c', .37, -.135, sign * .10, .055, .065, .145);
        const tab = box(costume, '#e7ddbb', .40, -.115, sign * .235, .016, .085, .04); tab.rotation.x = -sign * .45;
      }
      box(costume, '#292d31', .319, .045, 0, .025, .022, .10);
      cylinder(costume, '#514b3c', -.10, .285, 0, .25, .035, .22);
      cylinder(costume, '#605744', -.10, .36, 0, .17, .15, .15);
      cylinder(costume, '#353b3c', -.10, .31, 0, .174, .045, .154);
      scene._mergeColored(costume);
    }
    scene._mergeColored(head); scene._mergeColored(group);
    group.scale.setScalar(SCALE);
    return { group, head, costume, torso, ...limbs, color: mustard, player: false, alien: true };
  }

  function saucer(scene) {
    const T = scene.T, group = new T.Group(); group.name = 'Saucer A: classic silver visitor';
    const profile = [[0, -.72], [1.5, -.75], [3.5, -.30], [4.4, 0], [4.35, .16], [2.6, .55], [1.5, .72], [0, .72]];
    const hullGeometry = scene._geometry(new T.LatheGeometry(profile.map(([x, y]) => new T.Vector2(x, y)), 24));
    const hull = scene._mesh(hullGeometry, scene._material('#a4afb0'), group, 0, 0, 0); hull.name = 'Broad shallow silver disc';
    const bandGeometry = scene._geometry(new T.CylinderGeometry(4.4, 4.4, .08, 24, 1, true));
    scene._mesh(bandGeometry, scene._material('#68777d'), group, 0, .045, 0);
    const domeGeometry = scene._geometry(new T.SphereGeometry(1, 20, 6, 0, TAU, 0, Math.PI / 2));
    scene._mesh(domeGeometry, scene._material('#b5bdba'), group, 0, 2.33, 0, 1.67, .47, 1.67);
    // A real glazed opening, with an independently modeled pilot behind it.
    const glazing = scene._material('#a6d7d8', { opacity: .15 }); glazing.depthWrite = false;
    glazing.side = T.DoubleSide;
    const windowGeometry = scene._geometry(new T.CylinderGeometry(1.67, 1.67, 1.34, 24, 1, true));
    const window = scene._mesh(windowGeometry, glazing, group, 0, 1.66, 0, 1, 1, 1, false); window.name = 'Transparent cockpit window';
    const floor = scene._mesh(scene._cylinder, scene._material('#475962'), group, 0, .94, 0, 1.67, .12, 1.67);
    for (let i = 0; i < 6; i++) {
      const angle = i * TAU / 6 + Math.PI / 6;
      scene._box(group, '#61717a', Math.cos(angle) * 1.63, 1.66, Math.sin(angle) * 1.63, .065, 1.35, .065);
    }
    const pilot = character(scene, false); pilot.group.name = 'Undisguised alien pilot visible through window';
    pilot.group.position.set(.17, .93, 0); pilot.group.scale.multiplyScalar(.81);
    pilot.leftLeg.rotation.z = -1.5; pilot.rightLeg.rotation.z = -1.5;
    pilot.leftArm.rotation.z = -.65; pilot.rightArm.rotation.z = -.65; group.add(pilot.group);
    scene._box(group, '#364b56', .89, 1.17, 0, .25, .20, .62);
    for (const sign of [-1, 1]) scene._box(group, '#e8ce88', 1.027, 1.20, sign * .15, .025, .06, .12);
    const aerial = scene._mesh(scene._cylinder, scene._material('#66777d'), group, -1.0, 3.03, .3, .035, .90, .035); aerial.rotation.z = -.18;
    scene._mesh(scene._sphere, scene._material('#7d8c89'), group, -.92, 3.49, .3, .09, .09, .09);
    for (let i = 0; i < 3; i++) {
      const angle = i * TAU / 3;
      scene._box(group, '#586870', Math.cos(angle) * 2.4, -.61, Math.sin(angle) * 2.4, .15, .40, .15);
      scene._mesh(scene._cylinder, scene._material('#8f9c9e'), group, Math.cos(angle) * 2.4, -.84, Math.sin(angle) * 2.4, .34, .10, .34);
    }
    scene._mergeColored(group, [window]);
    scene.scene.add(group);
    const beamMaterial = scene._material('#b8edb8', { unlit: true, opacity: .18, depthWrite: false }); beamMaterial.side = T.DoubleSide;
    const beamGeometry = scene._geometry(new T.CylinderGeometry(.36, 2.3, 1, 24, 1, true));
    const beam = scene._mesh(beamGeometry, beamMaterial, scene.scene, 0, 0, 0, 1, 1, 1, false); beam.name = 'Abduction beam'; beam.visible = false;
    const ringGeometry = scene._geometry(new T.TorusGeometry(1, .025, 4, 28));
    const ringMaterial = scene._material('#d1f7bd', { unlit: true, opacity: .6, depthWrite: false });
    const rings = Array.from({ length: 4 }, (_, i) => {
      const ring = scene._mesh(ringGeometry, ringMaterial, scene.scene, 0, 0, 0, 1, 1, 1, false);
      ring.rotation.x = Math.PI / 2; ring.name = i ? 'Beam lift ring' : 'Beam ground halo'; ring.visible = false; return ring;
    });
    return { group, pilot, window, floor, beam, rings };
  }

  function update(scene) {
    const system = scene.game.aliens;
    if (!system) return;
    for (const ped of scene.game.peds) {
      if (!ped.alien) continue;
      const old = scene._residents.get(ped.id);
      if (!old || old.alien) continue;
      const model = character(scene, true); model.bubble = old.bubble;
      model.group.add(model.bubble.sprite); scene.scene.remove(old.group); scene.scene.add(model.group);
      model.group.position.copy(old.group.position); model.group.rotation.copy(old.group.rotation);
      model.group.visible = old.group.visible; scene._residents.set(ped.id, model);
    }
    const state = system.saucer;
    // Allocate one model and beam, then reuse them for every visit.
    const model = scene._alienSaucer || (scene._alienSaucer = saucer(scene));
    model.group.visible = state.visible;
    model.group.position.set(state.x / UNIT, state.elevation, state.y / UNIT);
    model.group.rotation.y = -state.angle;
    model.group.rotation.z = scene.reducedMotion ? 0 : Math.sin(system.time * 1.4) * .013;
    const capture = system.capture;
    const beamVisible = state.visible && state.beam > .001;
    const bottom = capture ? capture.origin.elevation + .035 : 0, top = state.elevation - .72;
    model.beam.visible = beamVisible;
    model.beam.material.opacity = state.beam * .17;
    model.beam.position.set(state.x / UNIT, (top + bottom) / 2, state.y / UNIT);
    model.beam.scale.y = Math.max(.01, top - bottom);
    for (let i = 0; i < model.rings.length; i++) {
      const ring = model.rings[i]; ring.visible = beamVisible;
      const progress = i === 0 ? 0 : scene.reducedMotion ? i / 4 : (system.time * .23 + i / 3) % 1;
      const radius = 2.2 * (1 - progress) + .28 * progress;
      ring.position.set(state.x / UNIT, bottom + (top - bottom) * progress, state.y / UNIT);
      ring.scale.set(radius, radius, radius);
    }
    if (capture) {
      const resident = scene._residents.get(capture.ped.id);
      if (resident) {
        resident.group.visible = capture.visible;
        resident.group.position.set(capture.origin.x / UNIT, capture.elevation + .03, capture.origin.y / UNIT);
        resident.group.rotation.set(0, -capture.origin.angle, 0);
        resident.leftLeg.rotation.z = resident.rightLeg.rotation.z = 0;
        resident.leftArm.rotation.z = resident.rightArm.rotation.z = 2.4;
        scene._bubbleText(resident.bubble, capture.visible && capture.progress < .6 ? capture.ped.bubble : '');
      }
    }
    const count = scene.game.peds.filter(ped => ped.alien).length;
    if (scene.canvas?.dataset) {
      scene.canvas.dataset.alienCount = String(count);
      scene.canvas.dataset.saucerPhase = state.phase;
      scene.canvas.dataset.abductionBeam = String(beamVisible);
    }
    if (scene._worldInfo) scene._worldInfo.aliens = { visitors: count, saucerPhase: state.phase, beam: beamVisible, pilot: true };
  }

  root.MayhemAlienRender = { character, saucer, update };
  if (root.MayhemScene) {
    const BaseScene = root.MayhemScene;
    root.MayhemScene = class AlienScene extends BaseScene {
      _effects() { super._effects(); update(this); }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MayhemAlienRender;
})(globalThis);
