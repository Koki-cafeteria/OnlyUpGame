export class InputManager {
  public joystickVector: { x: number; y: number } = { x: 0, y: 0 };
  public jumpPressed: boolean = false;
  public dashPressed: boolean = false;
  public actionPressed: boolean = false;

  private keysPressed: { [key: string]: boolean } = {};
  
  // Custom joystick DOM elements
  private knob!: HTMLElement;
  private maxRadius = 50;
  private joystickPointerId: number | null = null;

  constructor() {
    this.initCustomJoystick();
    this.initButtons();
    this.initKeyboard();
  }

  private initCustomJoystick() {
    const zone = document.getElementById('joystick-zone');
    if (!zone) return;

    // Create Base
    const base = document.createElement('div');
    base.style.width = '100px';
    base.style.height = '100px';
    base.style.borderRadius = '50%';
    base.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    base.style.position = 'absolute';
    base.style.top = '50%';
    base.style.left = '50%';
    base.style.transform = 'translate(-50%, -50%)';
    zone.appendChild(base);

    // Create Knob
    this.knob = document.createElement('div');
    this.knob.style.width = '40px';
    this.knob.style.height = '40px';
    this.knob.style.borderRadius = '50%';
    this.knob.style.backgroundColor = 'white';
    this.knob.style.position = 'absolute';
    this.knob.style.top = '50%';
    this.knob.style.left = '50%';
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.knob.style.transition = 'transform 0.1s ease-out';
    base.appendChild(this.knob);

    // Pointer events
    zone.style.touchAction = 'none';
    zone.addEventListener('pointerdown', this.onPointerDown.bind(this));
    window.addEventListener('pointermove', this.onPointerMove.bind(this));
    window.addEventListener('pointerup', this.onPointerUp.bind(this));
    window.addEventListener('pointercancel', this.onPointerUp.bind(this));
  }

  private onPointerDown(e: PointerEvent) {
    if (this.joystickPointerId !== null) return; 
    this.joystickPointerId = e.pointerId;
    this.knob.style.transition = 'none';
    this.updateJoystickFromPointer(e);
  }

  private onPointerMove(e: PointerEvent) {
    if (this.joystickPointerId !== e.pointerId) return;
    this.updateJoystickFromPointer(e);
  }

  private onPointerUp(e: PointerEvent) {
    if (this.joystickPointerId !== e.pointerId) return;
    this.joystickPointerId = null;
    this.joystickVector.x = 0;
    this.joystickVector.y = 0;
    
    this.knob.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    this.knob.style.transform = `translate(-50%, -50%)`;
  }

  private updateJoystickFromPointer(e: PointerEvent) {
    const zone = document.getElementById('joystick-zone');
    if (!zone) return;

    const rect = zone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;

    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > this.maxRadius) {
      dx = (dx / distance) * this.maxRadius;
      dy = (dy / distance) * this.maxRadius;
    }

    this.joystickVector.x = dx / this.maxRadius;
    this.joystickVector.y = -dy / this.maxRadius; // Up is positive Y

    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private uiDashHeld = false;

  private initButtons() {
    const jumpBtn = document.getElementById('btn-jump');
    const dashBtn = document.getElementById('btn-dash');
    const actionBtn = document.getElementById('btn-action');

    jumpBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); this.jumpPressed = true; });
    
    dashBtn?.addEventListener('pointerdown', (e) => { 
      e.preventDefault(); 
      this.dashPressed = true; 
      this.uiDashHeld = true; 
    });
    dashBtn?.addEventListener('pointerup', (e) => { 
      e.preventDefault(); 
      this.uiDashHeld = false; 
    });
    dashBtn?.addEventListener('pointercancel', (e) => { 
      e.preventDefault(); 
      this.uiDashHeld = false; 
    });

    actionBtn?.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actionPressed = true; });
  }

  private initKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keysPressed[e.code] = true;
      if (e.code === 'Space') this.jumpPressed = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dashPressed = true;
      if (e.code === 'KeyE') this.actionPressed = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keysPressed[e.code] = false;
    });
  }

  public updateKeyboardVector() {
    if (this.joystickPointerId !== null) return; // Touch takes priority if active

    let x = 0;
    let y = 0;

    if (this.keysPressed['KeyW'] || this.keysPressed['ArrowUp']) y += 1;
    if (this.keysPressed['KeyS'] || this.keysPressed['ArrowDown']) y -= 1;
    if (this.keysPressed['KeyA'] || this.keysPressed['ArrowLeft']) x -= 1;
    if (this.keysPressed['KeyD'] || this.keysPressed['ArrowRight']) x += 1;

    if (x !== 0 || y !== 0) {
      const length = Math.sqrt(x * x + y * y);
      this.joystickVector.x = x / length;
      this.joystickVector.y = y / length;

      const visualX = this.joystickVector.x * this.maxRadius;
      const visualY = -this.joystickVector.y * this.maxRadius;
      this.knob.style.transition = 'transform 0.1s ease-out';
      this.knob.style.transform = `translate(calc(-50% + ${visualX}px), calc(-50% + ${visualY}px))`;
    } else {
      this.joystickVector.x = 0;
      this.joystickVector.y = 0;
      
      this.knob.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      this.knob.style.transform = `translate(-50%, -50%)`;
    }
  }

  public consumeJump() {
    if (this.jumpPressed) {
      this.jumpPressed = false;
      return true;
    }
    return false;
  }

  public consumeDash() {
    if (this.dashPressed) {
      this.dashPressed = false;
      return true;
    }
    return false;
  }

  public isDashDown() {
    return this.uiDashHeld || this.keysPressed['ShiftLeft'] || this.keysPressed['ShiftRight'];
  }

  public consumeAction() {
    if (this.actionPressed) {
      this.actionPressed = false;
      return true;
    }
    return false;
  }
}
