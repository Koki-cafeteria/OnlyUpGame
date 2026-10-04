import * as CANNON from 'cannon-es';

export class Physics {
  public world: CANNON.World;
  public defaultMaterial: CANNON.Material;
  public playerMaterial: CANNON.Material;
  public bounceMaterial: CANNON.Material;
  public liftMaterial: CANNON.Material;

  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -16, 0); // High gravity but balanced for floating parabolas
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    
    // Materials
    this.defaultMaterial = new CANNON.Material('default');
    this.playerMaterial = new CANNON.Material('player');
    this.bounceMaterial = new CANNON.Material('bounce');
    this.liftMaterial = new CANNON.Material('lift');

    // Contacts
    const playerDefaultContact = new CANNON.ContactMaterial(this.playerMaterial, this.defaultMaterial, {
      friction: 0.0,
      restitution: 0.1,
      contactEquationStiffness: 1e9,
      contactEquationRelaxation: 4,
    });
    const playerBounceContact = new CANNON.ContactMaterial(this.playerMaterial, this.bounceMaterial, {
      friction: 0.0,
      restitution: 1.2, 
    });
    const playerLiftContact = new CANNON.ContactMaterial(this.playerMaterial, this.liftMaterial, {
      friction: 0.8,
      restitution: 0.0,
      contactEquationStiffness: 1e9,
      contactEquationRelaxation: 4,
    });

    this.world.addContactMaterial(playerDefaultContact);
    this.world.addContactMaterial(playerBounceContact);
    this.world.addContactMaterial(playerLiftContact);
  }

  public step(dt: number) {
    this.world.step(1 / 60, dt, 3);
  }
}
