import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Physics } from '../physics/Physics';
import { Player } from './Player';
import { Level } from './Level';
import { TPSCamera } from './Camera';
import { InputManager } from '../ui/TouchUI';
import { AudioManager } from './Audio';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Game {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private physics: Physics;
  private player: Player;
  private level: Level;
  private camera: TPSCamera;
  private ui: InputManager;
  private audioManager: AudioManager;

  private lastTime = 0;
  private startTime = 0;
  
  private timerEl = document.getElementById('timer');
  private altitudeEl = document.getElementById('altitude');

  constructor() {
    this.scene = new THREE.Scene();
    
    const fogColor = new THREE.Color(0x74a0d9);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.0035);
    this.scene.background = fogColor;
    
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.5); // 太陽光の強さを調整
    this.dirLight.position.set(20, 50, 20); 
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 150;
    this.dirLight.shadow.camera.left = -30;
    this.dirLight.shadow.camera.right = 30;
    this.dirLight.shadow.camera.top = 30;
    this.dirLight.shadow.camera.bottom = -30;
    this.dirLight.shadow.bias = -0.0005; 
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // HDRI環境光があるため、HemiLightは極力抑える
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 0.4);
    hemiLight.position.set(0, 100, 0);
    this.scene.add(hemiLight);

    // HDRI環境マップのロード (Poly HavenのCDNから直接ロードして即座に高品質な空を反映)
    const hdriUrl = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr';
    new RGBELoader().load(hdriUrl, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.background = texture;
      this.scene.environment = texture; // PBRマテリアルに空の反射光を適用
      // HDRIが強烈な環境光(Ambient)を放つため、HemiLightをほぼオフにして影を締める
      hemiLight.intensity = 0.05;
    }, undefined, (error) => {
      console.warn("HDRI could not be loaded from CDN. Using fallback background.", error);
    });

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; 
    this.renderer.toneMappingExposure = 1.0;
    document.getElementById('game-container')?.appendChild(this.renderer.domElement);

    this.camera = new TPSCamera();
    
    // Postprocessing (映画的レンダリング・Bloom演出)
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera.camera);
    this.composer.addPass(renderPass);
    
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.2, 0.85);
    this.composer.addPass(bloomPass);
    
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.ui = new InputManager();
    this.physics = new Physics();
    this.audioManager = new AudioManager();
    
    this.player = new Player(this.scene, this.physics, this.ui);
    this.level = new Level(this.scene, this.physics, this.player, 
      () => { 
        this.audioManager.playDeathScream();
        this.player.reset(); 
        this.level.reset();
      }, // onDeath
      () => { this.handleGoal(); }    // onGoal
    );

    window.addEventListener('resize', () => {
      this.camera.resize();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    this.startTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private dirLight!: THREE.DirectionalLight;

  private isCleared = false;
  private finalTimeStr = "";

  private handleGoal() {
    if (this.isCleared) return;
    this.isCleared = true;
    const msgEl = document.getElementById('clear-message');
    const timeEl = document.getElementById('clear-time');
    if (msgEl && timeEl) {
      msgEl.style.display = 'block';
      timeEl.innerText = `タイム: ${this.finalTimeStr}`;
    }
  }

  private loop(time: number) {
    requestAnimationFrame((t) => this.loop(t));

    const dt = (time - this.lastTime) / 1000;
    this.lastTime = time;

    // Physics step
    this.physics.step(dt);
    
    // Update logic
    if (!this.isCleared) {
      this.player.update(dt, this.camera.camera);
      this.updateHUD(time);
    }
    
    this.level.update(time);
    this.camera.update(this.player.mesh.position);

    // 落下時の自動リスポーン処理 (プレイヤー・リフトを一括リセット)
    if (this.player.mesh.position.y < -5) {
      this.audioManager.playDeathScream();
      this.player.reset();
      this.level.reset();
    }

    // Light follows player for crisp local shadows
    this.dirLight.position.set(this.player.mesh.position.x + 20, this.player.mesh.position.y + 40, this.player.mesh.position.z + 20);
    this.dirLight.target.position.copy(this.player.mesh.position);

    // Render via composer for post-processing
    this.composer.render();
  }

  private updateHUD(time: number) {
    if (this.timerEl) {
      const elapsed = (time - this.startTime) / 1000;
      const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const s = Math.floor(elapsed % 60).toString().padStart(2, '0');
      const ms = Math.floor((elapsed * 100) % 100).toString().padStart(2, '0');
      this.finalTimeStr = `${m}:${s}.${ms}`;
      this.timerEl.innerText = this.finalTimeStr;
    }
    if (this.altitudeEl) {
      this.altitudeEl.innerText = `Alt: ${Math.floor(this.player.mesh.position.y)}m`;
    }
  }
}
