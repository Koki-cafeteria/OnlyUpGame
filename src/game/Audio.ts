export class AudioManager {
  private isScreaming = false;
  private localScreamUrl = '/audio/scream.mp3';
  private cdnScreamUrl = 'https://upload.wikimedia.org/wikipedia/commons/d/d4/Wilhelm_Scream.ogg';
  
  // GC（ガベージコレクション）による再生中断を防ぐための参照保持
  private currentAudio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;

  constructor() {}

  public playDeathScream() {
    if (this.isScreaming) return;
    this.isScreaming = true;
    
    setTimeout(() => {
      this.isScreaming = false;
    }, 2500);

    const playUrl = (url: string, fallbackUrl?: string) => {
      this.currentAudio = new Audio(url);
      this.currentAudio.volume = 1.0;
      
      const playPromise = this.currentAudio.play();
      
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.warn(`Failed to play ${url}:`, e);
          if (fallbackUrl) {
            playUrl(fallbackUrl);
          } else {
            this.playSynthesizedScream();
          }
        });
      }

      this.currentAudio.onerror = () => {
        if (fallbackUrl) {
          playUrl(fallbackUrl);
        } else {
          this.playSynthesizedScream();
        }
      };
    };

    // ローカル -> CDN -> 最終手段(合成音) の順でフォールバック
    playUrl(this.localScreamUrl, this.cdnScreamUrl);
  }

  // ネットワークエラーやCDNブロック等の最悪の事態に備え、絶対に音が鳴る最終フォールバック
  private playSynthesizedScream() {
    console.warn("Using fallback synthesized scream.");
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    
    const osc = this.audioCtx.createOscillator();
    const mod = this.audioCtx.createOscillator();
    const modGain = this.audioCtx.createGain();
    const gain = this.audioCtx.createGain();
    
    // 絶叫に近い変調サウンドの構築
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.audioCtx.currentTime + 0.3);
    osc.frequency.exponentialRampToValueAtTime(200, this.audioCtx.currentTime + 1.2);
    
    mod.type = 'square';
    mod.frequency.setValueAtTime(50, this.audioCtx.currentTime);
    modGain.gain.setValueAtTime(200, this.audioCtx.currentTime);
    
    mod.connect(modGain);
    modGain.connect(osc.frequency);
    
    gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(1.0, this.audioCtx.currentTime + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 1.2);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    mod.start(this.audioCtx.currentTime);
    osc.start(this.audioCtx.currentTime);
    mod.stop(this.audioCtx.currentTime + 1.2);
    osc.stop(this.audioCtx.currentTime + 1.2);
  }
}
