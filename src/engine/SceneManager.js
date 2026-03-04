import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Create a complete Three.js scene with camera, renderer, lights, and orbit controls.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @returns {{ scene, camera, renderer, controls, animate, dispose }}
 */
export function createScene(container) {
  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f4f8);

  // Camera
  const aspect = container.clientWidth / container.clientHeight;
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 10000);
  camera.position.set(-150, 100, 150);  // -X+Z side: where Side A (first name) is readable
  camera.lookAt(0, 0, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.5;
  controls.minDistance = 10;
  controls.maxDistance = 2000;

  // Lighting — three-point setup
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
  keyLight.position.set(100, 200, 100);
  keyLight.castShadow = true;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-100, 50, -100);
  scene.add(fillLight);

  const backLight = new THREE.DirectionalLight(0xffffff, 0.2);
  backLight.position.set(0, -100, -200);
  scene.add(backLight);


  // Animation loop
  let animationId;
  function animate() {
    animationId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  // Responsive resize
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  // Cleanup
  function dispose() {
    cancelAnimationFrame(animationId);
    window.removeEventListener('resize', onResize);
    controls.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      container.removeChild(renderer.domElement);
    }
  }

  return { scene, camera, renderer, controls, animate, dispose };
}

/**
 * Adjust camera to frame a given object nicely.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Object3D} object
 * @param {OrbitControls} controls
 * @param {number} [offset=1.5] - Distance multiplier
 */
export function fitCameraToObject(camera, object, controls, offset = 1.5) {
  const bbox = new THREE.Box3().setFromObject(object);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  // For tall models (multi-letter stacks): use XZ footprint + half-height
  // so the camera doesn't go too far back and letters appear too small.
  const baseDim = Math.max(size.x, size.z, size.y * 0.5);
  const fov = camera.fov * (Math.PI / 180);
  const distance = (baseDim / 2) / Math.tan(fov / 2) * offset;

  camera.position.set(
    center.x - distance * 0.7,  // -X side: where Side A (first name) is readable
    center.y + distance * 0.5,
    center.z + distance * 0.7
  );
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}
