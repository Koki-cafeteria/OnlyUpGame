import * as THREE from 'three';

export class TPSCamera {
  public camera: THREE.PerspectiveCamera;
  // アバター大幅縮小（0.6m）に合わせた後方・斜め上（distance: 2.5m, height: 1.0m）からのオフセット
  private offset = new THREE.Vector3(0, 1.0, 2.5);
  // カメラ注視点: プレイヤーの胸〜頭付近（height: 0.4m）
  private lookAtOffset = new THREE.Vector3(0, 0.4, 0);

  constructor() {
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  }

  public update(targetPosition: THREE.Vector3) {
    const desiredPos = targetPosition.clone().add(this.offset);
    // Simple Lerp for smooth camera follow
    this.camera.position.lerp(desiredPos, 0.1);
    
    const lookAtPos = targetPosition.clone().add(this.lookAtOffset);
    this.camera.lookAt(lookAtPos);
  }

  public resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
