import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { InputManager } from '../ui/TouchUI';
import { Physics } from '../physics/Physics';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Player {
  public mesh: THREE.Group;
  public body: CANNON.Body;
  
  private baseSpeed = 8;
  private groundDashSpeed = 13;
  private jumpForce = 16;
  private airDashForce = 25;
  
  public canAirDash = true;
  private dashTimer = 0;
  private airDashVector = new THREE.Vector3();

  private spawnPoint = new CANNON.Vec3(0, 5, 0);
  private audioCtx: AudioContext | null = null;
  private wallNormal = new CANNON.Vec3();
  private isTouchingWall = false;

  private dashParticles: THREE.Mesh[] = [];
  
  private dropShadow: THREE.Mesh;
  private inheritedVelocity = new THREE.Vector3();
  
  private humanoid: {
    armL: THREE.Group;
    armR: THREE.Group;
    legL: THREE.Group;
    legR: THREE.Group;
  } | null = null;
  
  private animTimer = 0;
  private loadedModel: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private heldBottle: THREE.Mesh;
  private canThrow = true;
  private boneRestRotations = new Map<THREE.Object3D, THREE.Euler>();

  constructor(private scene: THREE.Scene, private physics: Physics, private ui: InputManager) {
    this.mesh = new THREE.Group();
    scene.add(this.mesh);

    // 手持ちボトルの可視化
    const bGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8);
    const bMat = new THREE.MeshPhysicalMaterial({ 
      color: 0x00ffff, 
      transmission: 0.8, 
      opacity: 1, 
      transparent: true, 
      roughness: 0.1, 
      metalness: 0.1, 
      ior: 1.5 
    });
    this.heldBottle = new THREE.Mesh(bGeo, bMat);
    // 右手付近に配置
    this.heldBottle.position.set(0.4, 0.4, 0.2);
    this.heldBottle.rotation.x = Math.PI / 2;
    this.mesh.add(this.heldBottle);

    // GLTFモデルのロードパイプライン
    const loader = new GLTFLoader();
    loader.setPath('/models/');
    loader.load('player.glb', (gltf) => {
      this.loadedModel = gltf.scene;
      
      this.loadedModel.traverse((child: any) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      // モデルの実際の大きさを計算し、自動で高さ0.6m（マリオ風のミニチュアサイズ）にスケール補正する
      const box = new THREE.Box3().setFromObject(this.loadedModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      
      const targetHeight = 0.6;
      const scaleFactor = targetHeight / size.y;
      this.loadedModel.scale.setScalar(scaleFactor);
      
      // スケール後のサイズで再度バウンディングボックスを計算し、足元の位置を正確に合わせる
      const scaledBox = new THREE.Box3().setFromObject(this.loadedModel);
      const minY = scaledBox.min.y;
      // カプセル剛体の中央(Y=0)から足元(Y=-0.3)へ、モデルの最も低い部分をピッタリ合わせる
      this.loadedModel.position.y = -0.3 - minY;
      
      // ダウンロードしたモデルに歩行などのアニメーションが1つだけ含まれている場合、
      // 停止中や空中でも勝手に歩き続けてしまって不自然になるため、内蔵アニメーションは破棄します。
      // 代わりに、物理エンジンと連動して「走る」「跳ぶ」「待機」を自動で行うプロシージャルアニメーションを強制適用します。
      this.humanoid = { armL: null as any, armR: null as any, legL: null as any, legR: null as any };
      this.loadedModel.traverse((child: any) => {
        if (child.isBone) {
          const name = child.name.toLowerCase();
          if ((name.includes('left') || name.includes('l_')) && (name.includes('arm') || name.includes('shoulder')) && !this.humanoid!.armL) this.humanoid!.armL = child;
          if ((name.includes('right') || name.includes('r_')) && (name.includes('arm') || name.includes('shoulder')) && !this.humanoid!.armR) this.humanoid!.armR = child;
          if ((name.includes('left') || name.includes('l_')) && (name.includes('leg') || name.includes('upleg')) && !this.humanoid!.legL) this.humanoid!.legL = child;
          if ((name.includes('right') || name.includes('r_')) && (name.includes('leg') || name.includes('upleg')) && !this.humanoid!.legR) this.humanoid!.legR = child;
        }
      });
      
      // ボーンの初期角度（Aポーズ/Tポーズ）を保存
      [this.humanoid.armL, this.humanoid.armR, this.humanoid.legL, this.humanoid.legR].forEach(bone => {
        if (bone) this.boneRestRotations.set(bone, bone.rotation.clone());
      });

      this.mesh.clear();
      this.mesh.add(this.loadedModel);
      this.mesh.add(this.heldBottle); // 手持ちボトルを再アタッチ
      // もしボーンが見つからなかったらアニメーションは諦める
      if (this.humanoid && (!this.humanoid.armL && !this.humanoid.legL)) {
        this.humanoid = null;
      }
    }, undefined, (error) => {
      console.warn("GLTF (public/models/player.glb) not found. Using fallback procedural avatar.");
      this.createFallbackAvatar();
    });

    // ガイドシャドウ (Drop Shadow)
    const shadowGeo = new THREE.CircleGeometry(0.15, 16);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
    this.dropShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.dropShadow.rotation.x = -Math.PI / 2;
    scene.add(this.dropShadow);

    // プレイヤー剛体のセットアップ (身長を0.6mへ大幅縮小)
    this.body = new CANNON.Body({
      mass: 1,
      material: physics.playerMaterial,
      position: this.spawnPoint.clone(),
      fixedRotation: true,
      collisionFilterGroup: 2, 
      collisionFilterMask: 1   
    });
    
    // Cannon-esのカプセルバグ回避のための多重球体カプセル
    // 身長を0.6mに縮小するため、半径0.15m、中心Yを -0.15〜0.15 とする (合計0.6m)
    const radius = 0.15;
    const sphereShape = new CANNON.Sphere(radius);
    const numSpheres = 9;
    const minY = -0.15;
    const maxY = 0.15;
    for (let i = 0; i < numSpheres; i++) {
      const y = minY + (maxY - minY) * (i / (numSpheres - 1));
      this.body.addShape(sphereShape, new CANNON.Vec3(0, y, 0));
    }
    
    this.body.linearDamping = 0.0;
    physics.world.addBody(this.body);
    this.setupPhysicsListeners();
  }

  private createFallbackAvatar() {
    this.humanoid = {
      armL: new THREE.Group(),
      armR: new THREE.Group(),
      legL: new THREE.Group(),
      legR: new THREE.Group(),
    };

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffa07a, roughness: 0.6, metalness: 0.1 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.9, metalness: 0.0 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });

    const torsoGeo = new THREE.CapsuleGeometry(0.25, 0.3, 4, 16);
    const torso = new THREE.Mesh(torsoGeo, shirtMat);
    torso.position.y = 0.35 - 0.25; 
    torso.castShadow = true;
    this.mesh.add(torso);

    const headGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 0.8 - 0.25;
    head.castShadow = true;
    this.mesh.add(head);

    const armGeo = new THREE.CapsuleGeometry(0.08, 0.45, 4, 16);
    
    const armLMesh = new THREE.Mesh(armGeo, skinMat);
    armLMesh.position.y = -0.25; 
    armLMesh.castShadow = true;
    this.humanoid.armL.add(armLMesh);
    this.humanoid.armL.position.set(-0.35, 0.6 - 0.25, 0);
    this.mesh.add(this.humanoid.armL);

    const armRMesh = new THREE.Mesh(armGeo, skinMat);
    armRMesh.position.y = -0.25;
    armRMesh.castShadow = true;
    this.humanoid.armR.add(armRMesh);
    this.humanoid.armR.position.set(0.35, 0.6 - 0.25, 0);
    this.mesh.add(this.humanoid.armR);

    const legGeo = new THREE.CapsuleGeometry(0.12, 0.5, 4, 16);
    const shoeGeo = new THREE.CapsuleGeometry(0.1, 0.15, 4, 16);
    shoeGeo.rotateX(Math.PI / 2);

    const legLMesh = new THREE.Mesh(legGeo, pantsMat);
    legLMesh.position.y = -0.35;
    legLMesh.castShadow = true;
    const shoeLMesh = new THREE.Mesh(shoeGeo, shoeMat);
    shoeLMesh.position.set(0, -0.75, 0.05);
    shoeLMesh.castShadow = true;
    
    this.humanoid.legL.add(legLMesh, shoeLMesh);
    this.humanoid.legL.position.set(-0.15, 0.1 - 0.25, 0);
    this.mesh.add(this.humanoid.legL);

    const legRMesh = new THREE.Mesh(legGeo, pantsMat);
    legRMesh.position.y = -0.35;
    legRMesh.castShadow = true;
    const shoeRMesh = new THREE.Mesh(shoeGeo, shoeMat);
    shoeRMesh.position.set(0, -0.75, 0.05);
    shoeRMesh.castShadow = true;

    this.humanoid.legR.add(legRMesh, shoeRMesh);
    this.humanoid.legR.position.set(0.15, 0.1 - 0.25, 0);
    this.mesh.add(this.humanoid.legR);

    // ボーンの初期角度を保存
    [this.humanoid.armL, this.humanoid.armR, this.humanoid.legL, this.humanoid.legR].forEach(bone => {
      if (bone) this.boneRestRotations.set(bone, bone.rotation.clone());
    });
  }

  private setupPhysicsListeners() {
    this.body.addEventListener('collide', (e: any) => {
      const contact = e.contact;
      if (Math.abs(contact.ni.y) < 0.3) {
        this.isTouchingWall = true;
        const normal = contact.ni.clone();
        if (contact.bi.id === this.body.id) {
          normal.negate(normal);
        }
        this.wallNormal.copy(normal);
        
        if (e.body.type === CANNON.Body.KINEMATIC) {
          this.inheritedVelocity.set(e.body.velocity.x, 0, e.body.velocity.z);
        }
      }
    });
  }
  private initAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
  }

  private playHeySound() {
    this.initAudio();
    if (!this.audioCtx) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.audioCtx.currentTime + 0.1);
    osc.frequency.exponentialRampToValueAtTime(400, this.audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.3);
  }

  private playDashSound() {
    this.initAudio();
    if (!this.audioCtx) return;
    
    const bufferSize = this.audioCtx.sampleRate * 0.3;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, this.audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(200, this.audioCtx.currentTime + 0.2);
    
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.5, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.2);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audioCtx.destination);
    noise.start();
  }

  private spawnDashParticles() {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.BoxGeometry(0.05, 0.05, 1.0 + Math.random());
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const line = new THREE.Mesh(geo, mat);
      
      line.position.copy(this.mesh.position as any);
      line.position.x += (Math.random() - 0.5) * 2;
      line.position.y += Math.random() * 1.5;
      line.position.z += (Math.random() - 0.5) * 2;
      
      line.quaternion.copy(this.mesh.quaternion);
      
      this.scene.add(line);
      this.dashParticles.push(line);
    }
  }

  private updateDashParticles(dt: number) {
    for (let i = this.dashParticles.length - 1; i >= 0; i--) {
      const p = this.dashParticles[i];
      const mat = p.material as THREE.MeshBasicMaterial;
      mat.opacity -= dt * 4;
      p.translateZ(dt * 5);
      if (mat.opacity <= 0) {
        this.scene.remove(p);
        this.dashParticles.splice(i, 1);
      }
    }
  }

  private playShatterSound() {
    this.initAudio();
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1500, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(3000, this.audioCtx.currentTime + 0.05);
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.5, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.15);
  }

  private throwBottle(camera: THREE.Camera) {
    if (!this.canThrow) return;
    this.canThrow = false;
    this.heldBottle.visible = false;
    setTimeout(() => {
      this.canThrow = true;
      this.heldBottle.visible = true;
    }, 1500);

    this.playHeySound();

    const geo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8);
    const mat = new THREE.MeshPhysicalMaterial({ 
      color: 0x00ffff, 
      transmission: 0.8, 
      opacity: 1, 
      transparent: true, 
      roughness: 0.1, 
      metalness: 0.1 
    });
    const mesh = new THREE.Mesh(geo, mat);
    
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    mesh.position.copy(this.mesh.position).add(new THREE.Vector3(0, 1.2, 0)).add(camDir.clone().multiplyScalar(0.5));
    
    this.scene.add(mesh);

    const shape = new CANNON.Cylinder(0.1, 0.1, 0.4, 8);
    const body = new CANNON.Body({
      mass: 0.5,
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z)
    });
    const q = new CANNON.Quaternion();
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    body.addShape(shape, new CANNON.Vec3(0,0,0), q);
    
    this.physics.world.addBody(body);

    // カメラ正面方向へ上向きの放物線で投擲
    body.velocity.set(camDir.x * 25, 10, camDir.z * 25);
    
    let isShattered = false;

    body.addEventListener('collide', (e: any) => {
      if (isShattered || e.body === this.body) return;
      isShattered = true;
      this.playShatterSound();
      
      const pCount = 30;
      const pGeo = new THREE.BufferGeometry();
      const pPos = new Float32Array(pCount * 3);
      for(let i=0; i<pCount; i++) {
        pPos[i*3] = mesh.position.x + (Math.random()-0.5)*0.8;
        pPos[i*3+1] = mesh.position.y + (Math.random()-0.5)*0.8;
        pPos[i*3+2] = mesh.position.z + (Math.random()-0.5)*0.8;
      }
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
      const pMat = new THREE.PointsMaterial({ color: 0x00ffff, size: 0.1, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
      const particles = new THREE.Points(pGeo, pMat);
      this.scene.add(particles);
      
      let pOpacity = 1.0;
      const animateP = () => {
        pOpacity -= 0.05;
        pMat.opacity = pOpacity;
        if (pOpacity > 0) requestAnimationFrame(animateP);
        else this.scene.remove(particles);
      };
      animateP();

      this.scene.remove(mesh);
      this.physics.world.removeBody(body);
    });

    const updateBottle = () => {
      if (!mesh.parent || isShattered) return;
      mesh.position.copy(body.position as any);
      mesh.quaternion.copy(body.quaternion as any);
      requestAnimationFrame(updateBottle);
    };
    updateBottle();
  }

  public reset() {
    this.body.position.copy(this.spawnPoint);
    this.body.velocity.set(0, 0, 0);
    this.canAirDash = true;
    this.dashTimer = 0;
    this.inheritedVelocity.set(0,0,0);
  }

  public update(dt: number, camera: THREE.Camera) {
    this.ui.updateKeyboardVector();
    const joystick = this.ui.joystickVector;

    this.updateDashParticles(dt);

    // 1. 真下へのロングレイキャスト（Drop Shadow 兼 接地判定）
    const start = new CANNON.Vec3(this.body.position.x, this.body.position.y, this.body.position.z);
    const end = new CANNON.Vec3(this.body.position.x, this.body.position.y - 100, this.body.position.z);
    const result = new CANNON.RaycastResult();
    this.physics.world.raycastClosest(start, end, { 
      skipBackfaces: true,
      collisionFilterMask: 1 // プレイヤー（Group 2）を無視し、環境（Group 1）のみ判定
    }, result);
    
    if (result.hasHit && result.hitNormalWorld.y > 0.3) {
      this.dropShadow.visible = true;
      this.dropShadow.position.set(result.hitPointWorld.x, result.hitPointWorld.y + 0.05, result.hitPointWorld.z);
    } else {
      this.dropShadow.visible = false;
    }

    // 距離1.1未満なら接地
    const isGrounded = result.hasHit && result.distance < 1.1 && result.hitNormalWorld.y > 0.6;

    if (isGrounded) {
      this.canAirDash = true;
      this.dashTimer = 0; 
      this.isTouchingWall = false;
      
      if (result.body) {
        this.inheritedVelocity.set(result.body.velocity.x, 0, result.body.velocity.z);
      }

      // 安全な床（チェックポイント）に着地した場合、リスポーン地点を更新
      if ((result.body as any).isSafeCheckpoint && (result.body as any).checkpointPos) {
        this.spawnPoint.copy((result.body as any).checkpointPos);
      }
    }

    // 2. Air Dashの消費・発動 (空中の時のみ)
    if (this.ui.consumeDash() && !isGrounded && this.canAirDash) {
      this.canAirDash = false;
      this.dashTimer = 0.25; 
      
      const currentVel = new THREE.Vector3(this.body.velocity.x, 0, this.body.velocity.z);
      let dashDir = currentVel.clone();
      
      if (dashDir.lengthSq() < 1) {
        dashDir.set(0, 0, 1);
        dashDir.applyQuaternion(this.mesh.quaternion);
        dashDir.y = 0;
      }
      dashDir.normalize();
      
      this.airDashVector.set(dashDir.x * this.airDashForce, 0, dashDir.z * this.airDashForce);
      
      this.body.velocity.y = Math.max(this.body.velocity.y, 0); 
      this.body.velocity.y += this.jumpForce * 0.25; 
      
      this.playDashSound();
      this.spawnDashParticles();
    }

    // 3. 移動計算と適用
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.body.velocity.x = this.airDashVector.x;
      this.body.velocity.z = this.airDashVector.z;
    } else {
      let targetVelX = 0;
      let targetVelZ = 0;

      if (joystick.x !== 0 || joystick.y !== 0) {
        const camForward = new THREE.Vector3();
        camera.getWorldDirection(camForward);
        camForward.y = 0;
        camForward.normalize();
        
        const camRight = new THREE.Vector3();
        camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

        const moveDir = new THREE.Vector3()
          .addScaledVector(camForward, joystick.y)
          .addScaledVector(camRight, joystick.x);
        
        if (moveDir.lengthSq() > 0) {
          moveDir.normalize();
          
          const currentSpeed = isGrounded && this.ui.isDashDown() ? this.groundDashSpeed : this.baseSpeed;

          if (!isGrounded && this.isTouchingWall) {
            const v = new CANNON.Vec3(moveDir.x, 0, moveDir.z);
            const dot = v.dot(this.wallNormal);
            if (dot < 0) {
              v.x -= this.wallNormal.x * dot;
              v.z -= this.wallNormal.z * dot;
            }
            targetVelX = v.x * currentSpeed;
            targetVelZ = v.z * currentSpeed;
          } else {
            targetVelX = moveDir.x * currentSpeed;
            targetVelZ = moveDir.z * currentSpeed;
          }
        }
      }

      this.isTouchingWall = false;

      // 水平速度の適用 (inheritedVelocityを加算)
      if (joystick.x !== 0 || joystick.y !== 0) {
        this.body.velocity.x = targetVelX + this.inheritedVelocity.x;
        this.body.velocity.z = targetVelZ + this.inheritedVelocity.z;
        
        const targetAngle = Math.atan2(targetVelX, targetVelZ);
        const targetQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
        this.mesh.quaternion.slerp(targetQuat, 0.15);
      } else {
        // ジョイスティック入力がない時も足場の慣性は残す
        this.body.velocity.x = this.inheritedVelocity.x;
        this.body.velocity.z = this.inheritedVelocity.z;
      }
    }

    // 4. ジャンプ
    if (this.ui.consumeJump() && isGrounded) {
      this.body.velocity.y = this.jumpForce;
    }

    // 5. アクション
    if (this.ui.consumeAction()) {
      this.throwBottle(camera);
    }

    // メッシュの同期
    this.mesh.position.copy(this.body.position as any);

    // アニメーション処理 (歩行・ジャンプ)
    const speedSq = this.body.velocity.x ** 2 + this.body.velocity.z ** 2;
    
    // 外部GLTFモデルのアニメーション更新
    if (this.mixer) {
      this.mixer.update(dt);
    }
    
    // フォールバックアバターのアニメーション更新
    if (this.humanoid) {
      const applyRot = (bone: THREE.Object3D, addX: number, addZ: number = 0) => {
        if (!bone) return;
        const rest = this.boneRestRotations.get(bone);
        if (rest) {
          bone.rotation.set(rest.x + addX, rest.y, rest.z + addZ);
        }
      };

      if (isGrounded && speedSq > 1) {
        const speed = Math.sqrt(speedSq);
        this.animTimer += dt * speed * 1.2;
        const swing = Math.sin(this.animTimer);
        
        applyRot(this.humanoid.legL, swing * 0.8);
        applyRot(this.humanoid.legR, -swing * 0.8);
        applyRot(this.humanoid.armL, -swing * 0.8);
        applyRot(this.humanoid.armR, swing * 0.8);
      } else {
        this.animTimer = 0;
        if (!isGrounded) {
          // 手足を広げたダイナミックなジャンプ/落下ポーズ
          applyRot(this.humanoid.legL, -0.2, 0.3);
          applyRot(this.humanoid.legR, 0.2, -0.3);
          applyRot(this.humanoid.armL, 0.4, 0.6);
          applyRot(this.humanoid.armR, -0.4, -0.6);
        } else {
          // 待機ポーズ
          applyRot(this.humanoid.legL, 0);
          applyRot(this.humanoid.legR, 0);
          applyRot(this.humanoid.armL, 0);
          applyRot(this.humanoid.armR, 0);
        }
      }
    }
  }
}
