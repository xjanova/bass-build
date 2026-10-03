import * as THREE from 'three/webgpu';

/**
 * Anechoic chamber: pyramid foam wedges on walls, ceiling and under a cable-net floor.
 * Instanced so ~2,000 wedges cost one draw call.
 */
export function buildRoom(): THREE.Group {
  const room = new THREE.Group();
  room.name = 'room';
  const wedge = new THREE.ConeGeometry(0.115, 0.42, 4);
  wedge.rotateY(Math.PI / 4);
  const foam = new THREE.MeshStandardMaterial({ color: 0x1a2130, roughness: 1, metalness: 0 });
  const mats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const add = (pos: THREE.Vector3, inward: THREE.Vector3) => {
    q.setFromUnitVectors(up, inward);
    mats.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)));
  };
  const step = 0.3;
  const X = 3.3, Zb = -3.3, Zf = 4.2, Y = 3.8, FLOOR = -0.7;
  for (let x = -X; x <= X + 1e-6; x += step) for (let y = FLOOR; y <= Y; y += step) add(new THREE.Vector3(x, y, Zb), new THREE.Vector3(0, 0, 1));
  for (let z = Zb; z <= Zf; z += step) for (let y = FLOOR; y <= Y; y += step) {
    add(new THREE.Vector3(-X - 0.1, y, z), new THREE.Vector3(1, 0, 0));
    add(new THREE.Vector3(X + 0.1, y, z), new THREE.Vector3(-1, 0, 0));
  }
  for (let x = -X; x <= X + 1e-6; x += step) for (let z = Zb; z <= Zf; z += step) {
    add(new THREE.Vector3(x, Y + 0.1, z), new THREE.Vector3(0, -1, 0));
    add(new THREE.Vector3(x, FLOOR, z), new THREE.Vector3(0, 1, 0));
  }
  const inst = new THREE.InstancedMesh(wedge, foam, mats.length);
  mats.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.instanceMatrix.needsUpdate = true;
  room.add(inst);

  // Cable-net floor the box stands on.
  const net = new THREE.GridHelper(7, 56, 0x3a4a63, 0x223047);
  (net.material as THREE.Material).transparent = true;
  (net.material as THREE.Material).opacity = 0.55;
  room.add(net);

  // Turntable ring under the box.
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.012, 128), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  room.add(ring);
  return room;
}
