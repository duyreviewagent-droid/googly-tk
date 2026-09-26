// Googly TK — app icon scene (?icon=1): a yellow googly sitting in the cannon's mouth, fuse lit, ready to be fired.
export function iconScene({ THREE, scene, camera, cannon, fuse, fuseLight, Googly, loadLevel, show, setState }) {
  loadLevel(1);
  setState('icon');
  ['title', 'hud', 'intro'].forEach(id => show(id, false));
  const yaw = 0.0, pitch = 0.6;
  cannon.aim(yaw, pitch);
  fuse.visible = true; fuse.scale.setScalar(0.5); fuseLight.intensity = 4;
  const g = new Googly('yellow');
  scene.add(g.group);
  const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const m = new THREE.Vector3(0, 1.05, 0).addScaledVector(d, 1.7);
  const camPos = new THREE.Vector3(3.9, 1.75, 1.6);
  // lower half inside the barrel, leaning out along it, turned to look at us
  g.group.position.copy(m).addScaledVector(d, 0.12);
  const up = new THREE.Vector3(0, 1, 0).lerp(d, 0.55).normalize();
  const base = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  let best = 0, bd = -2;
  for (let a = 0; a < 6.28; a += 0.02) { const q = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a)); const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const dd = f.dot(camPos.clone().sub(g.group.position).normalize()); if (dd > bd) { bd = dd; best = a; } }
  g.group.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), best + 0.25));
  g.face(true); g.pose(true);
  g.eyes.forEach((e, i) => { e.pupil.position.set(i ? -0.03 : -0.02, 0.03, 0.022); });
  camera.fov = 36;
  const look = m.clone().add(new THREE.Vector3(0.1, -0.55, 0.9));
  window.__iconCam = () => { camera.position.copy(camPos); camera.lookAt(look); };
}
