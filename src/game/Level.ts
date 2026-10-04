import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Physics } from '../physics/Physics';
import { Player } from './Player';

export class Level {
  private bubbles: { mesh: THREE.Mesh; initialY: number; timeOffset: number }[] = [];
  private movingLifts: { body: CANNON.Body; mesh: THREE.Mesh; minBound: number; maxBound: number; baseSpeed: number; currentDir: number; axis: 'x' | 'z'; origin: THREE.Vector3 }[] = [];
  private goal: { mesh: THREE.Mesh; body: CANNON.Body } | null = null;
  
  private concreteMat!: THREE.MeshStandardMaterial;
  private pipeMat!: THREE.MeshStandardMaterial;
  private gridMat!: THREE.MeshStandardMaterial;
  private warningMat!: THREE.MeshStandardMaterial;
  private trapMat!: THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene, private physics: Physics, private player: Player, private onDeath: () => void, private onGoal: () => void) {
    this.initMaterials();
    this.createGeometry();
  }

  private initMaterials() {
    // 外部PBRテクスチャを一括ロードする共通マテリアルローダー
    const tl = new THREE.TextureLoader();
    
    const loadPBRMaterial = (
      name: string, 
      baseUrl: string, 
      colorHex: number, 
      defaultRoughness: number, 
      defaultMetalness: number,
      envMapIntensity: number = 1.0
    ) => {
      const mat = new THREE.MeshStandardMaterial({ 
        color: colorHex, 
        roughness: defaultRoughness, 
        metalness: defaultMetalness, 
        envMapIntensity: envMapIntensity 
      });
      
      const setTex = (tex: THREE.Texture, type: 'map'|'normalMap'|'roughnessMap') => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4);
        mat[type] = tex;
        mat.needsUpdate = true;
      };

      tl.load(`${baseUrl}/${name}_Color.jpg`, (t) => setTex(t, 'map'), undefined, () => {});
      tl.load(`${baseUrl}/${name}_NormalGL.jpg`, (t) => setTex(t, 'normalMap'), undefined, () => {});
      tl.load(`${baseUrl}/${name}_Roughness.jpg`, (t) => setTex(t, 'roughnessMap'), undefined, () => {});
      
      return mat;
    };

    // 白い足場ブロック
    this.concreteMat = loadPBRMaterial('Concrete', '/textures', 0xdde2e8, 0.35, 0.15, 1.2);
    // オレンジパイプ / 構造物
    this.pipeMat = loadPBRMaterial('Metal', '/textures', 0xff6600, 0.2, 0.7, 1.0);

    // Fallbacks for specific custom meshes
    const cv1 = document.createElement('canvas');
    cv1.width = 256; cv1.height = 256;
    const ctx1 = cv1.getContext('2d')!;
    ctx1.fillStyle = '#e6b800'; ctx1.fillRect(0, 0, 256, 256);
    ctx1.fillStyle = '#111111';
    for (let i = -256; i < 512; i += 64) {
      ctx1.beginPath(); ctx1.moveTo(i, 0); ctx1.lineTo(i + 32, 0); ctx1.lineTo(i + 288, 256); ctx1.lineTo(i + 256, 256); ctx1.fill();
    }
    const warningTex = new THREE.CanvasTexture(cv1);
    warningTex.wrapS = THREE.RepeatWrapping; warningTex.wrapT = THREE.RepeatWrapping;

    const cv2 = document.createElement('canvas');
    cv2.width = 128; cv2.height = 128;
    const ctx2 = cv2.getContext('2d')!;
    ctx2.fillStyle = '#000000'; ctx2.fillRect(0, 0, 128, 128);
    ctx2.strokeStyle = '#ffffff'; ctx2.lineWidth = 16; ctx2.strokeRect(0, 0, 128, 128);
    const gridTex = new THREE.CanvasTexture(cv2);
    gridTex.wrapS = THREE.RepeatWrapping; gridTex.wrapT = THREE.RepeatWrapping;

    this.gridMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 1.0, roughness: 0.1, alphaMap: gridTex, transparent: true, side: THREE.DoubleSide, envMapIntensity: 1.0 });
    tl.load('/textures/Grate_Alpha.jpg', (t) => { t.wrapS=t.wrapT=THREE.RepeatWrapping; this.gridMat.alphaMap = t; this.gridMat.needsUpdate = true; }, undefined, () => {});

    this.warningMat = new THREE.MeshStandardMaterial({ map: warningTex, roughness: 0.5, metalness: 0.2, envMapIntensity: 1.0 });
    tl.load('/textures/Warning_Color.jpg', (t) => { t.wrapS=t.wrapT=THREE.RepeatWrapping; this.warningMat.map = t; this.warningMat.needsUpdate = true; }, undefined, () => {});

    this.trapMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff3300, emissiveIntensity: 2.0, roughness: 0.2 });
  }

  public reset() {
    for (const lift of this.movingLifts) {
      lift.body.position.copy(lift.origin);
      lift.body.velocity.set(0, 0, 0);
      lift.currentDir = 1; 
      lift.mesh.position.copy(lift.origin as any);
    }
  }

  private createBox(size: [number, number, number], pos: [number, number, number], color: number, material: CANNON.Material, isTrap = false, isGoal = false, type: 'box'|'pipe'|'grid'|'warning' = 'box') {
    let geo: THREE.BufferGeometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
    let mat = this.concreteMat.clone();
    
    let finalMat: THREE.Material | THREE.Material[] = mat;

    if (type === 'pipe') {
      geo = new THREE.CylinderGeometry(size[0]/2, size[0]/2, size[2], 16);
      geo.rotateX(Math.PI / 2);
      mat = this.pipeMat.clone();
      finalMat = mat;
    } else if (type === 'warning') {
      mat = this.warningMat.clone();
      if (mat.map) {
        mat.map = mat.map.clone();
        mat.map.repeat.set(size[0] / 2, 1);
      }
      finalMat = mat;
    } else if (type === 'grid') {
      mat = this.gridMat.clone();
      if (mat.alphaMap) {
        mat.alphaMap = mat.alphaMap.clone();
        mat.alphaMap.repeat.set(size[0], size[2]);
      }
      finalMat = mat;
    }

    // 巨大な足場ブロックのディテールアップ（工業的演出）
    if ((type === 'box' || type === 'grid') && size[0] >= 10 && !isTrap && !isGoal) {
      const sideMat = this.warningMat.clone();
      if (sideMat.map) {
        sideMat.map = sideMat.map.clone();
        sideMat.map.repeat.set(size[0] / 4, size[1]);
      }
      const sideMatZ = this.warningMat.clone();
      if (sideMatZ.map) {
        sideMatZ.map = sideMatZ.map.clone();
        sideMatZ.map.repeat.set(size[2] / 4, size[1]);
      }
      // BoxGeometry faces: [right(x+), left(x-), top(y+), bottom(y-), front(z+), back(z-)]
      finalMat = [sideMatZ, sideMatZ, mat, mat, sideMat, sideMat];
    }

    if (isTrap) mat = this.trapMat.clone();

    const mesh = new THREE.Mesh(geo, finalMat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    // 全ての作成した Mesh に対して、必ず castShadow = true と receiveShadow = true を設定
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    
    // トラス骨組み・手すりフレームの追加
    if ((type === 'box' || type === 'grid') && size[0] >= 10 && !isTrap && !isGoal) {
      const trussMat = this.pipeMat;
      const tHeight = 4;
      // 下部に伸びる支柱
      const positions = [
        [-size[0]/2 + 0.5, -size[2]/2 + 0.5],
        [size[0]/2 - 0.5, -size[2]/2 + 0.5],
        [-size[0]/2 + 0.5, size[2]/2 - 0.5],
        [size[0]/2 - 0.5, size[2]/2 - 0.5],
      ];
      positions.forEach(([px, pz]) => {
        const pillarGeo = new THREE.CylinderGeometry(0.2, 0.2, tHeight, 8);
        const pillar = new THREE.Mesh(pillarGeo, trussMat);
        pillar.position.set(px, -size[1]/2 - tHeight/2, pz);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        mesh.add(pillar);
      });
      // 斜めの筋交い（クロス）
      const crossGeo = new THREE.CylinderGeometry(0.15, 0.15, Math.sqrt(size[0]*size[0] + tHeight*tHeight), 8);
      const cross1 = new THREE.Mesh(crossGeo, trussMat);
      cross1.position.set(0, -size[1]/2 - tHeight/2, -size[2]/2 + 0.5);
      cross1.rotation.z = Math.atan2(tHeight, size[0]);
      cross1.castShadow = true;
      mesh.add(cross1);
      
      const cross2 = new THREE.Mesh(crossGeo, trussMat);
      cross2.position.set(0, -size[1]/2 - tHeight/2, -size[2]/2 + 0.5);
      cross2.rotation.z = -Math.atan2(tHeight, size[0]);
      cross2.castShadow = true;
      mesh.add(cross2);
    }

    this.scene.add(mesh);

    let shape: CANNON.Shape;
    const body = new CANNON.Body({ mass: 0, material });
    
    if (type === 'pipe') {
      shape = new CANNON.Cylinder(size[0]/2, size[0]/2, size[2], 16);
      const quat = new CANNON.Quaternion();
      quat.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2); 
      body.addShape(shape, new CANNON.Vec3(0, 0, 0), quat);
    } else {
      shape = new CANNON.Box(new CANNON.Vec3(size[0]/2, size[1]/2, size[2]/2));
      body.addShape(shape);
    }
    
    body.position.set(pos[0], pos[1], pos[2]);
    
    if (isTrap) {
      body.addEventListener('collide', (e: any) => {
        if (e.body.mass > 0) this.onDeath();
      });
      mat.color.setHex(0x110000);
      mat.emissive = new THREE.Color(0xff2200);
      mat.emissiveIntensity = 2.5;

      // 火花/煙パーティクルの追加
      const pCount = 50 * size[0]; // 足場のサイズに応じたパーティクル数
      const pGeo = new THREE.BufferGeometry();
      const pPos = new Float32Array(pCount * 3);
      const pVel: {x: number, y: number, z: number}[] = [];
      for (let i = 0; i < pCount; i++) {
        pPos[i*3] = (Math.random() - 0.5) * size[0];
        pPos[i*3+1] = size[1]/2 + Math.random() * 0.5;
        pPos[i*3+2] = (Math.random() - 0.5) * size[2];
        pVel.push({
          y: Math.random() * 2 + 1,
          x: (Math.random() - 0.5) * 0.5,
          z: (Math.random() - 0.5) * 0.5
        });
      }
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
      const pMat = new THREE.PointsMaterial({ color: 0xffaa00, size: 0.1, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
      const particles = new THREE.Points(pGeo, pMat);
      mesh.add(particles);

      // パーティクルのアニメーション（簡易）
      const animateParticles = () => {
        if (!particles.parent) return;
        const positions = particles.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < pCount; i++) {
          positions[i*3+1] += pVel[i].y * 0.016;
          positions[i*3] += pVel[i].x * 0.016;
          positions[i*3+2] += pVel[i].z * 0.016;
          if (positions[i*3+1] > size[1]/2 + 3) { // 高さ3まで上昇したらリセット
            positions[i*3+1] = size[1]/2;
            positions[i*3] = (Math.random() - 0.5) * size[0];
            positions[i*3+2] = (Math.random() - 0.5) * size[2];
          }
        }
        particles.geometry.attributes.position.needsUpdate = true;
        requestAnimationFrame(animateParticles);
      };
      animateParticles();
      
    } else if (body.type === CANNON.Body.STATIC && (type === 'box' || type === 'grid')) {
      (body as any).isSafeCheckpoint = true;
      (body as any).checkpointPos = new CANNON.Vec3(pos[0], pos[1] + size[1]/2 + 2, pos[2]);
    }

    if (isGoal) {
      body.addEventListener('collide', (e: any) => {
        if (e.body.mass > 0) this.onGoal();
      });
      // ゴールブロック（金/黄色）のPBRパラメータ
      mat.color.setHex(0xffd700);
      mat.emissive = new THREE.Color(0xffd700);
      mat.emissiveIntensity = 0.4;
      mat.metalness = 0.85;
      mat.roughness = 0.2;
    }

    this.physics.world.addBody(body);
    return { mesh, body };
  }

  private createMovingBox(size: [number, number, number], pos: [number, number, number], range: number, speed: number, axis: 'x'|'z') {
    const color = 0x88929e; 
    const { mesh, body } = this.createBox(size, pos, color, this.physics.liftMaterial, false, false, 'warning');
    body.type = CANNON.Body.KINEMATIC; 
    
    const minBound = axis === 'x' ? pos[0] - range : pos[2] - range;
    const maxBound = axis === 'x' ? pos[0] + range : pos[2] + range;

    this.movingLifts.push({
      body, mesh,
      minBound, maxBound,
      baseSpeed: speed * 4, 
      currentDir: 1, 
      axis,
      origin: new THREE.Vector3(pos[0], pos[1], pos[2])
    });
    return { mesh, body };
  }

  private createRechargeBubble(pos: [number, number, number]) {
    const geo = new THREE.SphereGeometry(0.8, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ 
      color: 0x00aaff, 
      transparent: true,
      opacity: 0.6,
      metalness: 0.8,
      roughness: 0.1,
      emissive: 0x00aaff,
      emissiveIntensity: 0.8
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(mesh);
    this.bubbles.push({ mesh, initialY: pos[1], timeOffset: Math.random() * Math.PI * 2 });
  }

  private createGeometry() {
    const normalColor = 0xe0e4e8; // 明るい白・グレー（コンクリート・白塗りの鉄板）
    const trapColor = 0xff3300; // ヒーター
    const bounceColor = 0x1188ff; // バンパー
    const pipeColor = 0xf39c12; // 鮮やかなオレンジ・黄色のパイプ
    const goalColor = 0xffd700; 

    // --- セクション1 (0m - 15m) : 基本のステップ ---
    this.createBox([15, 1, 15], [0, -0.5, 0], normalColor, this.physics.defaultMaterial, false, false, 'grid');
    
    this.createBox([4, 1, 4], [0, 2, -10], normalColor, this.physics.defaultMaterial);
    this.createBox([4, 1, 4], [5, 4, -15], normalColor, this.physics.defaultMaterial, false, false, 'grid');
    this.createBox([4, 1, 4], [0, 6, -20], normalColor, this.physics.defaultMaterial);
    this.createBox([2, 1, 8], [-5, 8, -20], pipeColor, this.physics.defaultMaterial, false, false, 'pipe');

    this.createBox([5, 1, 5], [-5, 10, -35], normalColor, this.physics.defaultMaterial);
    this.createBox([5, 1, 5], [5, 12, -45], normalColor, this.physics.defaultMaterial, false, false, 'grid');
    this.createBox([6, 1, 6], [15, 14, -45], normalColor, this.physics.defaultMaterial);

    // --- セクション2 (15m - 30m) : リフトと即死トラップ ---
    this.createMovingBox([4, 1, 4], [15, 16, -55], 10, 1.5, 'z'); 
    
    this.createBox([10, 1, 10], [15, 18, -75], normalColor, this.physics.defaultMaterial, false, false, 'grid');

    // 即死ブロック (ヒーター)
    this.createBox([20, 2, 2], [15, 19, -85], trapColor, this.physics.defaultMaterial, true);
    
    this.createMovingBox([3, 1, 3], [5, 20, -75], 10, 2, 'x'); 
    this.createBox([4, 1, 4], [-10, 22, -85], normalColor, this.physics.defaultMaterial);

    this.createMovingBox([2, 1, 2], [-10, 25, -95], 8, 3, 'x');
    this.createBox([3, 1, 12], [0, 28, -100], pipeColor, this.physics.defaultMaterial, false, false, 'pipe');

    // --- セクション3 (30m - 50m) : トランポリン ---
    const jumpPad1 = this.createBox([4, 0.5, 4], [0, 28.5, -110], bounceColor, this.physics.bounceMaterial);
    jumpPad1.body.addEventListener('collide', (e: any) => { if (e.body.mass > 0) e.body.velocity.y = 35; });

    this.createRechargeBubble([0, 40, -125]);
    this.createRechargeBubble([0, 42, -145]);

    this.createBox([6, 1, 6], [0, 45, -165], normalColor, this.physics.defaultMaterial, false, false, 'grid');
    
    const jumpPad2 = this.createBox([3, 0.5, 3], [-8, 45.5, -165], bounceColor, this.physics.bounceMaterial);
    jumpPad2.body.addEventListener('collide', (e: any) => { if (e.body.mass > 0) e.body.velocity.y = 30; });
    const jumpPad3 = this.createBox([3, 0.5, 3], [-8, 50.5, -150], bounceColor, this.physics.bounceMaterial);
    jumpPad3.body.addEventListener('collide', (e: any) => { if (e.body.mass > 0) e.body.velocity.y = 30; });

    // --- セクション4 (50m - Top) ---
    this.createBox([2, 1, 2], [-8, 55, -135], normalColor, this.physics.defaultMaterial);
    this.createBox([1.5, 1, 1.5], [0, 57, -135], normalColor, this.physics.defaultMaterial);
    this.createBox([1, 1, 1], [8, 59, -135], normalColor, this.physics.defaultMaterial, false, false, 'warning');
    
    this.createBox([2, 1, 10], [8, 61, -125], pipeColor, this.physics.defaultMaterial, false, false, 'pipe');

    this.createBox([10, 1, 10], [8, 63, -115], normalColor, this.physics.defaultMaterial, false, false, 'grid');
    
    const goalObj = this.createBox([4, 4, 4], [8, 65.5, -115], goalColor, this.physics.defaultMaterial, false, true);
    this.goal = goalObj;
  }

  public update(time: number) {
    const elapsed = time / 1000;
    
    // 1. バブルアニメーション & 判定
    for (const bubble of this.bubbles) {
      if (!bubble.mesh.visible) continue;
      bubble.mesh.position.y = bubble.initialY + Math.sin(elapsed * 2 + bubble.timeOffset) * 0.5;
      
      const pPos = this.player.mesh.position;
      const bPos = bubble.mesh.position;
      if (pPos.distanceToSquared(bPos) < 4) {
        this.player.canAirDash = true;
        bubble.mesh.visible = false;
        setTimeout(() => { bubble.mesh.visible = true; }, 3000);
      }
    }

    // 2. 動くリフトの制御 (厳密な境界チェックとClamp、純粋な速度制御)
    for (const lift of this.movingLifts) {
      if (lift.axis === 'x') {
        let px = lift.body.position.x;
        if (px > lift.maxBound) {
          px = lift.maxBound; // 貫通・発散防止の強制Clamp
          lift.currentDir = -1;
        } else if (px < lift.minBound) {
          px = lift.minBound;
          lift.currentDir = 1;
        }
        lift.body.position.x = px;
        lift.body.velocity.set(lift.baseSpeed * lift.currentDir, 0, 0);
      } else {
        let pz = lift.body.position.z;
        if (pz > lift.maxBound) {
          pz = lift.maxBound; // 強制Clamp
          lift.currentDir = -1;
        } else if (pz < lift.minBound) {
          pz = lift.minBound;
          lift.currentDir = 1;
        }
        lift.body.position.z = pz;
        lift.body.velocity.set(0, 0, lift.baseSpeed * lift.currentDir);
      }
      
      // メッシュの同期 (ボディの位置に合わせる)
      lift.mesh.position.copy(lift.body.position as any);
      lift.mesh.quaternion.copy(lift.body.quaternion as any);
    }
    
    // 3. ゴールの回転アニメーション
    if (this.goal) {
      this.goal.mesh.rotation.y = elapsed * 1.5;
      this.goal.mesh.rotation.x = Math.sin(elapsed) * 0.2;
    }
  }
}
