const canvasElement = document.getElementById("canvas");
const canvasContainer = canvasElement.parentElement;
const canvasContext = canvasElement.getContext("2d");

// Cap DPR — retina/3x displays were forcing 2-3x pixel work on every gradient/sprite draw
const DEVICE_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
const FRICTION = 0.99;
const WIND = 0.03;
// const GRAVITY = 0.08;

const fireworkSound = new Audio("./audio/firework.wav");
fireworkSound.preload = "auto";
fireworkSound.volume = 0.35;

const resizeCanvas = () => {
  const rect = canvasContainer.getBoundingClientRect();

  canvasElement.width = rect.width * DEVICE_PIXEL_RATIO;
  canvasElement.height = rect.height * DEVICE_PIXEL_RATIO;

  canvasElement.style.width = `${rect.width}px`;
  canvasElement.style.height = `${rect.height}px`;

  canvasContext.setTransform(
    DEVICE_PIXEL_RATIO,
    0,
    0,
    DEVICE_PIXEL_RATIO,
    0,
    0,
  );
  canvasContext.fillStyle = "rgba(0, 0, 0, 0.1)";
};

const resizeObserver = new ResizeObserver(() => {
  resizeCanvas();
});

resizeObserver.observe(canvasContainer);

window.addEventListener("resize", resizeCanvas);

const particlesArray = [];
const shockwaves = [];
const smokeParticles = [];

// ---------------------------------------------------------------------------
// Sprite cache: instead of building a radial gradient + shadowBlur EVERY
// frame for EVERY particle (the two most expensive things canvas can do at
// scale), pre-render one small glow sprite per color, once, to an offscreen
// canvas. Drawing an image later is dramatically cheaper than recomputing a
// gradient and running the shadow blur pass on every draw call.
// ---------------------------------------------------------------------------
const SPRITE_BASE_RADIUS = 32; // px, at DPR 1
const spriteCache = new Map();

function getParticleSprite(color) {
  const cached = spriteCache.get(color);
  if (cached) return cached;

  const size = SPRITE_BASE_RADIUS * 2;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;

  const ctx = sprite.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  const gradient = ctx.createRadialGradient(
    cx,
    cy,
    0,
    cx,
    cy,
    SPRITE_BASE_RADIUS,
  );

  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.12, "#ffffff");
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(0.75, color);
  gradient.addColorStop(1, "transparent");

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, SPRITE_BASE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  spriteCache.set(color, sprite);
  return sprite;
}

function getSmokeSprite() {
  const cached = spriteCache.get("__smoke__");
  if (cached) return cached;

  const size = SPRITE_BASE_RADIUS * 2;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;

  const ctx = sprite.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  const gradient = ctx.createRadialGradient(
    cx,
    cy,
    0,
    cx,
    cy,
    SPRITE_BASE_RADIUS,
  );

  gradient.addColorStop(0, "rgba(180,180,180,0.4)");
  gradient.addColorStop(0.5, "rgba(120,120,120,0.2)");
  gradient.addColorStop(1, "rgba(60,60,60,0)");

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, SPRITE_BASE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  spriteCache.set("__smoke__", sprite);
  return sprite;
}

// Fast removal that avoids Array.splice's O(n) shift cost: swap the dead
// element into the removed slot's place with the last element, then pop.
// Order doesn't matter for particles/smoke/shockwaves, so this is safe.
function swapRemove(array, index) {
  const last = array.length - 1;
  if (index !== last) {
    array[index] = array[last];
  }
  array.pop();
}

class Smoke {
  constructor(position) {
    this.position = { ...position };

    this.velocity = {
      xVelocity: rangeFromRandom(-0.4, 0.4),
      yVelocity: rangeFromRandom(-0.8, -0.2),
    };

    this.radius = rangeFromRandom(6, 16);
    this.alpha = 0.35;
  }

  draw = () => {
    const sprite = getSmokeSprite();
    const scale = this.radius / SPRITE_BASE_RADIUS;
    const size = SPRITE_BASE_RADIUS * 2 * scale;

    canvasContext.globalAlpha = this.alpha;
    canvasContext.drawImage(
      sprite,
      this.position.xPosition - size / 2,
      this.position.yPosition - size / 2,
      size,
      size,
    );
    canvasContext.globalAlpha = 1;
  };

  update = () => {
    this.draw();

    this.position.xPosition += this.velocity.xVelocity + WIND;
    this.position.yPosition += this.velocity.yVelocity;

    this.velocity.xVelocity *= 0.99;
    this.velocity.yVelocity *= 0.99;

    this.radius += 0.25;
    this.alpha *= 0.985;
  };
}

class Shockwave {
  constructor(position, color) {
    this.position = position;
    this.radius = 0;
    this.lineWidth = 6;
    this.alpha = 1;
    this.color = color;
  }

  draw = () => {
    // Only a handful of shockwaves exist at once (one per click), so a live
    // gradient here is cheap — no need for a sprite. Shadow blur removed;
    // the gradient stroke already reads as a soft ring.
    canvasContext.globalAlpha = this.alpha;

    canvasContext.beginPath();
    canvasContext.arc(
      this.position.xPosition,
      this.position.yPosition,
      this.radius,
      0,
      Math.PI * 2,
    );

    canvasContext.lineWidth = this.lineWidth;

    const gradient = canvasContext.createRadialGradient(
      this.position.xPosition,
      this.position.yPosition,
      this.radius * 0.6,
      this.position.xPosition,
      this.position.yPosition,
      this.radius,
    );

    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.7, this.color);
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    canvasContext.strokeStyle = gradient;
    canvasContext.stroke();

    canvasContext.globalAlpha = 1;
  };

  update = () => {
    this.draw();

    this.radius += 10;
    this.lineWidth *= 0.95;
    this.alpha *= 0.92;
  };
}

class Particle {
  constructor(position, velocity, radius, color) {
    this.position = position;
    this.velocity = velocity;
    this.radius = radius;
    this.color = color;
    this.sprite = getParticleSprite(color);

    this.alpha = 1;
    this.lifeTime = 100;

    this.trail = [];
    this.maxTrailLength = 6; // was 10 — fewer segments = fewer stroke() calls
  }

  drawTrail = () => {
    if (this.trail.length < 2) return;

    // One path + one stroke instead of a stroke per segment. We lose the
    // per-segment taper/fade, but a single mid-alpha stroke reads almost
    // identically at these particle sizes and is ~10x fewer draw calls.
    canvasContext.beginPath();
    canvasContext.moveTo(this.trail[0].x, this.trail[0].y);

    for (let i = 1; i < this.trail.length; i++) {
      canvasContext.lineTo(this.trail[i].x, this.trail[i].y);
    }

    canvasContext.lineCap = "round";
    canvasContext.lineJoin = "round";
    canvasContext.globalAlpha = this.alpha * 0.35;
    canvasContext.strokeStyle = this.color;
    canvasContext.lineWidth = Math.max(this.radius * 0.6, 0.5);
    canvasContext.stroke();
    canvasContext.globalAlpha = 1;
  };

  draw = () => {
    if (this.radius < 0.4 || this.alpha < 0.02) return;

    const scale = this.radius / SPRITE_BASE_RADIUS;
    const size = SPRITE_BASE_RADIUS * 2 * scale;

    canvasContext.globalAlpha = this.alpha;
    canvasContext.drawImage(
      this.sprite,
      this.position.xPosition - size / 2,
      this.position.yPosition - size / 2,
      size,
      size,
    );
    canvasContext.globalAlpha = 1;
  };

  update = () => {
    this.trail.unshift({
      x: this.position.xPosition,
      y: this.position.yPosition,
    });

    if (this.trail.length > this.maxTrailLength) {
      this.trail.pop();
    }

    this.drawTrail();
    this.draw();

    this.lifeTime--;

    this.velocity = {
      xVelocity: this.velocity.xVelocity * FRICTION,
      yVelocity: this.velocity.yVelocity * FRICTION,
    };

    this.position = {
      xPosition: this.position.xPosition + this.velocity.xVelocity,
      yPosition: this.position.yPosition + this.velocity.yVelocity,
    };

    this.radius *= 0.99; // gradually shrink
    this.alpha *= 0.99; // gradually fade
  };
}

let animationId = undefined;

function initialize() {
  canvasContext.fillStyle = "rgba(0,0,0,0.1)";
  canvasContext.fillRect(0, 0, canvasElement.width, canvasElement.height);

  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    smokeParticles[i].update();

    if (smokeParticles[i].alpha < 0.01) {
      swapRemove(smokeParticles, i);
    }
  }

  for (let i = shockwaves.length - 1; i >= 0; i--) {
    shockwaves[i].update();

    if (shockwaves[i].alpha <= 0.02) {
      swapRemove(shockwaves, i);
    }
  }

  for (let i = particlesArray.length - 1; i >= 0; i--) {
    particlesArray[i].update();

    if (particlesArray[i].radius <= 0.2 || particlesArray[i].alpha <= 0.02) {
      swapRemove(particlesArray, i);
    }
  }

  animationId = requestAnimationFrame(initialize);
}

const rangeFromRandom = (min, max) => {
  return Math.random() * (max - min) + min;
};

const LOW_END = navigator.hardwareConcurrency <= 4;

const PARTICLE_COUNT_PER_CLICK = LOW_END ? 35 : 70;

const SMOKE_COUNT = LOW_END ? 8 : 15;

// Hard ceiling on live particles. Without this, rapid clicking/tapping
// stacks explosions faster than they decay and the frame cost grows
// unbounded. Past this cap, new clicks still get a shockwave + sound but
// skip spawning more particles.
const MAX_PARTICLES = LOW_END ? 400 : 900;

const FIREWORK_PALETTES = [
  ["#ff3b30", "#ff6b35", "#ff9500", "#ffd166"], // Fire
  ["#ffe066", "#ffd43b", "#fcc419", "#fab005"], // Gold
  ["#4dabf7", "#339af0", "#228be6", "#74c0fc"], // Blue
  ["#69db7c", "#51cf66", "#40c057", "#8ce99a"], // Green
  ["#da77f2", "#cc5de8", "#be4bdb", "#e599f7"], // Purple
  ["#ff8787", "#ff6b6b", "#fa5252", "#ffb3b3"], // Red
];

window.addEventListener("pointerdown", (event) => {
  const rect = canvasElement.getBoundingClientRect();

  const clientX = event.clientX - rect.left;
  const clientY = event.clientY - rect.top;

  // Pick 2–3 random palettes for this explosion
  const palettes = [...FIREWORK_PALETTES]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  // .slice(0, Math.random() > 0.5 ? 3 : 4);

  const sound = fireworkSound.cloneNode();
  sound.volume = 0.5;
  sound.play();

  const palette = palettes[Math.floor(Math.random() * palettes.length)];
  const ringColor = palette[Math.floor(Math.random() * palette.length)];

  shockwaves.push(
    new Shockwave(
      {
        xPosition: clientX,
        yPosition: clientY,
      },
      ringColor,
    ),
  );

  const fade = setInterval(() => {
    sound.volume = Math.max(0, sound.volume - 0.01);

    if (sound.volume <= 0.01) {
      clearInterval(fade);
      sound.pause();
    }
  }, 50);

  for (let i = 0; i < SMOKE_COUNT; i++) {
    smokeParticles.push(
      new Smoke({
        xPosition: clientX,
        yPosition: clientY,
      }),
    );
  }

  // Skip spawning new particles once we're at the cap — keeps the frame
  // budget predictable even under rapid-fire clicking.
  if (particlesArray.length >= MAX_PARTICLES) return;

  const spawnCount = Math.min(
    PARTICLE_COUNT_PER_CLICK,
    MAX_PARTICLES - particlesArray.length,
  );

  for (let index = 0; index < spawnCount; index++) {
    // const angle =
    //   (Math.PI * 2 * index) / PARTICLE_COUNT_PER_CLICK +
    //   rangeFromRandom(-0.08, 0.08);
    // const speed = rangeFromRandom(2, 8);

    const angle = Math.random() * Math.PI * 2;
    const speed = Math.pow(Math.random(), 0.4) * 8;

    // Randomly choose one of the selected palettes
    const particlePalette =
      palettes[Math.floor(Math.random() * palettes.length)];
    // Then choose a color from that palette
    const color =
      particlePalette[Math.floor(Math.random() * particlePalette.length)];

    particlesArray.push(
      new Particle(
        {
          xPosition: clientX,
          yPosition: clientY,
        },
        {
          xVelocity: Math.cos(angle) * speed,
          yVelocity: Math.sin(angle) * speed,
        },
        // rangeFromRandom(2, 8),
        Math.pow(Math.random(), 2) * 7 + 2,
        color,
      ),
    );
  }
});

initialize();
